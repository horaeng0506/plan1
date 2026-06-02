import type {Schedule, ScheduleId} from './types';
import {compareScheduleByStart} from './sort-schedules';

const NS = 60_000;

/**
 * PLAN1-SCHEDULE-INSERT-BETWEEN-20260602 — 새 스케줄(A2)을 충돌 스케줄(B) 시작 위치에
 * "사이 삽입". A2가 B 자리로 들어가고, B 이후 chained 연속을 (A2 길이 + 기존 A–B 갭)만큼
 * 뒤로 민다. A–A2 갭 = A2–B 갭 = 기존 A–B 갭 보존.
 *
 * 사양 (대장 2026-06-02):
 *   A·B·C·D 연결 + 각 갭. A2를 B 시작 시간에 "사이 삽입" 선택 시 —
 *   기존 A–B 갭이 10분이면 A–A2 10분 + A2–B 10분, 20분이면 각 20분.
 *
 * 동작:
 *   - conflictStart = B.startAt. A = conflictStart 직전 active 스케줄 (시간순 마지막).
 *     없으면(B가 첫 일정) null 반환 — 옵션② 불가 (P1).
 *   - gap = conflictStart - A.endAt. A2.startAt = A.endAt + gap (= conflictStart).
 *   - delta = A2.durationMin*NS + gap.
 *   - 밀림 범위 (P2): conflictStart 에 시작하는 모든 active(겹친 그룹 함께) + 그 그룹 이후
 *     chainedToPrev 연속. 겹친 2개가 함께 밀려 동시 진행 관계 보존.
 *   - A2.chainedToPrev = true (A–A2–B… 한 체인). done 스케줄은 active 제외 (cascade 일관).
 *
 * @returns 삽입+밀림 적용된 전체 목록, 또는 null(삽입 불가 — B 없음/B 앞 active 없음)
 */
export function insertBetweenList(
  schedules: Schedule[],
  newSchedule: Schedule,
  conflictId: ScheduleId
): Schedule[] | null {
  const b = schedules.find(s => s.id === conflictId);
  if (!b) return null;
  const conflictStart = b.startAt;

  const active = schedules
    .filter(s => s.status !== 'done')
    // 동률(같은 startAt) tie-break — cascade 와 공유 비교자 (logic-critic Critical).
    .sort(compareScheduleByStart);

  // A = conflictStart 직전 active (시간순 마지막). 정렬됐으므로 startAt < conflictStart 마지막.
  let a: Schedule | null = null;
  for (const s of active) {
    if (s.startAt < conflictStart) a = s;
    else break;
  }
  if (!a) return null; // P1: B 앞 active 없음 → 사이 삽입 불가

  const gap = conflictStart - (a.startAt + a.durationMin * NS);
  // gap < 0: A 가 conflictStart 를 넘어 끝나는 비정상 겹침 chained → delta 음수로 앞당김 사양 위반.
  // 사이 삽입 불가 처리 (logic-critic Major).
  if (gap < 0) return null;
  const a2Start = a.startAt + a.durationMin * NS + gap; // = conflictStart (갭 보존)
  const a2: Schedule = {...newSchedule, startAt: a2Start, chainedToPrev: true};
  const delta = a2.durationMin * NS + gap;

  // 밀림 (P2): conflictStart 시작 그룹 전체(겹친 것 함께) + 그룹 이후 chainedToPrev 연속.
  const shiftIds = new Set<ScheduleId>();
  let groupEndIdx = -1;
  for (let i = 0; i < active.length; i++) {
    if (active[i].startAt === conflictStart) {
      shiftIds.add(active[i].id);
      groupEndIdx = i;
    }
  }
  for (let i = groupEndIdx + 1; i < active.length; i++) {
    if (!active[i].chainedToPrev) break;
    shiftIds.add(active[i].id);
  }

  const shifted = schedules.map(s =>
    shiftIds.has(s.id) ? {...s, startAt: s.startAt + delta, updatedAt: Date.now()} : s
  );
  return [...shifted, a2];
}
