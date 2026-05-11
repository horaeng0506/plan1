'use server';

/**
 * PLAN1-TASKS-FEATURE-20260509 — task CRUD + atomic task → schedule 변환 server actions.
 * PLAN1-TASKS-PRIORITY-20260510 — priority shift atomic batch.
 * PLAN1-TASKS-BUCKET-20260511 — 두 bucket ('now' / 'later') priority namespace 독립.
 *
 * convertTaskToSchedule (Critical C3 정합):
 *   - db.batch 안 INSERT plan1Schedules + DELETE plan1Tasks WHERE userId AND id (atomic)
 *   - all-or-nothing rollback (drizzle-orm/neon-http batch = single BEGIN; ...; COMMIT;)
 *   - IDOR 차단 = WHERE eq(plan1Tasks.userId, user.id) 강제 (cross-user task 변환 방지)
 *   - chainedToPrev=true 디폴트 (Q7 정합 · 모든 새 schedule chain)
 *   - timerType='countup' 디폴트 (task → schedule 변환 시 사용자 명시 X)
 *
 * bucket filter (PLAN1-TASKS-BUCKET-20260511 · logic-critic C1·C2):
 *   - 4 server action 모두 priority shift 의 bucket filter 의무 (누락 시 namespace 오염)
 *   - updateTask 의 bucket 변경 케이스 = 옛 bucket -1 shift + 새 bucket +1 shift + self UPDATE = 3 query batch
 *
 * 자세 batch atomicity 영역: lib/db/index.ts 헤더 참조.
 */

import {randomUUID} from 'node:crypto';
import {and, eq, asc, desc, sql, gte, lte, ne} from 'drizzle-orm';
import type {BatchItem} from 'drizzle-orm/batch';
import {db} from '@/lib/db';
import {plan1Tasks, plan1Schedules, plan1Categories} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {ServerActionError, runAction, type ServerActionResult} from '@/lib/server-action';
import type {Task, TaskBucket} from '@/lib/domain/types';

type TaskRow = typeof plan1Tasks.$inferSelect;

function rowToDomain(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    durationMin: row.durationMin,
    categoryId: row.categoryId,
    priority: row.priority,
    bucket: row.bucket,
    createdAt: row.createdAt.getTime()
  };
}

function validateBucket(bucket: unknown): asserts bucket is TaskBucket {
  if (bucket !== 'now' && bucket !== 'later') {
    throw new ServerActionError('serverError.taskBucketInvalid');
  }
}

// PLAN1-TASKS-PRIORITY-20260510 — priority 정렬 read.
// 정렬: priority ASC (1 = 최우선 · 위) → createdAt DESC (동순위 fallback).
// PLAN1-TASKS-BUCKET-20260511 — bucket 정렬 제외 (client filter 분리 정합).
async function listAllTasks(userId: string): Promise<Task[]> {
  const rows = await db
    .select()
    .from(plan1Tasks)
    .where(eq(plan1Tasks.userId, userId))
    .orderBy(asc(plan1Tasks.priority), desc(plan1Tasks.createdAt));
  return rows.map(rowToDomain);
}

export async function listTasks(): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return listAllTasks(user.id);
  });
}

export async function createTask(input: {
  title: string | null;
  durationMin: number | null;
  categoryId: string | null;
  // PLAN1-TASKS-PRIORITY-20260510 — 새 task priority. 1~(N+1) 범위. default 1 (최우선).
  priority?: number;
  // PLAN1-TASKS-BUCKET-20260511 — bucket. default 'now'.
  bucket?: TaskBucket;
}): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const bucket: TaskBucket = input.bucket ?? 'now';
    validateBucket(bucket);
    if (input.categoryId !== null) {
      const ownerRows = await db
        .select({id: plan1Categories.id})
        .from(plan1Categories)
        .where(
          and(eq(plan1Categories.id, input.categoryId), eq(plan1Categories.userId, user.id))
        )
        .limit(1);
      if (!ownerRows[0]) throw new ServerActionError('serverError.categoryNotFound');
    }
    if (input.durationMin !== null && input.durationMin < 0) {
      throw new ServerActionError('serverError.taskDurationInvalid');
    }
    // 해당 bucket 안 task 개수 → max priority = N+1.
    const existingRows = await db
      .select({id: plan1Tasks.id})
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.userId, user.id), eq(plan1Tasks.bucket, bucket)));
    const maxPriority = existingRows.length + 1;
    const requestedPriority = input.priority ?? 1;
    if (requestedPriority < 1 || requestedPriority > maxPriority) {
      throw new ServerActionError('serverError.taskPriorityOutOfRange');
    }
    const id = `task-${randomUUID()}`;
    // priority shift — 새 task priority 위 (낮은 number) 기존 task 모두 +1 shift.
    // bucket filter 의무 (logic-critic C1).
    const queries: BatchItem<'pg'>[] = [
      db
        .update(plan1Tasks)
        .set({priority: sql`${plan1Tasks.priority} + 1`})
        .where(
          and(
            eq(plan1Tasks.userId, user.id),
            eq(plan1Tasks.bucket, bucket),
            gte(plan1Tasks.priority, requestedPriority)
          )
        ),
      db.insert(plan1Tasks).values({
        id,
        userId: user.id,
        title: input.title,
        durationMin: input.durationMin,
        categoryId: input.categoryId,
        priority: requestedPriority,
        bucket
      })
    ];
    await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    return listAllTasks(user.id);
  });
}

