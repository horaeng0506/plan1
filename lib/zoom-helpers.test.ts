/**
 * PLAN1-ZOOM-PX-PER-HOUR-20260509 — zoom-helpers 단위 spec.
 *
 * 케이스 환원 (test-case-design-principles.md § 1.2):
 *   1 변수 (number) → EP/BVA 만 (PICT 미적용 — 변수 2 미만)
 *   - clampZoomPxPerHour: under-min · at-min · in-range · at-max · over-max · invalid (NaN/Infinity)
 *   - zoomDenseSlotDuration: 119 (under threshold) · 120 (at) · 121 (above) — BVA
 *   - zoomSlotHeightPx: 30분 분기 / 10분 분기 양쪽 + threshold 경계
 */

import {describe, it, expect} from 'vitest';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  ZOOM_DENSE_THRESHOLD,
  clampZoomPxPerHour,
  zoomDenseSlotDuration,
  zoomSlotHeightPx
} from './zoom-helpers';

describe('zoom-helpers — constants', () => {
  it('min/max/step 박힌 값 = UI · server action clamp 정합', () => {
    expect(ZOOM_MIN).toBe(50);
    expect(ZOOM_MAX).toBe(200);
    expect(ZOOM_STEP).toBe(20);
    expect(ZOOM_DENSE_THRESHOLD).toBe(120);
  });
});

describe('clampZoomPxPerHour — EP/BVA', () => {
  it('under min → ZOOM_MIN', () => {
    expect(clampZoomPxPerHour(0)).toBe(ZOOM_MIN);
    expect(clampZoomPxPerHour(-100)).toBe(ZOOM_MIN);
    expect(clampZoomPxPerHour(49)).toBe(ZOOM_MIN);
  });
  it('at min boundary', () => {
    expect(clampZoomPxPerHour(50)).toBe(50);
  });
  it('in range — pass-through (rounded)', () => {
    expect(clampZoomPxPerHour(70)).toBe(70);
    expect(clampZoomPxPerHour(120)).toBe(120);
    expect(clampZoomPxPerHour(199)).toBe(199);
    expect(clampZoomPxPerHour(70.4)).toBe(70);
    expect(clampZoomPxPerHour(70.6)).toBe(71);
  });
  it('at max boundary', () => {
    expect(clampZoomPxPerHour(200)).toBe(200);
  });
  it('over max → ZOOM_MAX', () => {
    expect(clampZoomPxPerHour(201)).toBe(ZOOM_MAX);
    expect(clampZoomPxPerHour(1000)).toBe(ZOOM_MAX);
  });
  it('invalid (NaN · ±Infinity) → ZOOM_MIN (안전 default)', () => {
    expect(clampZoomPxPerHour(NaN)).toBe(ZOOM_MIN);
    expect(clampZoomPxPerHour(Infinity)).toBe(ZOOM_MIN);
    expect(clampZoomPxPerHour(-Infinity)).toBe(ZOOM_MIN);
  });
});

describe('zoomDenseSlotDuration — threshold BVA', () => {
  it('under threshold → 30분 슬롯', () => {
    expect(zoomDenseSlotDuration(50)).toBe('00:30:00');
    expect(zoomDenseSlotDuration(100)).toBe('00:30:00');
    expect(zoomDenseSlotDuration(119)).toBe('00:30:00');
  });
  it('at threshold → 10분 슬롯 (>=)', () => {
    expect(zoomDenseSlotDuration(120)).toBe('00:10:00');
  });
  it('above threshold → 10분 슬롯', () => {
    expect(zoomDenseSlotDuration(121)).toBe('00:10:00');
    expect(zoomDenseSlotDuration(200)).toBe('00:10:00');
  });
});

describe('zoomSlotHeightPx — 분기 정합', () => {
  it('30분 분기 = pxPerHour / 2', () => {
    expect(zoomSlotHeightPx(50)).toBe(25);
    expect(zoomSlotHeightPx(70)).toBe(35);
    expect(zoomSlotHeightPx(100)).toBe(50);
    expect(zoomSlotHeightPx(119)).toBe(59.5);
  });
  it('10분 분기 = pxPerHour / 6', () => {
    expect(zoomSlotHeightPx(120)).toBe(20);
    expect(zoomSlotHeightPx(180)).toBe(30);
    expect(zoomSlotHeightPx(200)).toBeCloseTo(33.333, 2);
  });
  it('threshold 경계 (119 → 30분 / 120 → 10분) 분기 일치', () => {
    expect(zoomSlotHeightPx(119)).toBe(59.5); // 119/2
    expect(zoomSlotHeightPx(120)).toBe(20); // 120/6 (slot duration 변환됨)
  });
});
