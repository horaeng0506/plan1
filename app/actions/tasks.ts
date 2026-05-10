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
import {and, eq, desc} from 'drizzle-orm';
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
    createdAt: row.createdAt.getTime()
  };
}

export async function listTasks(): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(plan1Tasks)
      .where(eq(plan1Tasks.userId, user.id))
      .orderBy(desc(plan1Tasks.createdAt));
    return rows.map(rowToDomain);
  });
}

export async function createTask(input: {
  title: string | null;
  durationMin: number | null;
  categoryId: string | null;
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
    const id = `task-${randomUUID()}`;
    await db.insert(plan1Tasks).values({
      id,
      userId: user.id,
      title: input.title,
      durationMin: input.durationMin,
      categoryId: input.categoryId
    });
    const rows = await db
      .select()
      .from(plan1Tasks)
      .where(eq(plan1Tasks.userId, user.id))
      .orderBy(desc(plan1Tasks.createdAt));
    return rows.map(rowToDomain);
  });
}

export async function deleteTask(id: string): Promise<ServerActionResult<Task[]>> {
  return runAction(async () => {
    const user = await requireUser();
    await db
      .delete(plan1Tasks)
      .where(and(eq(plan1Tasks.id, id), eq(plan1Tasks.userId, user.id)));
    const rows = await db
      .select()
      .from(plan1Tasks)
      .where(eq(plan1Tasks.userId, user.id))
      .orderBy(desc(plan1Tasks.createdAt));
    return rows.map(rowToDomain);
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
        .where(and(eq(plan1Tasks.id, input.taskId), eq(plan1Tasks.userId, user.id)))
    ];
    await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    const rows = await db
      .select()
      .from(plan1Tasks)
      .where(eq(plan1Tasks.userId, user.id))
      .orderBy(desc(plan1Tasks.createdAt));
    return {tasks: rows.map(rowToDomain), scheduleId};
  });
}