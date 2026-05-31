'use server';

/**
 * PLAN1-TASKS-FEATURE-20260509 — task CRUD + atomic task → schedule 변환 server actions.
 * PLAN1-TASKS-PRIORITY-20260510 — priority shift atomic batch.
 * PLAN1-TASKS-BUCKET-20260511 — bucket('now'/'later') priority namespace 독립 (레거시 enum).
 * PLAN1-TASKS-BUCKET-CUSTOM-20260531 — priority namespace 를 bucketId(사용자 정의 버킷)로 전환.
 *   - bucket(enum) 컬럼은 보존하나 모든 shift/정렬 namespace 는 bucketId 기준.
 *   - 횟수차감형 버킷(isCountBased) 의 task 는 count 보유 → 변환 시 task 유지 + count-1, 0 도달 시 삭제.
 *
 * convertTaskToSchedule (Critical C3 정합):
 *   - db.batch 안 INSERT plan1Schedules + (일반: DELETE task + priority shift / 횟수: count-1 조건부 UPDATE) atomic
 *   - IDOR 차단 = WHERE eq(plan1Tasks.userId, user.id) 강제
 *   - chainedToPrev=true 디폴트 · timerType='countup' 디폴트
 *
 * 횟수차감 race 차단 (logic-critic Critical):
 *   - count UPDATE 에 WHERE count >= 1 가드 → 동시 변환 시 음수 도달 차단.
 *   - 클라이언트 in-flight 잠금(TaskList)과 이중 가드.
 */

import {randomUUID} from 'node:crypto';
import {and, eq, asc, desc, sql, gte, lte, ne} from 'drizzle-orm';
import type {BatchItem} from 'drizzle-orm/batch';
import {db} from '@/lib/db';
import {plan1Tasks, plan1Schedules, plan1Categories, plan1TaskBuckets} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {ServerActionError, runAction, type ServerActionResult} from '@/lib/server-action';
import type {Task} from '@/lib/domain/types';

type TaskRow = typeof plan1Tasks.$inferSelect;

function rowToDomain(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    durationMin: row.durationMin,
    categoryId: row.categoryId,
    priority: row.priority,
    bucket: row.bucket,
    bucketId: row.bucketId,
    count: row.count,
    createdAt: row.createdAt.getTime()
  };
}

// 버킷 소유 검증 + isCountBased/defaultKind 조회. 없으면 throw.
async function requireBucket(
  userId: string,
  bucketId: string
): Promise<{id: string; isCountBased: boolean; defaultKind: 'now' | 'later' | null}> {
  const rows = await db
    .select({
      id: plan1TaskBuckets.id,
      isCountBased: plan1TaskBuckets.isCountBased,
      defaultKind: plan1TaskBuckets.defaultKind
    })
    .from(plan1TaskBuckets)
    .where(and(eq(plan1TaskBuckets.id, bucketId), eq(plan1TaskBuckets.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new ServerActionError('serverError.taskBucketNotFound');
  return rows[0];
}

async function requireCategoryOwned(userId: string, categoryId: string): Promise<void> {
  const ownerRows = await db
    .select({id: plan1Categories.id})
    .from(plan1Categories)
    .where(and(eq(plan1Categories.id, categoryId), eq(plan1Categories.userId, userId)))
    .limit(1);
  if (!ownerRows[0]) throw new ServerActionError('serverError.categoryNotFound');
}

// 횟수차감형 버킷의 count 정규화: isCountBased 면 ≥1 (default 1), 아니면 null.
function normalizeCount(isCountBased: boolean, requested: number | null | undefined): number | null {
  if (!isCountBased) return null;
  const n = requested ?? 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

// PLAN1-TASKS-BUCKET-CUSTOM-20260531 — priority 정렬 read (bucketId namespace 는 client filter).
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
  priority?: number;
  // PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 버킷 FK. 횟수차감형이면 count.
  bucketId: string;
  count?: number | null;
}): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const bucket = await requireBucket(user.id, input.bucketId);
    if (input.categoryId !== null) await requireCategoryOwned(user.id, input.categoryId);
    if (input.durationMin !== null && input.durationMin < 0) {
      throw new ServerActionError('serverError.taskDurationInvalid');
    }
    // 횟수차감형은 category·duration 필수 (N3 — 변환 시 modal 회송 방지).
    if (bucket.isCountBased) {
      if (input.categoryId === null) throw new ServerActionError('serverError.taskCountNeedsCategory');
      if (input.durationMin === null || input.durationMin <= 0) {
        throw new ServerActionError('serverError.taskCountNeedsDuration');
      }
    }
    const count = normalizeCount(bucket.isCountBased, input.count);

    // 해당 bucketId 안 task 개수 → max priority = N+1.
    const existingRows = await db
      .select({id: plan1Tasks.id})
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.userId, user.id), eq(plan1Tasks.bucketId, input.bucketId)));
    const maxPriority = existingRows.length + 1;
    const requestedPriority = input.priority ?? 1;
    if (requestedPriority < 1 || requestedPriority > maxPriority) {
      throw new ServerActionError('serverError.taskPriorityOutOfRange');
    }
    const id = `task-${randomUUID()}`;
    const queries: BatchItem<'pg'>[] = [
      db
        .update(plan1Tasks)
        .set({priority: sql`${plan1Tasks.priority} + 1`})
        .where(
          and(
            eq(plan1Tasks.userId, user.id),
            eq(plan1Tasks.bucketId, input.bucketId),
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
        bucket: bucket.defaultKind ?? 'now',
        bucketId: input.bucketId,
        count
      })
    ];
    await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    return listAllTasks(user.id);
  });
}

