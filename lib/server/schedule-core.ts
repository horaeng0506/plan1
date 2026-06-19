/**
 * plan1-mobile A1 — 공유 스케줄 mutation 코어 (REST API 전용 · 정공법 단일 코어).
 *
 * 설계 결정 (overview "A1 설계 노트"):
 *   - 도메인 함수(cascade·insertBetweenList·exceedsMaxOverlap)는 이미 순수 → 그대로 재사용.
 *   - web `app/actions/schedules.ts` 의 load→compute→write 흐름을 **동작 동일**하게 미러하되
 *     ① 낙관적 동시성 guard(D1) ② 서버측 overlap 검증(logic m4) 을 write 경로에 내장.
 *   - ⚠️ web server action 은 A1 에서 **건드리지 않는다**. web 의 공유 코어 전환은 A4
 *     (A1.5 characterization test 선결로 public 회귀 차단 · R10). 본 코어는 REST 가 단독 사용.
 *     A4 에서 web server action 을 이 코어로 합류시킨다.
 *
 * IDOR: 모든 query 가 WHERE user_id = userId (멀티테넌트 격리 유일 방어선).
 * neon-http: 모든 write 는 db.batch (원자적 · interactive tx 미지원 issue #4747 · env M2).
 */

import {randomUUID} from 'node:crypto';
import {and, eq} from 'drizzle-orm';
import type {BatchItem} from 'drizzle-orm/batch';
import {db} from '@/lib/db';
import {plan1Categories, plan1Schedules} from '@/lib/db/schema';
import {cascade} from '@/lib/domain/cascade';
import {insertBetweenList} from '@/lib/domain/insert-between';
import {mutationExceedsOverlap, MAX_OVERLAP} from '@/lib/domain/overlap';
import type {Schedule, TimerType} from '@/lib/domain/types';
import {ApiError} from '@/lib/server/api-error';
import {
  buildConcurrencyGuardSql,
  isConcurrencyConflict,
  type SnapshotRow
} from '@/lib/server/concurrency-guard';
import {type WriteGuards, REST_GUARDS, WEB_GUARDS} from '@/lib/server/schedule-guards';

type ScheduleRow = typeof plan1Schedules.$inferSelect;

export type ScheduleErrorCode =
  | 'category_not_found'
  | 'schedule_not_found'
  | 'insert_between_stale'
  | 'insert_between_no_prev'
  | 'overlap_exceeded'
  | 'concurrency_conflict';

const ERROR_STATUS: Record<ScheduleErrorCode, number> = {
  category_not_found: 404,
  schedule_not_found: 404,
  insert_between_stale: 409,
  insert_between_no_prev: 422,
  overlap_exceeded: 422,
  concurrency_conflict: 409
};

/** 핸들러가 status code 로 매핑하는 스케줄 도메인 에러 (ApiError 의 typed 변형). */
export class ScheduleError extends ApiError {
  constructor(code: ScheduleErrorCode) {
    super(code, ERROR_STATUS[code]);
    this.name = 'ScheduleError';
  }
}

// write guard 토글 (db 의존 없는 순수 상수 — schedule-guards 로 분리해 단위 test import 안전).
// 웹 schedules.ts 등 기존 import 경로 보존 위해 re-export.
export {type WriteGuards, REST_GUARDS, WEB_GUARDS};

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
    chainedToPrev: row.chainedToPrev,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime()
  };
}

/**
 * 사용자 스케줄 전체 로드 (스냅샷). ownerCategoryId 주어지면 그 카테고리 소유권도 검증.
 * web loadUserState 와 동일하되 category 미소유 시 ScheduleError('category_not_found').
 */
async function loadUserState(
  userId: string,
  ownerCategoryId?: string
): Promise<{schedules: Schedule[]}> {
  if (ownerCategoryId !== undefined) {
    const [ownerRows, scheduleRows] = await db.batch([
      db
        .select({id: plan1Categories.id})
        .from(plan1Categories)
        .where(and(eq(plan1Categories.id, ownerCategoryId), eq(plan1Categories.userId, userId)))
        .limit(1),
      db.select().from(plan1Schedules).where(eq(plan1Schedules.userId, userId))
    ]);
    if (!ownerRows[0]) throw new ScheduleError('category_not_found');
    return {schedules: scheduleRows.map(rowToDomain)};
  }
  const scheduleRows = await db
    .select()
    .from(plan1Schedules)
    .where(eq(plan1Schedules.userId, userId));
  return {schedules: scheduleRows.map(rowToDomain)};
}

