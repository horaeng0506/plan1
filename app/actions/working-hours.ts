'use server';

/**
 * 근무시간 CRUD + split 재계산 (Stage 9).
 *
 * 정책:
 *   - (user_id, date) UNIQUE — 같은 날짜 중복 금지 (DB INDEX 로 enforce)
 *   - 근무시간 변경 시 schedules 의 split 재계산 (Stage 9 마감 초과 split/이월)
 *
 * Stage 5.1 part 2: 사용자 facing error 는 ServerActionError throw → runAction 변환.
 */

import {randomUUID} from 'node:crypto';
import {and, eq, inArray} from 'drizzle-orm';
import type {BatchItem} from 'drizzle-orm/batch';
import {db} from '@/lib/db';
import {plan1WorkingHours, plan1Schedules, plan1Settings} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {runAction, ServerActionError, type ServerActionResult} from '@/lib/server-action';
import {splitByWorkingHours} from '@/lib/domain/split';
import type {WorkingHours, Schedule} from '@/lib/domain/types';

function rowToDomain(row: typeof plan1WorkingHours.$inferSelect): WorkingHours {
  return {date: row.date, startMin: row.startMin, endMin: row.endMin};
}

function scheduleRowToDomain(row: typeof plan1Schedules.$inferSelect): Schedule {
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

async function applySplitForUser(userId: string): Promise<void> {
  // Track 1.5 fix (2026-04-29): Promise.all → db.batch (1 RTT). transaction loop → db.batch (1 RTT atomic)
  const [scheduleRows, whRows, settingsRow] = await db.batch([
    db.select().from(plan1Schedules).where(eq(plan1Schedules.userId, userId)),
    db.select().from(plan1WorkingHours).where(eq(plan1WorkingHours.userId, userId)),
    db.select().from(plan1Settings).where(eq(plan1Settings.userId, userId)).limit(1)
  ]);
  const workingHours: Record<string, WorkingHours> = {};
  for (const wh of whRows) workingHours[wh.date] = rowToDomain(wh);
  const defaultWH = settingsRow[0]
    ? {
        startMin: settingsRow[0].defaultWorkingHoursStartMin,
        endMin: settingsRow[0].defaultWorkingHoursEndMin
      }
    : {startMin: 540, endMin: 1080};

  const before = scheduleRows.map(scheduleRowToDomain);
  // logic-critic Critical #1·#2: split input 은 원본만. 기존 part 는 split 가 deterministic ID 로 재생성.
  const originals = before.filter(s => !s.splitFrom);
  const after = splitByWorkingHours(originals, workingHours, defaultWH);

  const beforeIds = new Set(before.map(s => s.id));
  const afterIds = new Set(after.map(s => s.id));

  const queries: BatchItem<'pg'>[] = [];
  for (const id of Array.from(beforeIds)) {
    if (!afterIds.has(id)) {
      queries.push(
        db
          .delete(plan1Schedules)
          .where(and(eq(plan1Schedules.id, id), eq(plan1Schedules.userId, userId)))
      );
    }
  }
  // logic-critic [높] race fix (2026-04-29): INSERT/UPDATE 분기 → ON CONFLICT (id) DO UPDATE.
  // beforeIds (batch1 snapshot) 와 afterIds 차이로 분기하던 race 표면 제거.
  for (const s of after) {
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

export async function listWorkingHours(): Promise<ServerActionResult<WorkingHours[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(plan1WorkingHours)
      .where(eq(plan1WorkingHours.userId, user.id));
    return rows.map(rowToDomain);
  });
}

// ship-gate code-review Medium (2026-04-28): server-side 입력 검증.
// 음수·>1440·s>=e 조건은 client UI 가드 외에 server 에서도 강제 (조작 가능 헤더·API 직접 호출 대비).
function assertWorkingHoursInput(startMin: number, endMin: number): void {
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin)) {
    throw new ServerActionError('error.workingHoursInvalid', {reason: 'non-integer'});
  }
  if (startMin < 0 || startMin > 1440 || endMin < 0 || endMin > 1440) {
    throw new ServerActionError('error.workingHoursInvalid', {reason: 'out-of-range'});
  }
  if (startMin >= endMin) {
    throw new ServerActionError('error.workingHoursInvalid', {reason: 'start-not-before-end'});
  }
}

export async function setWorkingHours(input: {
  date: string;
  startMin: number;
  endMin: number;
}): Promise<ServerActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    assertWorkingHoursInput(input.startMin, input.endMin);
    // upsert by (user_id, date) UNIQUE
    const existing = await db
      .select({id: plan1WorkingHours.id})
      .from(plan1WorkingHours)
      .where(and(eq(plan1WorkingHours.userId, user.id), eq(plan1WorkingHours.date, input.date)))
      .limit(1);
    if (existing[0]) {
      await db
        .update(plan1WorkingHours)
        .set({startMin: input.startMin, endMin: input.endMin, updatedAt: new Date()})
        .where(eq(plan1WorkingHours.id, existing[0].id));
    } else {
      await db.insert(plan1WorkingHours).values({
        id: `wh-${randomUUID()}`,
        userId: user.id,
        date: input.date,
        startMin: input.startMin,
        endMin: input.endMin
      });
    }
    await applySplitForUser(user.id);
  });
}

export async function bulkSetWorkingHours(input: {
  dates: string[];
  startMin: number;
  endMin: number;
}): Promise<ServerActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    assertWorkingHoursInput(input.startMin, input.endMin);
    const existing = await db
      .select({id: plan1WorkingHours.id, date: plan1WorkingHours.date})
      .from(plan1WorkingHours)
      .where(and(eq(plan1WorkingHours.userId, user.id), inArray(plan1WorkingHours.date, input.dates)));
    const existingDates = new Map(existing.map(r => [r.date, r.id]));

    // Track 1.5 fix (2026-04-29): transaction loop → db.batch (1 RTT atomic)
    const queries: BatchItem<'pg'>[] = [];
    for (const date of input.dates) {
      const id = existingDates.get(date);
      if (id) {
        queries.push(
          db
            .update(plan1WorkingHours)
            .set({startMin: input.startMin, endMin: input.endMin, updatedAt: new Date()})
            .where(eq(plan1WorkingHours.id, id))
        );
      } else {
        queries.push(
          db.insert(plan1WorkingHours).values({
            id: `wh-${randomUUID()}`,
            userId: user.id,
            date,
            startMin: input.startMin,
            endMin: input.endMin
          })
        );
      }
    }
    if (queries.length > 0) {
      await db.batch(queries as [BatchItem<'pg'>, ...BatchItem<'pg'>[]]);
    }
    await applySplitForUser(user.id);
  });
}

export async function deleteWorkingHours(date: string): Promise<ServerActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    await db
      .delete(plan1WorkingHours)
      .where(and(eq(plan1WorkingHours.userId, user.id), eq(plan1WorkingHours.date, date)));
    await applySplitForUser(user.id);
  });
}
