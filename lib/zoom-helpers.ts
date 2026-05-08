/**
 * PLAN1-ZOOM-PX-PER-HOUR-20260509 — DailyTimeline 시간 간격 줌 helper.
 *
 * default 50 (FullCalendar v6 default 추정 · S6 검증 단계 조정 가능).
 * step 20 · min 50 (default · - 비활성) · max 200 (10분 슬롯 가독성).
 * pxPerHour ≥ ZOOM_DENSE_THRESHOLD 시 slotDuration 30분 → 10분 자동 변환.
 *
 * server action `updateSettings` + DailyTimeline UI 둘 다 같은 clamp 사용.
 */

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 20;
export const ZOOM_DENSE_THRESHOLD = 120;

export function clampZoomPxPerHour(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_MIN;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value)));
}

export function zoomDenseSlotDuration(pxPerHour: number): '00:10:00' | '00:30:00' {
  return pxPerHour >= ZOOM_DENSE_THRESHOLD ? '00:10:00' : '00:30:00';
}

export function zoomSlotHeightPx(pxPerHour: number): number {
  const slot = zoomDenseSlotDuration(pxPerHour);
  return slot === '00:10:00' ? pxPerHour / 6 : pxPerHour / 2;
}