function snapshotRows(schedules: Schedule[]): SnapshotRow[] {
  return schedules.map(s => ({id: s.id, updatedAt: s.updatedAt}));
}

/**
 * cascade 결과 next 를 DB 와 동기화. web syncSchedules 와 동일한 DELETE/UPSERT 패턴에
 *   ① 서버측 overlap 검증(logic m4) ② 낙관적 동시성 guard(D1) 를 추가.
 *
 * @param snapshot loadUserState 시점에 읽은 스케줄(= guard 기준). next 가 아니라 반드시 스냅샷.
 */
async function writeSchedules(
  userId: string,
  snapshot: Schedule[],
  next: Schedule[],
  guards: WriteGuards
): Promise<void> {
  // 서버측 overlap 검증 — 이번 mutation 이 **새로** 만든 위반만 거부 (delta 스코프).
  // PLAN1-OVERLAP-FIX-20260619: 종전 exceedsMaxOverlap(next) 는 전 날짜 전체를 검사해
  // 과거 미완료 누적(loadUserState 가 날짜 무관 전량 로드)으로 무관한 생성까지 422 거부했다.
  // 이제 prev(snapshot) 대비 악화된 경우만 거부 → 누적 데이터로 인한 lock-out 해소.
  // A4-1 웹은 off (기존 동작 불변 · 클라 모달이 차단).
  if (guards.enforceOverlap && mutationExceedsOverlap(snapshot, next, MAX_OVERLAP)) {
    throw new ScheduleError('overlap_exceeded');
  }

  const snapshotIds = new Set(snapshot.map(s => s.id));
  const nextIds = new Set(next.map(s => s.id));
  const queries: BatchItem<'pg'>[] = [];

  // [0] 낙관적 동시성 guard — 스냅샷과 현재 DB 집합 불일치 시 batch 전체 롤백.
  // A4-1 웹은 off (기존 last-write-wins 동작 불변).
  if (guards.enforceConcurrency) {
    queries.push(db.execute(buildConcurrencyGuardSql(userId, snapshotRows(snapshot))));
  }

  // DELETE: 스냅샷에 있었으나 결과에 없는 것.
  for (const id of snapshotIds) {
    if (!nextIds.has(id)) {
      queries.push(
        db
          .delete(plan1Schedules)
          .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, userId)))
      );
    }
  }

  // UPSERT: 결과 전체 (신규 INSERT · 기존 UPDATE).
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
      chainedToPrev: s.chainedToPrev ?? true,
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
            chainedToPrev: values.chainedToPrev,
            updatedAt: values.updatedAt
          }
        })
    );
  }

  // guard off + DELETE/UPSERT 둘 다 없는 경우 (이론상 next 비고 snapshot 비면) no-op.
  if (queries.length === 0) return;

  try {
    await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
  } catch (e) {
    if (guards.enforceConcurrency && isConcurrencyConflict(e)) {
      throw new ScheduleError('concurrency_conflict');
    }
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 공개 코어 API — REST 핸들러가 호출. 각 함수는 결과 Schedule[] (또는 void) 반환.
// ─────────────────────────────────────────────────────────────────────────

export async function listSchedulesCore(userId: string): Promise<Schedule[]> {
  const rows = await db
    .select()
    .from(plan1Schedules)
    .where(eq(plan1Schedules.userId, userId));
  return rows.map(rowToDomain);
}

export interface CreateScheduleInput {
  title: string;
  categoryId: string;
  startAt: number;
  durationMin: number;
  timerType: TimerType;
  chainedToPrev?: boolean;
}

export async function createScheduleCore(
  userId: string,
  input: CreateScheduleInput,
  guards: WriteGuards = REST_GUARDS
): Promise<Schedule[]> {
  const state = await loadUserState(userId, input.categoryId);
  const now = Date.now();
  const newSchedule: Schedule = {
    id: `sch-${randomUUID()}`,
    title: input.title,
    categoryId: input.categoryId,
    startAt: input.startAt,
    durationMin: input.durationMin,
    timerType: input.timerType,
    status: 'pending',
    chainedToPrev: input.chainedToPrev ?? true,
    createdAt: now,
    updatedAt: now
  };
  const next = [...state.schedules, newSchedule];
  await writeSchedules(userId, state.schedules, next, guards);
  return next;
}

export interface UpdateScheduleInput {
  id: string;
  startAt?: number;
  durationMin?: number;
  title?: string;
  categoryId?: string;
  timerType?: TimerType;
  chainedToPrev?: boolean;
}

export async function updateScheduleCore(
  userId: string,
  input: UpdateScheduleInput,
  guards: WriteGuards = REST_GUARDS
): Promise<Schedule[]> {
  const state = await loadUserState(userId, input.categoryId);
  const target = state.schedules.find(s => s.id === input.id);
  if (!target) throw new ScheduleError('schedule_not_found');

  // 메타 patch 를 cascade 전에 적용 (chainedToPrev 변경이 cascade 에 즉시 반영 · web 정합).
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

  const newStartAt = input.startAt ?? target.startAt;
  const newDuration = input.durationMin ?? target.durationMin;
  const cascaded = cascade(metaPatched, input.id, newStartAt, newDuration);

  await writeSchedules(userId, state.schedules, cascaded, guards);
  return cascaded;
}

export async function deleteScheduleCore(userId: string, id: string): Promise<void> {
  // web deleteSchedule 정합 — 단일 row 절대 삭제 (cascade·guard 불요 · 멱등).
  await db
    .delete(plan1Schedules)
    .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, userId)));
}

