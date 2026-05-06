/**
 * 날짜·시간 포맷 헬퍼 통일 (simplify code-reuse 통합).
 *
 * 이전: PlanApp/NewScheduleModal/DailyTimeline/WorkingHoursEditor/ActiveTimer 에
 * pad/dateKey/todayKey/dateKeyFromMs/minToTime/timeToMin 산재. drift 위험 + 14회+
 * inline `String(n).padStart(2,'0')` 패턴.
 */

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function dateKeyFromMs(ms: number): string {
  return dateKey(new Date(ms));
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function minToTime(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 짧은 날짜+요일 라벨 — `5.6(수)` 형식 (PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506).
 * weekday 라벨은 i18n key (`weekdays.0~6`) 영역 — 호출자가 매핑 의무.
 *
 * 사용:
 *   formatDateShort(new Date(), w => t(`weekdays.${w}` as 'weekdays.0'))
 *   → "5.6(수)"
 */
export function formatDateShort(d: Date, weekdayLabel: (w: number) => string): string {
  return `${d.getMonth() + 1}.${d.getDate()}(${weekdayLabel(d.getDay())})`;
}

/**
 * focus window 의 날짜 범위 라벨 — `5.6(수)` 단일 / `5.6(수)-7` 자정 넘는 view.
 * (PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 사양 #2)
 *
 * 사용:
 *   formatDateRangeLabel(startMs, endMs, t)
 *   → 같은 날: "5.6(수)"
 *   → 다른 날: "5.6(수)-7"  (endDay 만 표시 — 같은 달 가정)
 *   → 다른 달: "5.6(수)-6.7"  (월·일 모두 표시)
 */
export function formatDateRangeLabel(
  startMs: number,
  endMs: number,
  weekdayLabel: (w: number) => string
): string {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const startLabel = formatDateShort(start, weekdayLabel);
  if (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate()
  ) {
    return startLabel;
  }
  if (start.getMonth() === end.getMonth()) {
    return `${startLabel}-${end.getDate()}`;
  }
  return `${startLabel}-${end.getMonth() + 1}.${end.getDate()}`;
}