// PLAN1-TASKS-PRIORITY-20260510 — task 편집.
// PLAN1-TASKS-BUCKET-20260511 — bucket 변경 케이스 atomic 3 query batch (logic-critic C2).
// 변경 영역: title · durationMin · categoryId · priority · bucket.
export async function updateTask(input: {
  id: string;
  title: string | null;
  durationMin: number | null;
  categoryId: string | null;
  priority: number;
  bucket: TaskBucket;
}): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
    validateBucket(input.bucket);
    // 본 task 존재 + 소유 검증
    const existingRows = await db
      .select()
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.id, input.id), eq(plan1Tasks.userId, user.id)))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) throw new ServerActionError('serverError.taskNotFound');
    // category 소유 검증
    if (input.categoryId !== null) {
      const ownerRows = await db
        .select({id: plan1Categories.id})
        .from(plan1Categories)
        .where(
          and(eq(plan1Categories.id, input.categoryId), eq(plan1Categories.userId, user.id))
        )
        .limit(1);
      if (!ownerRows[0]) throw new ServerActionError('serverError.categoryNotFound');
    }
    if (input.durationMin !== null && input.durationMin < 0) {
      throw new ServerActionError('serverError.taskDurationInvalid');
    }

    const oldBucket = existing.bucket as TaskBucket;
    const newBucket = input.bucket;
    const oldPriority = existing.priority;
    const newPriority = input.priority;
    const bucketChanged = oldBucket !== newBucket;

    // max priority validation:
    //   - bucket 변경 X: 새 bucket count (= 옛 bucket count · 자기 포함)
    //   - bucket 변경 O: 새 bucket count + 1 (자기 신규 insert 와 동치 · 옛 bucket 에서 빠짐)
    const targetBucketRows = await db
      .select({id: plan1Tasks.id})
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.userId, user.id), eq(plan1Tasks.bucket, newBucket)));
    const targetCount = targetBucketRows.length;
    const maxPriority = bucketChanged ? targetCount + 1 : targetCount;
    if (newPriority < 1 || newPriority > maxPriority) {
      throw new ServerActionError('serverError.taskPriorityOutOfRange');
    }

    const queries: BatchItem<'pg'>[] = [];

    if (bucketChanged) {
      // 옛 bucket: 옛 priority 아래 (높은 number) 영역 -1 shift (빠짐 영역 채움)
      queries.push(
        db
          .update(plan1Tasks)
          .set({priority: sql`${plan1Tasks.priority} - 1`})
          .where(
            and(
              eq(plan1Tasks.userId, user.id),
              eq(plan1Tasks.bucket, oldBucket),
              gte(plan1Tasks.priority, oldPriority + 1)
            )
          )
      );
      // 새 bucket: 새 priority 위 (낮은 number) ~ 끝 영역 +1 shift (신규 insert 와 동치)
      queries.push(
        db
          .update(plan1Tasks)
          .set({priority: sql`${plan1Tasks.priority} + 1`})
          .where(
            and(
              eq(plan1Tasks.userId, user.id),
              eq(plan1Tasks.bucket, newBucket),
              gte(plan1Tasks.priority, newPriority),
              ne(plan1Tasks.id, input.id)
            )
          )
      );
    } else if (oldPriority !== newPriority) {
      // 같은 bucket 안 priority 변경 (PLAN1-TASKS-PRIORITY-20260510 그대로 + bucket filter).
      if (newPriority < oldPriority) {
        // 위 (낮은 number) 이동 — 새 priority ~ 옛 priority - 1 영역 +1 shift
        queries.push(
          db
            .update(plan1Tasks)
            .set({priority: sql`${plan1Tasks.priority} + 1`})
            .where(
              and(
                eq(plan1Tasks.userId, user.id),
                eq(plan1Tasks.bucket, oldBucket),
                gte(plan1Tasks.priority, newPriority),
                lte(plan1Tasks.priority, oldPriority - 1),
                ne(plan1Tasks.id, input.id)
              )
            )
        );
      } else {
        // 아래 (높은 number) 이동 — 옛 priority + 1 ~ 새 priority 영역 -1 shift
        queries.push(
          db
            .update(plan1Tasks)
            .set({priority: sql`${plan1Tasks.priority} - 1`})
            .where(
              and(
                eq(plan1Tasks.userId, user.id),
                eq(plan1Tasks.bucket, oldBucket),
                gte(plan1Tasks.priority, oldPriority + 1),
                lte(plan1Tasks.priority, newPriority),
                ne(plan1Tasks.id, input.id)
              )
            )
        );
      }
    }

    // 자기 자신 UPDATE (bucket + priority + 그 외 필드)
    queries.push(
      db
        .update(plan1Tasks)
        .set({
          title: input.title,
          durationMin: input.durationMin,
          categoryId: input.categoryId,
          priority: newPriority,
          bucket: newBucket
        })
        .where(and(eq(plan1Tasks.id, input.id), eq(plan1Tasks.userId, user.id)))
    );

    if (queries.length === 1) {
      // priority 변경 X · bucket 변경 X 영역 단일 UPDATE (batch X)
      await queries[0];
    } else {
      await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    }
    return listAllTasks(user.id);
  });
}

