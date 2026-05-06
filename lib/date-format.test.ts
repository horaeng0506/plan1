/**
 * formatDateShort / formatDateRangeLabel 검증 (PLAN1-FOCUS-VIEW-REDESIGN-V2-S0).
 *
 * PICT 환원: month boundary × day boundary × weekday 7개 × 자정 통과 여부
 *   - 같은 날 / 다른 날 같은 달 / 다른 달
 *   - weekday i18n 매핑 (한글 약어)
 */

import {describe, it, expect} from 'vitest';
import {formatDateShort, formatDateRangeLabel} from './date-format';

const KO_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const koLabel = (w: number) => KO_WEEKDAYS[w] ?? '';

function ymdms(y: number, m: number, d: number, h = 0): number {
  return new Date(y, m - 1, d, h, 0, 0, 0).getTime();
}

describe('formatDateShort — 5.6(수) 형식', () => {
  it('1. 5.6(수)', () => {
    const d = new Date(2026, 4, 6); // 2026-05-06 = 수요일
    expect(formatDateShort(d, koLabel)).toBe('5.6(수)');
  });

  it('2. 12.31(목)', () => {
    const d = new Date(2026, 11, 31); // 2026-12-31 = 목요일
    expect(formatDateShort(d, koLabel)).toBe('12.31(목)');
  });

  it('3. 1.1(금) 신년', () => {
    const d = new Date(2027, 0, 1); // 2027-01-01 = 금요일
    expect(formatDateShort(d, koLabel)).toBe('1.1(금)');
  });
});

describe('formatDateRangeLabel — 자정 boundary', () => {
  it('1. 같은 날 → 단일 라벨 5.6(수)', () => {
    const start = ymdms(2026, 5, 6, 8);
    const end = ymdms(2026, 5, 6, 20);
    expect(formatDateRangeLabel(start, end, koLabel)).toBe('5.6(수)');
  });

  it('2. 다음 날 (같은 달) → 5.6(수)-7', () => {
    const start = ymdms(2026, 5, 6, 22);
    const end = ymdms(2026, 5, 7, 6);
    expect(formatDateRangeLabel(start, end, koLabel)).toBe('5.6(수)-7');
  });

  it('3. 월 boundary 통과 → 5.31(일)-6.1', () => {
    const start = ymdms(2026, 5, 31, 22);
    const end = ymdms(2026, 6, 1, 6);
    expect(formatDateRangeLabel(start, end, koLabel)).toBe('5.31(일)-6.1');
  });

  it('4. 24h 후 같은 날 (boundary 안 통과) → 단일 라벨', () => {
    const start = ymdms(2026, 5, 6, 0);
    const end = ymdms(2026, 5, 6, 23);
    expect(formatDateRangeLabel(start, end, koLabel)).toBe('5.6(수)');
  });

  it('5. 자정 직전 → 같은 날', () => {
    const start = ymdms(2026, 5, 6, 23);
    const end = new Date(2026, 4, 6, 23, 59, 59).getTime();
    expect(formatDateRangeLabel(start, end, koLabel)).toBe('5.6(수)');
  });

  it('6. 자정 직후 → 다음 날', () => {
    const start = ymdms(2026, 5, 6, 23);
    const end = new Date(2026, 4, 7, 0, 0, 1).getTime();
    expect(formatDateRangeLabel(start, end, koLabel)).toBe('5.6(수)-7');
  });
});