// PLAN1-TASKS-BUCKET-CUSTOM-20260531 — bucketId 변경 케이스 atomic shift (옛 bucket -1 + 새 bucket +1 + self).
export async function updateTask(input: {
  id: string;
  title: string | null;
  durationMin: number | null;
  categoryId: string | null;
  priority: number;
  bucketId: string;
  count?: number | null;
}): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const bucket = await requireBucket(user.id, input.bucketId);
    const existingRows = await db
      .select()
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.id, input.id), eq(plan1Tasks.userId, user.id)))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) throw new ServerActionError('serverError.taskNotFound');
    if (input.categoryId !== null) await requireCategoryOwned(user.id, input.categoryId);
    if (input.durationMin !== null && input.durationMin < 0) {
      throw new ServerActionError('serverError.taskDurationInvalid');
    }
    if (bucket.isCountBased) {
      if (input.categoryId === null) throw new ServerActionError('serverError.taskCountNeedsCategory');
      if (input.durationMin === null || input.durationMin <= 0) {
        throw new ServerActionError('serverError.taskCountNeedsDuration');
      }
    }
    // count: 횟수차감형이면 입력값(또는 기존값) 유지, 아니면 null.
    const count = normalizeCount(bucket.isCountBased, input.count ?? existing.count);

    const oldBucketId = existing.bucketId;
    const newBucketId = input.bucketId;
    const oldPriority = existing.priority;
    const newPriority = input.priority;
    const bucketChanged = oldBucketId !== newBucketId;

    // max priority: bucket 변경 X → 새 bucket count(자기 포함) · 변경 O → 새 bucket count + 1.
    const targetBucketRows = await db
      .select({id: plan1Tasks.id})
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.userId, user.id), eq(plan1Tasks.bucketId, newBucketId)));
    const targetCount = targetBucketRows.length;
    const maxPriority = bucketChanged ? targetCount + 1 : targetCount;
    if (newPriority < 1 || newPriority > maxPriority) {
      throw new ServerActionError('serverError.taskPriorityOutOfRange');
    }

    const queries: BatchItem<'pg'>[] = [];

    if (bucketChanged && oldBucketId !== null) {
      // 옛 bucket: 옛 priority 아래(높은 number) -1 shift.
      queries.push(
        db
          .update(plan1Tasks)
          .set({priority: sql`${plan1Tasks.priority} - 1`})
          .where(
            and(
              eq(plan1Tasks.userId, user.id),
              eq(plan1Tasks.bucketId, oldBucketId),
              gte(plan1Tasks.priority, oldPriority + 1)
            )
          )
      );
    }
    if (bucketChanged) {
      // 새 bucket: 새 priority 위(낮은 number) ~ 끝 +1 shift.
      queries.push(
        db
          .update(plan1Tasks)
          .set({priority: sql`${plan1Tasks.priority} + 1`})
          .where(
            and(
              eq(plan1Tasks.userId, user.id),
              eq(plan1Tasks.bucketId, newBucketId),
              gte(plan1Tasks.priority, newPriority),
              ne(plan1Tasks.id, input.id)
            )
          )
      );
    } else if (oldPriority !== newPriority && oldBucketId !== null) {
      if (newPriority < oldPriority) {
        queries.push(
          db
            .update(plan1Tasks)
            .set({priority: sql`${plan1Tasks.priority} + 1`})
            .where(
              and(
                eq(plan1Tasks.userId, user.id),
                eq(plan1Tasks.bucketId, oldBucketId),
                gte(plan1Tasks.priority, newPriority),
                lte(plan1Tasks.priority, oldPriority - 1),
                ne(plan1Tasks.id, input.id)
              )
            )
        );
      } else {
        queries.push(
          db
            .update(plan1Tasks)
            .set({priority: sql`${plan1Tasks.priority} - 1`})
            .where(
              and(
                eq(plan1Tasks.userId, user.id),
                eq(plan1Tasks.bucketId, oldBucketId),
                gte(plan1Tasks.priority, oldPriority + 1),
                lte(plan1Tasks.priority, newPriority),
                ne(plan1Tasks.id, input.id)
              )
            )
        );
      }
    }

    queries.push(
      db
        .update(plan1Tasks)
        .set({
          title: input.title,
          durationMin: input.durationMin,
          categoryId: input.categoryId,
          priority: newPriority,
          bucket: bucket.defaultKind ?? 'now',
          bucketId: newBucketId,
          count
        })
        .where(and(eq(plan1Tasks.id, input.id), eq(plan1Tasks.userId, user.id)))
    );

    if (queries.length === 1) {
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
    const existingRows = await db
      .select({priority: plan1Tasks.priority, bucketId: plan1Tasks.bucketId})
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.id, id), eq(plan1Tasks.userId, user.id)))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      return listAllTasks(user.id);
    }
    const queries: BatchItem<'pg'>[] = [
      db.delete(plan1Tasks).where(and(eq(plan1Tasks.id, id), eq(plan1Tasks.userId, user.id)))
    ];
    if (existing.bucketId !== null) {
      queries.push(
        db
          .update(plan1Tasks)
          .set({priority: sql`${plan1Tasks.priority} - 1`})
          .where(
            and(
              eq(plan1Tasks.userId, user.id),
              eq(plan1Tasks.bucketId, existing.bucketId),
              gte(plan1Tasks.priority, existing.priority + 1)
            )
          )
      );
    }
    if (queries.length === 1) {
      await queries[0];
    } else {
      await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    }
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
    await requireCategoryOwned(user.id, task.categoryId);

    const scheduleId = `sch-${randomUUID()}`;
    const now = new Date();
    const insertSchedule = db.insert(plan1Schedules).values({
      id: scheduleId,
      userId: user.id,
      title: task.title ?? '',
      categoryId: task.categoryId,
      startAt: new Date(input.startAt),
      durationMin: task.durationMin,
      actualDurationMin: null,
      timerType: 'countup' as const,
      status: 'pending' as const,
      chainedToPrev: input.chainedToPrev ?? true,
      updatedAt: now
    });

    // 횟수차감형(count !== null) 분기 (PLAN1-TASKS-BUCKET-CUSTOM-20260531).
    const isCountBased = task.count !== null;
    let queries: BatchItem<'pg'>[];

    if (isCountBased) {
      if ((task.count ?? 0) <= 0) {
        throw new ServerActionError('serverError.taskCountExhausted');
      }
      const willRemain = (task.count ?? 0) - 1;
      if (willRemain > 0) {
        // task 유지 + count - 1 (조건부 WHERE count >= 1 · 음수/race 차단). priority shift 없음.
        queries = [
          insertSchedule,
          db
            .update(plan1Tasks)
            .set({count: sql`${plan1Tasks.count} - 1`})
            .where(
              and(
                eq(plan1Tasks.id, input.taskId),
                eq(plan1Tasks.userId, user.id),
                gte(plan1Tasks.count, 1)
              )
            )
        ];
      } else {
        // 마지막 차감 (0 도달) → 일반 task 처럼 삭제 + priority shift.
        queries = [insertSchedule, ...deleteWithShift(user.id, task)];
      }
    } else {
      queries = [insertSchedule, ...deleteWithShift(user.id, task)];
    }

    await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    return {tasks: await listAllTasks(user.id), scheduleId};
  });
}

// 변환/삭제 시 task 삭제 + 같은 bucketId 아래(높은 number) priority -1 shift.
function deleteWithShift(userId: string, task: TaskRow): BatchItem<'pg'>[] {
  const queries: BatchItem<'pg'>[] = [
    db
      .delete(plan1Tasks)
      .where(and(eq(plan1Tasks.id, task.id), eq(plan1Tasks.userId, userId)))
  ];
  if (task.bucketId !== null) {
    queries.push(
      db
        .update(plan1Tasks)
        .set({priority: sql`${plan1Tasks.priority} - 1`})
        .where(
          and(
            eq(plan1Tasks.userId, userId),
            eq(plan1Tasks.bucketId, task.bucketId),
            gte(plan1Tasks.priority, task.priority + 1)
          )
        )
    );
  }
  return queries;
}
