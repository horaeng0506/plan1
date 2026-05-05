import type { Schedule } from './types';

/**
 * 같은 시간 overlap 한계 — 동시 진행 가능 schedule 수 (PLAN1-TIMER-DUP-20260504).
 *
 * 정책 (대장 2026-05-04 결정):
 *   - 같은 시각 (overlap) schedule 최대 2개까지 허용
 *   - 3건+ 차단 (UI alert · 사용자 인지)
 *   - 동시 진행 시 ActiveTimer 가 2개 timer 동시 표시
 */
export const MAX_OVERLAP = 2;

/**
 * 주어진 [startAt, startAt + durationMin*60_000) 구간과 겹치는 미완료 schedule 반환.
 *
 * 정의:
 *   - overlap = `s.startAt < newEnd && newStart < s.startAt + s.durationMin*60_000`
 *   - 끝점 일치 (back-to-back) 는 overlap 아님 (`a.endAt === b.startAt` 통과)
 *   - status === 'done' 인 schedule 은 무시 (완료는 동시 점유 아님)
 *   - excludeId 일치 schedule 도 무시 (edit 모드에서 자기 자신 제외)
 */
export function findOverlapping(
  schedules: Schedule[],
  startAt: number,
  durationMin: number,
  excludeId?: string
): Schedule[] {
  const endAt = startAt + durationMin * 60_000;
  return schedules.filter(s =>
    s.id !== excludeId &&
    s.status !== 'done' &&
    s.startAt < endAt &&
    startAt < s.startAt + s.durationMin * 60_000
  );
}
