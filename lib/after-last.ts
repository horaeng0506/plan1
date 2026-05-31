/**
 * PLAN1-LAST-PLUS-10-20260531 — "마지막+10" 시작 시각 산식 (단일 원천).
 *
 * 마지막(지금 이후 종료) 미완료 스케줄의 종료 시각 + 10분.
 * TaskList(변환 버튼)와 NewScheduleModal(마지막 직후 버튼)이 공유 → drift 차단.
 *
 * 활성(지금 이후 종료) 스케줄이 없으면 null 반환 (호출처가 now fallback 결정).
 */

import type {Schedule} from './domain/types';

export const AFTER_LAST_GAP_MS = 10 * 60_000;

export function afterLastEndAt(schedules: Schedule[], nowMs: number): number | null {
  let maxEnd = 0;
  let has = false;
  for (const s of schedules) {
    if (s.status === 'done') continue;
    const end = s.startAt + s.durationMin * 60_000;
    if (end > nowMs) {
      has = true;
      if (end > maxEnd) maxEnd = end;
    }
  }
  return has ? maxEnd : null;
}

// 마지막 종료 + 10분. 활성 스케줄 없으면 null.
export function afterLastPlus10(schedules: Schedule[], nowMs: number): number | null {
  const end = afterLastEndAt(schedules, nowMs);
  return end === null ? null : end + AFTER_LAST_GAP_MS;
}
