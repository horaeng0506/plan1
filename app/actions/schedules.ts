'use server';

/**
 * 스케줄 CRUD + cascade(Stage 18) + cleanOrphans(Stage 22) server actions.
 *
 * PLAN1-WH-FOCUS-20260504 — splitByWorkingHours 폐기 (working hours 기능 자체 제거).
 * schedule 입력 시각 그대로 저장 (no fall-back · 14:00 fall-back root cause 제거).
 *
 * 도메인 함수는 number(ms) 입출력. DB Date 변환은 rowToDomain·domainToRow 책임.
 *
 * Stage 5.1 part 2: 사용자 facing error 는 ServerActionError throw → runAction 이
 * discriminated union return 으로 변환 (Next.js prod redact 회피).
 */

import {randomUUID} from 'node:crypto';
import {and, eq, isNotNull} from 'drizzle-orm';
import type {BatchItem} from 'drizzle-orm/batch';
import {db} from '@/lib/db';
import {plan1Categories, plan1Schedules} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {ServerActionError, runAction, type ServerActionResult} from '@/lib/server-action';
import {cascade} from '@/lib/domain/cascade';
import type {Schedule} from '@/lib/domain/types';

type ScheduleRow = typeof plan1Schedules.$inferSelect;

function rowToDomain(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.categoryId,
    startAt: row.startAt.getTime(),
    durationMin: row.durationMin,
    actualDurationMin: row.actualDurationMin ?? undefined,
    timerType: row.timerType,
    status: row.status,
    splitFrom: row.splitFrom ?? undefined,
    chainedToPrev: row.chainedToPrev,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime()
  };
}

async function loadUserState(
  userId: string,
  ownerCategoryId?: string
): Promise<{schedules: Schedule[]}> {
  if (ownerCategoryId !== undefined) {
    const [ownerRows, scheduleRows] = await db.batch([
      db
        .select({id: plan1Categories.id})
        .from(plan1Categories)
        .where(
          and(eq(plan1Categories.id, ownerCategoryId), eq(plan1Categories.userId, userId))
        )
        .limit(1),
      db.select().from(plan1Schedules).where(eq(plan1Schedules.userId, userId))
    ]);
    if (!ownerRows[0]) throw new ServerActionError('serverError.categoryNotFound');
    return {schedules: scheduleRows.map(rowToDomain)};
  }

  const scheduleRows = await db
    .select()
    .from(plan1Schedules)
    .where(eq(plan1Schedules.userId, userId));
  return {schedules: scheduleRows.map(rowToDomain)};
}

/**
 * cascade 결과 schedule[] 을 DB 와 동기화.
 * 신규 = INSERT, 기존 = UPDATE → 통합 UPSERT. DB 에 있으나 결과에 없는 것 = DELETE.
 *
 * Track 1.5 fix (2026-04-29): db.transaction → db.batch (1 round-trip atomic · rollback 보장)
 *
 * logic-critic [높] race fix (2026-04-29): existingIds (loadUserState 시점 snapshot)
 * 에 의존하던 INSERT/UPDATE 분기를 `INSERT ... ON CONFLICT (id) DO UPDATE` 통합 UPSERT 로 변경.
 */
async function syncSchedules(
  userId: string,
  dbExistingIds: Set<string>,
  next: Schedule[]
): Promise<void> {
  const nextIds = new Set(next.map(s => s.id));
  const queries: BatchItem<'pg'>[] = [];

  for (const id of Array.from(dbExistingIds)) {
    if (!nextIds.has(id)) {
      queries.push(
        db
          .delete(plan1Schedules)
          .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, userId)))
      );
    }
  }

  for (const s of next) {
    const values = {
      id: s.id,
      userId,
      title: s.title,
      categoryId: s.categoryId,
      startAt: new Date(s.startAt),
      durationMin: s.durationMin,
      actualDurationMin: s.actualDurationMin ?? null,
      timerType: s.timerType,
      status: s.status,
      splitFrom: s.splitFrom ?? null,
      chainedToPrev: s.chainedToPrev ?? false,
      updatedAt: new Date()
    };
    queries.push(
      db
        .insert(plan1Schedules)
        .values(values)
        .onConflictDoUpdate({
          target: plan1Schedules.id,
          set: {
            title: values.title,
            categoryId: values.categoryId,
            startAt: values.startAt,
            durationMin: values.durationMin,
            actualDurationMin: values.actualDurationMin,
            timerType: values.timerType,
            status: values.status,
            splitFrom: values.splitFrom,
            chainedToPrev: values.chainedToPrev,
            updatedAt: values.updatedAt
          }
        })
    );
  }

  if (queries.length === 0) return;
  await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
}

export async function listSchedules(): Promise<ServerActionResult<Schedule[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(plan1Schedules)
      .where(eq(plan1Schedules.userId, user.id));
    return rows.map(rowToDomain);
  });
}