export async function deleteTask(id: string): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
    // 삭제할 task 존재 + bucket + priority (shift 영역).
    const existingRows = await db
      .select({priority: plan1Tasks.priority, bucket: plan1Tasks.bucket})
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.id, id), eq(plan1Tasks.userId, user.id)))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      // 이미 삭제된 경우 — 단순 list return
      return listAllTasks(user.id);
    }
    // PLAN1-TASKS-BUCKET-20260511 — bucket filter 의무 (logic-critic C1).
    const queries: BatchItem<'pg'>[] = [
      db
        .delete(plan1Tasks)
        .where(and(eq(plan1Tasks.id, id), eq(plan1Tasks.userId, user.id))),
      // 같은 bucket 안 삭제된 priority 의 아래 (높은 number) 영역 -1 shift.
      db
        .update(plan1Tasks)
        .set({priority: sql`${plan1Tasks.priority} - 1`})
        .where(
          and(
            eq(plan1Tasks.userId, user.id),
            eq(plan1Tasks.bucket, existing.bucket),
            gte(plan1Tasks.priority, existing.priority + 1)
          )
        )
    ];
    await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    return listAllTasks(user.id);
  });
}

export async function convertTaskToSchedule(input: {
  taskId: string;
  startAt: number;
  chainedToPrev?: boolean;
}): Promise<ServerActionResult<{tasks: Task[]; scheduleId: string}>> {
  return runAction(async () => {
    const user = await requireUser();
    const taskRows = await db
      .select()
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.id, input.taskId), eq(plan1Tasks.userId, user.id)))
      .limit(1);
    const task = taskRows[0];
    if (!task) throw new ServerActionError('serverError.taskNotFound');
    if (task.categoryId === null || task.categoryId === '') {
      throw new ServerActionError('serverError.taskNoCategoryId');
    }
    if (task.durationMin === null || task.durationMin <= 0) {
      throw new ServerActionError('serverError.taskNoDuration');
    }
    const ownerRows = await db
      .select({id: plan1Categories.id})
      .from(plan1Categories)
      .where(
        and(eq(plan1Categories.id, task.categoryId), eq(plan1Categories.userId, user.id))
      )
      .limit(1);
    if (!ownerRows[0]) throw new ServerActionError('serverError.categoryNotFound');
    const scheduleId = `sch-${randomUUID()}`;
    const now = new Date();
    // PLAN1-TASKS-PRIORITY-20260510 — task 변환 (= 삭제) 시 priority shift.
    // PLAN1-TASKS-BUCKET-20260511 — 같은 bucket 안 shift bucket filter 의무 (logic-critic C1).
    const queries: BatchItem<'pg'>[] = [
      db.insert(plan1Schedules).values({
        id: scheduleId,
        userId: user.id,
        title: task.title ?? '',
        categoryId: task.categoryId,
        startAt: new Date(input.startAt),
        durationMin: task.durationMin,
        actualDurationMin: null,
        timerType: 'countup',
        status: 'pending',
        chainedToPrev: input.chainedToPrev ?? true,
        updatedAt: now
      }),
      db
        .delete(plan1Tasks)
        .where(and(eq(plan1Tasks.id, input.taskId), eq(plan1Tasks.userId, user.id))),
      // 변환된 task 의 같은 bucket 아래 (높은 number) 영역 -1 shift.
      db
        .update(plan1Tasks)
        .set({priority: sql`${plan1Tasks.priority} - 1`})
        .where(
          and(
            eq(plan1Tasks.userId, user.id),
            eq(plan1Tasks.bucket, task.bucket),
            gte(plan1Tasks.priority, task.priority + 1)
          )
        )
    ];
    await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    return {tasks: await listAllTasks(user.id), scheduleId};
  });
}
