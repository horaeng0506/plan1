'use server';

/**
 * PLAN1-TASKS-FEATURE-20260509 — task CRUD + atomic task → schedule 변환 server actions.
 *
 * convertTaskToSchedule (Critical C3 정합):
 *   - db.batch 안 INSERT plan1Schedules + DELETE plan1Tasks WHERE userId AND id 박음 (atomic)
 *   - all-or-nothing rollback (drizzle-orm/neon-http batch = single BEGIN; ...; COMMIT;)
 *   - IDOR 차단 = WHERE eq(plan1Tasks.userId, user.id) 강제 (cross-user task 변환 방지)
 *   - chainedToPrev=true 디폴트 (Q7 정합 · 모든 새 schedule chain)
 *   - timerType='countup' 디폴트 (task → schedule 변환 시 사용자 명시 X)
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
import type {Task} from '@/lib/domain/types';

type TaskRow = typeof plan1Tasks.$inferSelect;

function rowToDomain(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    durationMin: row.durationMin,
    categoryId: row.categoryId,
    priority: row.priority,
    createdAt: row.createdAt.getTime()
  };
}

// PLAN1-TASKS-PRIORITY-20260510 — priority 정렬 read.
// 정렬: priority ASC (1 = 최우선 · 위) → createdAt DESC (동순위 fallback).
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
  // server-side validation: 범위 밖 (예: < 1 또는 > N+1) 박힌 영영 throw.
  priority?: number;
}): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
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
    // 현재 task 개수 박은 영영 max priority = N+1.
    const existingRows = await db
      .select({id: plan1Tasks.id})
      .from(plan1Tasks)
      .where(eq(plan1Tasks.userId, user.id));
    const maxPriority = existingRows.length + 1;
    const requestedPriority = input.priority ?? 1;
    if (requestedPriority < 1 || requestedPriority > maxPriority) {
      throw new ServerActionError('serverError.taskPriorityOutOfRange');
    }
    const id = `task-${randomUUID()}`;
    // priority shift — 새 task priority 박은 영영 그 이상 priority 의 기존 task 모두 +1 shift.
    // 단일 batch 안 atomic 박음 (UPDATE shift + INSERT new).
    const queries: BatchItem<'pg'>[] = [
      db
        .update(plan1Tasks)
        .set({priority: sql`${plan1Tasks.priority} + 1`})
        .where(
          and(
            eq(plan1Tasks.userId, user.id),
            gte(plan1Tasks.priority, requestedPriority)
          )
        ),
      db.insert(plan1Tasks).values({
        id,
        userId: user.id,
        title: input.title,
        durationMin: input.durationMin,
        categoryId: input.categoryId,
        priority: requestedPriority
      })
    ];
    await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    return listAllTasks(user.id);
  });
}

// PLAN1-TASKS-PRIORITY-20260510 — task 편집 (사양 4번).
// 변경 영역: title · durationMin · categoryId · priority.
// priority 변경 시 shift logic — 다른 task priority 조정 박은 atomic batch.
export async function updateTask(input: {
  id: string;
  title: string | null;
  durationMin: number | null;
  categoryId: string | null;
  priority: number;
}): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
    // 본 task 박힘 + 소유 검증
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
    // 전체 task count 박은 영영 max priority = N (편집 시점 본 task 도 포함).
    const allRows = await db
      .select({id: plan1Tasks.id})
      .from(plan1Tasks)
      .where(eq(plan1Tasks.userId, user.id));
    const maxPriority = allRows.length;
    if (input.priority < 1 || input.priority > maxPriority) {
      throw new ServerActionError('serverError.taskPriorityOutOfRange');
    }
    const oldPriority = existing.priority;
    const newPriority = input.priority;
    const queries: BatchItem<'pg'>[] = [];
    if (oldPriority !== newPriority) {
      if (newPriority < oldPriority) {
        // 위 (낮은 number) 로 이동 — 새 priority ~ 옛 priority - 1 범위 +1 shift
        queries.push(
          db
            .update(plan1Tasks)
            .set({priority: sql`${plan1Tasks.priority} + 1`})
            .where(
              and(
                eq(plan1Tasks.userId, user.id),
                gte(plan1Tasks.priority, newPriority),
                lte(plan1Tasks.priority, oldPriority - 1),
                ne(plan1Tasks.id, input.id)
              )
            )
        );
      } else {
        // 아래 (높은 number) 로 이동 — 옛 priority + 1 ~ 새 priority 범위 -1 shift
        queries.push(
          db
            .update(plan1Tasks)
            .set({priority: sql`${plan1Tasks.priority} - 1`})
            .where(
              and(
                eq(plan1Tasks.userId, user.id),
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
          priority: newPriority
        })
        .where(and(eq(plan1Tasks.id, input.id), eq(plan1Tasks.userId, user.id)))
    );
    if (queries.length === 1) {
      // priority 변경 X 영영 단일 UPDATE (batch X)
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
    // 삭제할 task 박힘 + priority 박음 (shift 영영).
    const existingRows = await db
      .select({priority: plan1Tasks.priority})
      .from(plan1Tasks)
      .where(and(eq(plan1Tasks.id, id), eq(plan1Tasks.userId, user.id)))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      // 이미 삭제된 영영 — 단순 list 박음 return
      return listAllTasks(user.id);
    }
    const queries: BatchItem<'pg'>[] = [
      db
        .delete(plan1Tasks)
        .where(and(eq(plan1Tasks.id, id), eq(plan1Tasks.userId, user.id))),
      // 삭제된 priority 위 (낮은 number) 박힌 영역 X — 그 아래 (높은 number) 박힌 영역 -1 shift.
      db
        .update(plan1Tasks)
        .set({priority: sql`${plan1Tasks.priority} - 1`})
        .where(
          and(
            eq(plan1Tasks.userId, user.id),
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
    // PLAN1-TASKS-PRIORITY-20260510 — task 변환 (= 삭제) 시 priority shift 박음.
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
      // 변환된 priority 의 아래 (높은 number) 박힌 영역 -1 shift.
      db
        .update(plan1Tasks)
        .set({priority: sql`${plan1Tasks.priority} - 1`})
        .where(
          and(
            eq(plan1Tasks.userId, user.id),
            gte(plan1Tasks.priority, task.priority + 1)
          )
        )
    ];
    await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    return {tasks: await listAllTasks(user.id), scheduleId};
  });
}