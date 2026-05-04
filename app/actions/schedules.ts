'use server';

/**
 * 스케줄 CRUD + cascade(Stage 18) + cleanOrphans(Stage 22) server actions.
 *
 * split(Stage 9 working-hours 기반 분할) 은 working-hours.ts 가 트리거하지만
 * createSchedule/updateSchedule 도 split 재계산 필요 → 같은 패턴 재사용.
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
import {plan1Categories, plan1Schedules, plan1WorkingHours, plan1Settings} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
// Track 1.5 phase 3 (2026-04-29): assertCategoryOwnership 별도 helper 제거.
// loadUserState 가 ownership SELECT + loadState 3 SELECT 를 1 batch 로 통합 (cross-continent RTT × 2 → × 1)
import {ServerActionError, runAction, type ServerActionResult} from '@/lib/server-action';
import {cascade} from '@/lib/domain/cascade';
import {splitByWorkingHours} from '@/lib/domain/split';
import type {Schedule, WorkingHours} from '@/lib/domain/types';

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

// IDOR 가드는 별도 helper (lib/ownership-guards.ts) 로 추출 — Stage 8.G test 보강.
// 같은 module 에 inline 시 'use server' directive + vitest mock 상호작용 복잡.
// import: 파일 상단 import {assertCategoryOwnership} from '@/lib/ownership-guards';

async function loadUserState(
  userId: string,
  ownerCategoryId?: string
): Promise<{
  schedules: Schedule[];
  workingHours: Record<string, WorkingHours>;
  defaultWH: {startMin: number; endMin: number};
  userTz: string;
}> {
  // Track 1.5 phase 3 fix (2026-04-29): ownership SELECT + loadState 3 SELECT 을 1 batch 로
  // 통합. cross-continent RTT × 2 (ownership 700ms + loadState 700ms = 1400ms) → RTT × 1 (~700ms)
  if (ownerCategoryId !== undefined) {
    const [ownerRows, scheduleRows, whRows, settingsRow] = await db.batch([
      db
        .select({id: plan1Categories.id})
        .from(plan1Categories)
        .where(
          and(eq(plan1Categories.id, ownerCategoryId), eq(plan1Categories.userId, userId))
        )
        .limit(1),
      db.select().from(plan1Schedules).where(eq(plan1Schedules.userId, userId)),
      db.select().from(plan1WorkingHours).where(eq(plan1WorkingHours.userId, userId)),
      db
        .select()
        .from(plan1Settings)
        .where(eq(plan1Settings.userId, userId))
        .limit(1)
    ]);
    if (!ownerRows[0]) throw new ServerActionError('serverError.categoryNotFound');

    const workingHours: Record<string, WorkingHours> = {};
    for (const wh of whRows) {
      workingHours[wh.date] = {date: wh.date, startMin: wh.startMin, endMin: wh.endMin};
    }
    const defaultWH = settingsRow[0]
      ? {
          startMin: settingsRow[0].defaultWorkingHoursStartMin,
          endMin: settingsRow[0].defaultWorkingHoursEndMin
        }
      : {startMin: 540, endMin: 1080};
    const userTz = settingsRow[0]?.userTz ?? 'Asia/Seoul';
    return {schedules: scheduleRows.map(rowToDomain), workingHours, defaultWH, userTz};
  }

  // ownership 검증 불요 (completeSchedule · updateSchedule categoryId 미변경)
  const [scheduleRows, whRows, settingsRow] = await db.batch([
    db.select().from(plan1Schedules).where(eq(plan1Schedules.userId, userId)),
    db.select().from(plan1WorkingHours).where(eq(plan1WorkingHours.userId, userId)),
    db
      .select()
      .from(plan1Settings)
      .where(eq(plan1Settings.userId, userId))
      .limit(1)
  ]);

  const workingHours: Record<string, WorkingHours> = {};
  for (const wh of whRows) {
    workingHours[wh.date] = {date: wh.date, startMin: wh.startMin, endMin: wh.endMin};
  }

  const defaultWH = settingsRow[0]
    ? {
        startMin: settingsRow[0].defaultWorkingHoursStartMin,
        endMin: settingsRow[0].defaultWorkingHoursEndMin
      }
    : {startMin: 540, endMin: 1080}; // 09:00~18:00 default
  const userTz = settingsRow[0]?.userTz ?? 'Asia/Seoul';

  return {
    schedules: scheduleRows.map(rowToDomain),
    workingHours,
    defaultWH,
    userTz
  };
}

/**
 * cascade·split 결과 schedule[] 을 DB 와 동기화.
 * 신규 = INSERT, 기존 = UPDATE → 통합 UPSERT. DB 에 있으나 결과에 없는 것 = DELETE.
 *
 * Track 1.5 fix (2026-04-29): db.transaction (sequential await loop · N round-trip)
 *   → db.batch (1 round-trip atomic · rollback 보장)
 *
 * logic-critic [높] race fix (2026-04-29): existingIds (loadUserState batch1 시점 snapshot)
 * 에 의존하던 INSERT/UPDATE 분기를 `INSERT ... ON CONFLICT (id) DO UPDATE` 통합 UPSERT 로
 * 변경. 별도 connection 의 동시 mutation 으로 인한 (a) PK 충돌 (b) UPDATE no-op (c) DELETE
 * no-op 시나리오 자동 해소. existingIds 매개변수 제거 — 호출자도 단순화.
 *
 * Neon HTTP `db.batch` atomicity 근거: `@neondatabase/serverless` 의
 * `sql.transaction([queries])` 가 단일 HTTP request 안에 BEGIN/COMMIT 으로 wrap (single PG
 * transaction · same MVCC snapshot · all-or-nothing rollback).
 * https://neon.com/docs/serverless/serverless-driver § "Multiple queries with `transaction()`"
 * https://orm.drizzle.team/docs/batch-api § "If any statement fails, the entire transaction rolls back."
 */
