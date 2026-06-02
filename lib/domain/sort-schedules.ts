import type {Schedule} from './types';

/**
 * 스케줄 결정적 정렬 비교자 — startAt → createdAt → id.
 *
 * PLAN1-SCHEDULE-INSERT-BETWEEN-20260602 (logic-critic Critical): 같은 startAt(동률)
 * 일정 그룹의 정렬이 `a.startAt - b.startAt` 만으로는 비결정적(엔진 의존)이 된다.
 * insert-between(사이 삽입 시 같은 startAt 그룹 함께 밀기)과 cascade(편집 delta 전파)가
 * 같은 데이터를 다루므로 동일 비교자를 공유해 drift·비결정성을 차단한다.
 */
export function compareScheduleByStart(a: Schedule, b: Schedule): number {
  return a.startAt - b.startAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}
