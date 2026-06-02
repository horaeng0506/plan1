/**
 * PLAN1-FUTURE-DATE-MARKS 색 순환 단일 원천.
 *
 * 클라이언트(낙관적 UI · store.rotateDateMark)와 서버(app/actions/date-marks.ts)가
 * 같은 순환 규칙을 공유해 drift 를 차단한다. 무색(마크 없음) → red → green → blue → 무색.
 */

import type {DateMark, DateMarkColor} from './domain/types';

// 색 순환 다음 단계. blue → null = 무색(마크 제거).
export const NEXT_DATE_MARK_COLOR: Record<DateMarkColor, DateMarkColor | null> = {
  red: 'green',
  green: 'blue',
  blue: null
};

/**
 * 한 날짜 클릭 시 다음 마크 목록을 계산 (순수 함수 · 낙관적 UI 즉시 반영용).
 * 서버 rotateDateMark 의 INSERT/UPDATE/DELETE 와 동일한 결과를 메모리에서 산출.
 */
export function rotateDateMarkList(marks: DateMark[], dateKey: string): DateMark[] {
  const existing = marks.find(m => m.dateKey === dateKey);
  if (!existing) return [...marks, {dateKey, color: 'red'}];
  const next = NEXT_DATE_MARK_COLOR[existing.color];
  if (next === null) return marks.filter(m => m.dateKey !== dateKey);
  return marks.map(m => (m.dateKey === dateKey ? {dateKey, color: next} : m));
}