export async function createSchedule(input: {
  title: string;
  categoryId: string;
  startAt: number;
  durationMin: number;
  timerType: 'countup' | 'timer1' | 'countdown';
  chainedToPrev?: boolean;
}): Promise<ServerActionResult<Schedule[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const state = await loadUserState(user.id, input.categoryId);
    const newSchedule: Schedule = {
      id: `sch-${randomUUID()}`,
      title: input.title,
      categoryId: input.categoryId,
      startAt: input.startAt,
      durationMin: input.durationMin,
      timerType: input.timerType,
      status: 'pending',
      chainedToPrev: input.chainedToPrev ?? false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const next = [...state.schedules, newSchedule];
    const existingIds = new Set(state.schedules.map(s => s.id));
    await syncSchedules(user.id, existingIds, next);
    return next;
  });
}

export async function updateSchedule(input: {
  id: string;
  startAt?: number;
  durationMin?: number;
  title?: string;
  categoryId?: string;
  timerType?: 'countup' | 'timer1' | 'countdown';
  chainedToPrev?: boolean;
}): Promise<ServerActionResult<Schedule[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const state = await loadUserState(user.id, input.categoryId);
    const target = state.schedules.find(s => s.id === input.id);
    if (!target) throw new ServerActionError('serverError.scheduleNotFound');

    // logic-critic Major: 메타 patch 를 cascade 전에 적용 (chainedToPrev 변경이 cascade 에 즉시 반영)
    const metaPatched = state.schedules.map(s =>
      s.id === input.id
        ? {
            ...s,
            title: input.title ?? s.title,
            categoryId: input.categoryId ?? s.categoryId,
            timerType: input.timerType ?? s.timerType,
            chainedToPrev: input.chainedToPrev ?? s.chainedToPrev
          }
        : s
    );

    // cascade 는 startAt/duration 변경 시만 의미. 기타 필드만 patch 인 경우 cascade 가 delta=0 이라 noop.
    const newStartAt = input.startAt ?? target.startAt;
    const newDuration = input.durationMin ?? target.durationMin;
    const cascaded = cascade(metaPatched, input.id, newStartAt, newDuration);

    const existingIds = new Set(state.schedules.map(s => s.id));
    await syncSchedules(user.id, existingIds, cascaded);
    return cascaded;
  });
}

export async function deleteSchedule(id: string): Promise<ServerActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    await db
      .delete(plan1Schedules)
      .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, user.id)));
  });
}

export async function completeSchedule(input: {
  id: string;
  completeAtMs: number;
}): Promise<ServerActionResult<Schedule[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const state = await loadUserState(user.id);
    const target = state.schedules.find(s => s.id === input.id);
    if (!target) throw new ServerActionError('serverError.scheduleNotFound');

    const originalDuration = target.durationMin;
    const actualMin = Math.max(0, Math.round((input.completeAtMs - target.startAt) / 60_000));

    // cascade 는 delta 계산 위해 actualMin 을 newDuration 으로 받음 (뒤 chain shift).
    // 그러나 edited schedule 자체는 durationMin 원래 값 보존 + actualDurationMin 별도 patch
    // (logic-critic Critical #3 — planned vs actual 비교 데이터 보존).
    const cascaded = cascade(state.schedules, input.id, target.startAt, actualMin).map(s =>
      s.id === input.id
        ? {
            ...s,
            durationMin: originalDuration,
            status: 'done' as const,
            actualDurationMin: actualMin
          }
        : s
    );

    const existingIds = new Set(state.schedules.map(s => s.id));
    await syncSchedules(user.id, existingIds, cascaded);
    return cascaded;
  });
}

/**
 * Stage 22: orphan split 자동 정리.
 *
 * PLAN1-WH-FOCUS-20260504 — split 폐기 후에도 옛 row (splitFrom 보유) 정리 위해 유지.
 * 시간 흐름상 새 row 생성 안 됨 (splitByWorkingHours 미호출) — 옛 데이터 안전망.
 */
export async function cleanOrphans(): Promise<ServerActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    const [orphanRows, allRows] = await db.batch([
      db
        .select({id: plan1Schedules.id, splitFrom: plan1Schedules.splitFrom})
        .from(plan1Schedules)
        .where(and(eq(plan1Schedules.userId, user.id), isNotNull(plan1Schedules.splitFrom))),
      db
        .select({id: plan1Schedules.id})
        .from(plan1Schedules)
        .where(eq(plan1Schedules.userId, user.id))
    ]);
    if (orphanRows.length === 0) return;

    const allIds = new Set(allRows.map(r => r.id));
    const toDelete = orphanRows.filter(r => r.splitFrom && !allIds.has(r.splitFrom)).map(r => r.id);
    if (toDelete.length === 0) return;

    const deleteQueries: BatchItem<'pg'>[] = toDelete.map(id =>
      db
        .delete(plan1Schedules)
        .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, user.id)))
    );
    await db.batch(deleteQueries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
  });
}
