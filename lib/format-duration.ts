/**
 * PLAN1-TASKS-BUCKET-20260511 — duration h:mm format util.
 *
 * 사양 (대장 confirm 받음):
 *   - 30분 → "0:30"
 *   - 60분 → "1:00"
 *   - 200분 → "3:20"
 *   - 600분 (10시간) 이상 → "hh:mm" (예: "10:00" · "20:34")
 *   - null/0/음수/NaN/Infinity/소수점 → '' (defensive)
 *
 * 적용 범위 (대장 confirm): TaskList row 의 task.durationMin 표시만.
 * TaskModal 입력 필드는 분 단위 그대로 (라벨 "소요 (분)" 유지).
 */

export function formatDurationHm(min: number | null | undefined): string {
  if (min === null || min === undefined) return '';
  if (!Number.isFinite(min)) return '';
  const total = Math.floor(min);
  if (total <= 0) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  const mm = String(m).padStart(2, '0');
  // h >= 10 시 hh:mm 자동 박힘 (10:00 · 99:59 · String(10).padStart(2, '0') = '10' 자연).
  return `${h}:${mm}`;
}