export interface CompleteScheduleInput {
  id: string;
  completeAtMs: number;
}

export async function completeScheduleCore(
  userId: string,
  input: CompleteScheduleInput,
  guards: WriteGuards = REST_GUARDS
): Promise<Schedule[]> {
  const state = await loadUserState(userId);
  const target = state.schedules.find(s => s.id === input.id);
  if (!target) throw new ScheduleError('schedule_not_found');

  const originalDuration = target.durationMin;
  // 과거(예: 수개월 전) 미완료를 뒤늦게 완료하면 completeAtMs−startAt 가 거대해져 cascade delta 를
  // 오염(후속 chained 일정을 미래로 폭주 이동)시킨다. 일일 플래너 특성상 단일 일정 ≤ 24h 로 clamp.
  // PLAN1-OVERLAP-FIX-20260619.
  const MAX_ACTUAL_MIN = 1440;
  const actualMin = Math.min(MAX_ACTUAL_MIN, Math.max(0, Math.round((input.completeAtMs - target.startAt) / 60_000)));

  // cascade 는 delta 전파에 actualMin 을 쓰되, edited schedule 자체는 durationMin 보존 +
  // actualDurationMin 별도 patch (planned vs actual 보존 · web 정합).
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

  await writeSchedules(userId, state.schedules, cascaded, guards);
  // completedAt 보강 (syncSchedules 는 도메인 기준 write 라 completedAt 미포함 · web 정합).
  await db
    .update(plan1Schedules)
    .set({completedAt: new Date(input.completeAtMs)})
    .where(and(eq(plan1Schedules.id, input.id), eq(plan1Schedules.userId, userId)));
  return cascaded;
}

export interface InsertBetweenInput {
  title: string;
  categoryId: string;
  durationMin: number;
  timerType: TimerType;
  conflictId: string;
  /** 클라가 본 충돌 일정 startAt — server state 불일치 시 TOCTOU 거부. */
  expectedConflictStart: number;
}

export async function insertScheduleBetweenCore(
  userId: string,
  input: InsertBetweenInput,
  guards: WriteGuards = REST_GUARDS
): Promise<Schedule[]> {
  const state = await loadUserState(userId, input.categoryId);
  const conflict = state.schedules.find(s => s.id === input.conflictId);
  if (!conflict || conflict.startAt !== input.expectedConflictStart) {
    throw new ScheduleError('insert_between_stale');
  }
  const now = Date.now();
  const newSchedule: Schedule = {
    id: `sch-${randomUUID()}`,
    title: input.title,
    categoryId: input.categoryId,
    startAt: 0, // insertBetweenList 가 conflict 직전 기준 재계산.
    durationMin: input.durationMin,
    timerType: input.timerType,
    status: 'pending',
    chainedToPrev: true,
    createdAt: now,
    updatedAt: now
  };
  const next = insertBetweenList(state.schedules, newSchedule, input.conflictId);
  if (!next) {
    throw new ScheduleError('insert_between_no_prev');
  }
  await writeSchedules(userId, state.schedules, next, guards);
  return next;
}
