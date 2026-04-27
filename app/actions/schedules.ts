'use server';

/**
 * 스케줄 CRUD + cascade(Stage 18) + cleanOrphans(Stage 22) server actions.
 *
 * split(Stage 9 working-hours 기반 분할) 은 working-hours.ts 가 트리거하지만
 * createSchedule/updateSchedule 도 split 재계산 필요 → 같은 패턴 재사용.
 *
 * 도메인 함수는 number(ms) 입출력. DB Date 변환은 rowToDomain·domainToRow 책임.
 */

import {randomUUID} from 'node:crypto';
import {and, eq, isNotNull} from 'drizzle-orm';
import {revalidatePath} from 'next/cache';
import {db} from '@/lib/db';
import {plan1Schedules, plan1WorkingHours, plan1Settings} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
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

async function loadUserState(userId: string): Promise<{
  schedules: Schedule[];
  workingHours: Record<string, WorkingHours>;
  defaultWH: {startMin: number; endMin: number};
}> {
  const [scheduleRows, whRows, settingsRow] = await Promise.all([
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

  return {
    schedules: scheduleRows.map(rowToDomain),
    workingHours,
    defaultWH
  };
}

/**
 * cascade·split 결과 schedule[] 을 DB 와 동기화.
 * 단순 패턴: 신규 = INSERT, 기존 = UPDATE, DB 에 있으나 결과에 없는 것 = DELETE.
 * transaction 으로 atomic 보장.
 */
async function syncSchedules(userId: string, next: Schedule[]): Promise<void> {
  await db.transaction(async tx => {
    const existing = await tx
      .select({id: plan1Schedules.id})
      .from(plan1Schedules)
      .where(eq(plan1Schedules.userId, userId));
    const existingIds = new Set(existing.map(r => r.id));
    const nextIds = new Set(next.map(s => s.id));

    // DELETE
    for (const id of Array.from(existingIds)) {
      if (!nextIds.has(id)) {
        await tx
          .delete(plan1Schedules)
          .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, userId)));
      }
    }

    // UPSERT
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
      if (existingIds.has(s.id)) {
        await tx
          .update(plan1Schedules)
          .set(values)
          .where(and(eq(plan1Schedules.id, s.id), eq(plan1Schedules.userId, userId)));
      } else {
        await tx.insert(plan1Schedules).values(values);
      }
    }
  });
}

export async function listSchedules(): Promise<Schedule[]> {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(plan1Schedules)
    .where(eq(plan1Schedules.userId, user.id));
  return rows.map(rowToDomain);
}

export async function createSchedule(input: {
  title: string;
  categoryId: string;
  startAt: number;
  durationMin: number;
  timerType: 'countup' | 'timer1' | 'countdown';
  chainedToPrev?: boolean;
}): Promise<Schedule[]> {
  const user = await requireUser();
  const state = await loadUserState(user.id);
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
  // logic-critic Critical #1·#2: split input 은 원본만 (기존 part 는 split 이 deterministic ID 로 재생성)
  const originals = state.schedules.filter(s => !s.splitFrom);
  const merged = [...originals, newSchedule];
  const split = splitByWorkingHours(merged, state.workingHours, state.defaultWH);
  await syncSchedules(user.id, split);
  revalidatePath('/');
  return split;
}

export async function updateSchedule(input: {
  id: string;
  startAt?: number;
  durationMin?: number;
  title?: string;
  categoryId?: string;
  timerType?: 'countup' | 'timer1' | 'countdown';
  chainedToPrev?: boolean;
}): Promise<Schedule[]> {
  const user = await requireUser();
  const state = await loadUserState(user.id);
  const target = state.schedules.find(s => s.id === input.id);
  if (!target) throw new Error('Schedule not found');

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
  const split = splitByWorkingHours(cascaded, state.workingHours, state.defaultWH);
  await syncSchedules(user.id, split);
  revalidatePath('/');
  return split;
}

export async function deleteSchedule(id: string): Promise<void> {
  const user = await requireUser();
  // self-FK cascade 가 splitFrom=id 인 part 들 동반 삭제 (Stage 21)
  // settings.pinned_active_id FK set null 로 stale pin 자동 해제 (Stage 20)
  await db
    .delete(plan1Schedules)
    .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, user.id)));
  revalidatePath('/');
}

export async function completeSchedule(input: {
  id: string;
  completeAtMs: number;
}): Promise<Schedule[]> {
  const user = await requireUser();
  const state = await loadUserState(user.id);
  const target = state.schedules.find(s => s.id === input.id);
  if (!target) throw new Error('Schedule not found');

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

  const split = splitByWorkingHours(cascaded, state.workingHours, state.defaultWH);
  await syncSchedules(user.id, split);
  revalidatePath('/');
  return split;
}

/**
 * Stage 22: orphan split 자동 정리.
 * splitFrom 가 가리키는 원본이 schedules 에 없으면 그 part 삭제.
 * DB self-FK cascade 가 정상 경로에선 처리하지만, 외부 데이터 import·과거 fixture 잔존 시 안전망.
 */
export async function cleanOrphans(): Promise<void> {
  const user = await requireUser();
  const orphanRows = await db
    .select({id: plan1Schedules.id, splitFrom: plan1Schedules.splitFrom})
    .from(plan1Schedules)
    .where(and(eq(plan1Schedules.userId, user.id), isNotNull(plan1Schedules.splitFrom)));

  if (orphanRows.length === 0) return;

  const allIds = new Set(
    (
      await db
        .select({id: plan1Schedules.id})
        .from(plan1Schedules)
        .where(eq(plan1Schedules.userId, user.id))
    ).map(r => r.id)
  );

  const toDelete = orphanRows.filter(r => r.splitFrom && !allIds.has(r.splitFrom)).map(r => r.id);
  if (toDelete.length === 0) return;

  await db.transaction(async tx => {
    for (const id of toDelete) {
      await tx
        .delete(plan1Schedules)
        .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, user.id)));
    }
  });
  revalidatePath('/');
}
