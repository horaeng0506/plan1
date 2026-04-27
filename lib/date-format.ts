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
