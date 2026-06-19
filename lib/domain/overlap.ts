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

/**
 * 주어진 스케줄 집합의 최대 동시 진행 수가 `max` 를 초과하는지 판정 (서버측 overlap 검증).
 *
 * plan1-mobile A1 (logic m4): MAX_OVERLAP 위반은 지금까지 클라이언트만 막았다 →
 * REST API 우회 시 무방비. mutation 결과(next) 전체를 sweep-line 으로 검사해 위반을 거부한다.
 *
 * 의미: `max=2` 면 동시 2개까지 허용·3개+ 차단 (findOverlapping 정책과 정합).
 * 규칙 (findOverlapping 과 동일):
 *   - done 상태는 동시 점유 아님 (제외)
 *   - back-to-back (a.endAt === b.startAt) 은 overlap 아님 → 같은 시각에 end(-1)를 start(+1)보다
 *     먼저 처리해 이중 계수 방지
 *   - durationMin ≤ 0 (점유 구간 없음) 은 무시
 */
export function exceedsMaxOverlap(schedules: Schedule[], max: number): boolean {
  return maxConcurrency(schedules) > max;
}

/**
 * 주어진 스케줄 집합의 최대 동시 진행 수 (sweep-line). done·점유 0 구간 제외,
 * back-to-back 미계수 (exceedsMaxOverlap 과 동일 규칙).
 */
export function maxConcurrency(schedules: Schedule[]): number {
  const events: Array<{t: number; delta: number}> = [];
  for (const s of schedules) {
    if (s.status === 'done') continue;
    const end = s.startAt + s.durationMin * 60_000;
    if (end <= s.startAt) continue;
    events.push({t: s.startAt, delta: 1});
    events.push({t: end, delta: -1});
  }
  // 같은 시각: end(-1) 를 start(+1) 보다 먼저 → back-to-back 미계수.
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let concurrent = 0;
  let peak = 0;
  for (const e of events) {
    concurrent += e.delta;
    if (concurrent > peak) peak = concurrent;
  }
  return peak;
}

/**
 * mutation(prev→next)이 overlap 한계를 **새로** 위반하는지 (delta 스코프 · PLAN1-OVERLAP-FIX-20260619).
 *
 * 정책: "이번 변경이 만든 신규 위반만 거부". 과거 누적(prev 가 이미 위반)으로 인한 무관한 거부 차단.
 *   - next 의 최대 동시수가 `max` 와 prev 의 최대 동시수 중 큰 값을 초과할 때만 위반.
 *   - 즉 깨끗한 상태(prev≤max)에서는 max 초과 차단, 이미 위반(prev>max) 상태에서는 "더 악화"만 차단.
 *
 * 근거: loadUserState 가 전 날짜 전체를 로드 → 과거 미완료 누적이 무관한 생성을 422 로 거부하던 버그.
 */
export function mutationExceedsOverlap(prev: Schedule[], next: Schedule[], max: number): boolean {
  const limit = Math.max(max, maxConcurrency(prev));
  return maxConcurrency(next) > limit;
}
