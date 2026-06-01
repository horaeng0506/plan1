'use server';

/**
 * PLAN1-FUTURE-DATE-MARKS-20260601 — 달력 미래 날짜 색 마킹 server actions.
 *
 * 색 순환: 무색(행 없음) → red → green → blue → 무색(행 삭제). 클릭마다 한 단계.
 *
 * 보안: 모든 action 진입 시 requireUser() 강제. 모든 query 에 WHERE user_id = session.user.id.
 *
 * 정책:
 *   - dateKey = 'YYYY-MM-DD' (클라이언트 로컬 날짜). 서버는 미래/과거 판정 안 함 —
 *     클라이언트가 자기 로컬 todayKey 기준으로 미래 날짜에만 원을 렌더 → 색칠한 날짜가
 *     오늘이 되면 자동으로 안 보임 (DB cleanup 불요).
 *   - rotate 는 전체 목록 SELECT 후 in-memory 합성 반환 (neon-http read-after-write race 가드).
 */

import {randomUUID} from 'node:crypto';
import {and, eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1FutureDateMarks} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {runAction, type ServerActionResult} from '@/lib/server-action';
import type {DateMark, DateMarkColor} from '@/lib/domain/types';

type Row = typeof plan1FutureDateMarks.$inferSelect;

function rowToDomain(row: Row): DateMark {
  return {dateKey: row.dateKey, color: row.color};
}

// 색 순환 다음 단계. blue → null = 무색(행 삭제).
const NEXT_COLOR: Record<DateMarkColor, DateMarkColor | null> = {
  red: 'green',
  green: 'blue',
  blue: null
};

export async function listDateMarks(): Promise<ServerActionResult<DateMark[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(plan1FutureDateMarks)
      .where(eq(plan1FutureDateMarks.userId, user.id));
    return rows.map(rowToDomain);
  });
}

/**
 * 한 날짜 마크를 다음 색으로 회전. 전체 마크 목록 반환 (race-free in-memory 합성).
 *   - 행 없음 → red INSERT
 *   - red → green / green → blue UPDATE
 *   - blue → DELETE (무색)
 */
export async function rotateDateMark(input: {
  dateKey: string;
}): Promise<ServerActionResult<DateMark[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const dateKey = input.dateKey;
    // 기존 전체 목록 1회 SELECT (in-memory 합성용 · race-free).
    const rows = await db
      .select()
      .from(plan1FutureDateMarks)
      .where(eq(plan1FutureDateMarks.userId, user.id));
    const existing = rows.find(r => r.dateKey === dateKey);

    if (!existing) {
      // 무색 → red INSERT (onConflictDoNothing 으로 동시 클릭 race 흡수).
      await db
        .insert(plan1FutureDateMarks)
        .values({
          id: `fdm-${randomUUID()}`,
          userId: user.id,
          dateKey,
          color: 'red'
        })
        .onConflictDoNothing();
      return [...rows.map(rowToDomain), {dateKey, color: 'red'}];
    }

    const next = NEXT_COLOR[existing.color];
    if (next === null) {
      // blue → 무색 DELETE.
      await db
        .delete(plan1FutureDateMarks)
        .where(
          and(
            eq(plan1FutureDateMarks.userId, user.id),
            eq(plan1FutureDateMarks.dateKey, dateKey)
          )
        );
      return rows.filter(r => r.dateKey !== dateKey).map(rowToDomain);
    }

    // red → green / green → blue UPDATE.
    await db
      .update(plan1FutureDateMarks)
      .set({color: next, updatedAt: new Date()})
      .where(
        and(
          eq(plan1FutureDateMarks.userId, user.id),
          eq(plan1FutureDateMarks.dateKey, dateKey)
        )
      );
    return rows.map(r => (r.dateKey === dateKey ? {dateKey, color: next} : rowToDomain(r)));
  });
}