async function syncSchedules(
  userId: string,
  dbExistingIds: Set<string>,
  next: Schedule[]
): Promise<void> {
  const nextIds = new Set(next.map(s => s.id));
  const queries: BatchItem<'pg'>[] = [];

  // DELETE — DB 에 있으나 next 에 없는 row. 다른 connection 이 이미 지운 row 라도 silent no-op (안전)
  for (const id of Array.from(dbExistingIds)) {
    if (!nextIds.has(id)) {
      queries.push(
        db
          .delete(plan1Schedules)
          .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, userId)))
      );
    }
  }

  // UPSERT (race-safe) — INSERT ... ON CONFLICT (id) DO UPDATE. PK 충돌 자동 해소
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
    // loadUserState 가 ownership SELECT + 3 SELECT loadState 를 1 batch (4 SELECT atomic)
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
    const originals = state.schedules.filter(s => !s.splitFrom);
    const merged = [...originals, newSchedule];
    const split = splitByWorkingHours(merged, state.workingHours, state.defaultWH, state.userTz);
    const existingIds = new Set(state.schedules.map(s => s.id));
    await syncSchedules(user.id, existingIds, split);
    return split;
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
    // Track 1.5 phase 3: ownership + loadState 통합 batch (categoryId 변경 시만)
    const state = await loadUserState(user.id, input.categoryId);
    const target = state.schedules.find(s => s.id === input.id);
    if (!target) throw new ServerActionError('serverError.scheduleNotFound');

    // logic-critic Critical #2: cascade input 에서 part 제외 (splitFrom != null).
    // part 들은 split 단계에서 deterministic ID 로 재생성됨.
    const originals = state.schedules.filter(s => !s.splitFrom);

    // logic-critic Major: 메타 patch 를 cascade 전에 적용 (chainedToPrev 변경이 cascade 에 즉시 반영)
    const metaPatched = originals.map(s =>
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

    // split 가 deterministic ID 로 part 재생성 (idempotent — Critical #1).
    const split = splitByWorkingHours(cascaded, state.workingHours, state.defaultWH, state.userTz);
    const existingIds = new Set(state.schedules.map(s => s.id));
    await syncSchedules(user.id, existingIds, split);
    return split;
  });
}

export async function deleteSchedule(id: string): Promise<ServerActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    // self-FK cascade 가 splitFrom=id 인 part 들 동반 삭제 (Stage 21)
    // settings.pinned_active_id FK set null 로 stale pin 자동 해제 (Stage 20)
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

    // logic-critic Critical #1·#2: cascade·split input 에서 part 제외
    const originals = state.schedules.filter(s => !s.splitFrom);
    const originalDuration = target.durationMin;
    const actualMin = Math.max(0, Math.round((input.completeAtMs - target.startAt) / 60_000));

    // cascade 는 delta 계산 위해 actualMin 을 newDuration 으로 받음 (뒤 chain shift).
    // 그러나 edited schedule 자체는 durationMin 원래 값 보존 + actualDurationMin 별도 patch
    // (logic-critic Critical #3 — planned vs actual 비교 데이터 보존).
    const cascaded = cascade(originals, input.id, target.startAt, actualMin).map(s =>
      s.id === input.id
        ? {
            ...s,
            durationMin: originalDuration,
            status: 'done' as const,
            actualDurationMin: actualMin
          }
        : s
    );

    const split = splitByWorkingHours(cascaded, state.workingHours, state.defaultWH, state.userTz);
    const existingIds = new Set(state.schedules.map(s => s.id));
    await syncSchedules(user.id, existingIds, split);
    return split;
  });
}

/**
 * Stage 22: orphan split 자동 정리.
 * splitFrom 가 가리키는 원본이 schedules 에 없으면 그 part 삭제.
 * DB self-FK cascade 가 정상 경로에선 처리하지만, 외부 데이터 import·과거 fixture 잔존 시 안전망.
 *
 * Track 1.5 fix (2026-04-29): db.transaction → db.batch (atomic, rollback 보장)
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
