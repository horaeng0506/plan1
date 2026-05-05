/**
 * buildHourOptions / floorToHourMs 검증 (PLAN1-FOCUS-VIEW-REDESIGN-20260506).
 *
 * PICT 환원: nowHour ∈ {0,9,12,21,23} × nowMinute ∈ {0,30,59}
 *   - hour boundary floor (분 절삭)
 *   - tomorrow 플래그 분기 (자정 통과 검증)
 *   - 24개 fixed length
 */

import {describe, it, expect} from 'vitest';
import {buildHourOptions, floorToHourMs} from './hour-options';

function ymdms(y: number, m: number, d: number, h: number, mm = 0): number {
  return new Date(y, m - 1, d, h, mm, 0, 0).getTime();
}

describe('buildHourOptions — 동적 24h hour select 옵션', () => {
  it('1. 24개 옵션 고정 (mount 시점 무관)', () => {
    expect(buildHourOptions(ymdms(2026, 5, 6, 9))).toHaveLength(24);
    expect(buildHourOptions(ymdms(2026, 5, 6, 23, 59))).toHaveLength(24);
    expect(buildHourOptions(ymdms(2026, 5, 6, 0))).toHaveLength(24);
  });

  it('2. 9:00 진입 → 첫 옵션 9시 today · 마지막 8시 (내일)', () => {
    const opts = buildHourOptions(ymdms(2026, 5, 6, 9));
    expect(opts[0]).toEqual({
      value: ymdms(2026, 5, 6, 9),
      hourLabel: 9,
      isTomorrow: false
    });
    expect(opts[14]).toEqual({
      value: ymdms(2026, 5, 6, 23),
      hourLabel: 23,
      isTomorrow: false
    });
    expect(opts[15]).toEqual({
      value: ymdms(2026, 5, 7, 0),
      hourLabel: 0,
      isTomorrow: true
    });
    expect(opts[23]).toEqual({
      value: ymdms(2026, 5, 7, 8),
      hourLabel: 8,
      isTomorrow: true
    });
  });

  it('3. 21:35 진입 → hour boundary floor 21시 · today/tomorrow 분기', () => {
    const opts = buildHourOptions(ymdms(2026, 5, 6, 21, 35));
    expect(opts[0]).toEqual({
      value: ymdms(2026, 5, 6, 21),
      hourLabel: 21,
      isTomorrow: false
    });
    expect(opts[2]).toEqual({
      value: ymdms(2026, 5, 6, 23),
      hourLabel: 23,
      isTomorrow: false
    });
    expect(opts[3]).toEqual({
      value: ymdms(2026, 5, 7, 0),
      hourLabel: 0,
      isTomorrow: true
    });
    expect(opts[23]).toEqual({
      value: ymdms(2026, 5, 7, 20),
      hourLabel: 20,
      isTomorrow: true
    });
  });

  it('4. 23:30 진입 → 첫 옵션 23 today · 둘째부터 (내일)', () => {
    const opts = buildHourOptions(ymdms(2026, 5, 6, 23, 30));
    expect(opts[0].isTomorrow).toBe(false);
    expect(opts[0].hourLabel).toBe(23);
    expect(opts[1].isTomorrow).toBe(true);
    expect(opts[1].hourLabel).toBe(0);
  });

  it('5. 0:00 진입 → 24개 모두 same day (today) — 자정 직후 케이스', () => {
    const opts = buildHourOptions(ymdms(2026, 5, 6, 0));
    expect(opts[0].hourLabel).toBe(0);
    expect(opts[0].isTomorrow).toBe(false);
    expect(opts[23].hourLabel).toBe(23);
    expect(opts[23].isTomorrow).toBe(false);
  });

  it('6. 0:30 진입 → hour floor 0시 · 24개 today', () => {
    const opts = buildHourOptions(ymdms(2026, 5, 6, 0, 30));
    expect(opts[0]).toEqual({
      value: ymdms(2026, 5, 6, 0),
      hourLabel: 0,
      isTomorrow: false
    });
    expect(opts[23].isTomorrow).toBe(false);
  });

  it('7. 12:00 진입 → 12개 today + 12개 tomorrow', () => {
    const opts = buildHourOptions(ymdms(2026, 5, 6, 12));
    const todayCount = opts.filter(o => !o.isTomorrow).length;
    const tomorrowCount = opts.filter(o => o.isTomorrow).length;
    expect(todayCount).toBe(12);
    expect(tomorrowCount).toBe(12);
  });
});

describe('floorToHourMs — hour boundary floor + remainder 분리', () => {
  it('1. 10:30 → hourMs=10:00, remainder=30', () => {
    const ms = ymdms(2026, 5, 6, 10, 30);
    const result = floorToHourMs(ms);
    expect(result.hourMs).toBe(ymdms(2026, 5, 6, 10));
    expect(result.remainderMin).toBe(30);
  });

  it('2. 11:00 (정시) → hourMs=11:00, remainder=0', () => {
    const ms = ymdms(2026, 5, 6, 11);
    const result = floorToHourMs(ms);
    expect(result.hourMs).toBe(ms);
    expect(result.remainderMin).toBe(0);
  });

  it('3. 11:59 → hourMs=11:00, remainder=59', () => {
    const ms = ymdms(2026, 5, 6, 11, 59);
    const result = floorToHourMs(ms);
    expect(result.hourMs).toBe(ymdms(2026, 5, 6, 11));
    expect(result.remainderMin).toBe(59);
  });

  it('4. 23:45 → hourMs=23:00, remainder=45', () => {
    const ms = ymdms(2026, 5, 6, 23, 45);
    const result = floorToHourMs(ms);
    expect(result.hourMs).toBe(ymdms(2026, 5, 6, 23));
    expect(result.remainderMin).toBe(45);
  });

  it('5. 0:01 → hourMs=0:00, remainder=1', () => {
    const ms = ymdms(2026, 5, 6, 0, 1);
    const result = floorToHourMs(ms);
    expect(result.hourMs).toBe(ymdms(2026, 5, 6, 0));
    expect(result.remainderMin).toBe(1);
  });
});
