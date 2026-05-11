import {describe, it, expect} from 'vitest';
import fc from 'fast-check';
import {formatDurationHm} from './format-duration';

describe('formatDurationHm — EP/BVA matrix', () => {
  // Equivalence partitions + Boundary value analysis (test-case-design-principles § 1.2 정합).
  it('null → ""', () => {
    expect(formatDurationHm(null)).toBe('');
  });
  it('undefined → ""', () => {
    expect(formatDurationHm(undefined)).toBe('');
  });
  it('0 → ""', () => {
    expect(formatDurationHm(0)).toBe('');
  });
  it('음수 (-30) → ""', () => {
    expect(formatDurationHm(-30)).toBe('');
  });
  it('NaN → ""', () => {
    expect(formatDurationHm(NaN)).toBe('');
  });
  it('Infinity → ""', () => {
    expect(formatDurationHm(Infinity)).toBe('');
  });

  // h < 1 영역
  it('1 → "0:01"', () => {
    expect(formatDurationHm(1)).toBe('0:01');
  });
  it('30 → "0:30"', () => {
    expect(formatDurationHm(30)).toBe('0:30');
  });
  it('59 → "0:59"', () => {
    expect(formatDurationHm(59)).toBe('0:59');
  });

  // h = 1 boundary
  it('60 → "1:00"', () => {
    expect(formatDurationHm(60)).toBe('1:00');
  });
  it('61 → "1:01"', () => {
    expect(formatDurationHm(61)).toBe('1:01');
  });

  // 200분 대장 예시
  it('200 → "3:20"', () => {
    expect(formatDurationHm(200)).toBe('3:20');
  });

  // 1 < h < 10 영역 boundary
  it('599 → "9:59"', () => {
    expect(formatDurationHm(599)).toBe('9:59');
  });

  // h = 10 boundary (대장 예시 — 10시간부터 hh:mm format 자연 적용)
  it('600 → "10:00"', () => {
    expect(formatDurationHm(600)).toBe('10:00');
  });
  it('601 → "10:01"', () => {
    expect(formatDurationHm(601)).toBe('10:01');
  });

  // h >> 10
  it('1234 → "20:34"', () => {
    expect(formatDurationHm(1234)).toBe('20:34');
  });
  it('5999 → "99:59"', () => {
    expect(formatDurationHm(5999)).toBe('99:59');
  });

  // 소수점 truncate
  it('30.5 → "0:30" (Math.floor 영역)', () => {
    expect(formatDurationHm(30.5)).toBe('0:30');
  });
  it('60.9 → "1:00" (Math.floor 영역)', () => {
    expect(formatDurationHm(60.9)).toBe('1:00');
  });
});

describe('formatDurationHm — PBT invariant', () => {
  it('finite positive integer → /^\\d+:\\d{2}$/ format 의무', () => {
    fc.assert(
      fc.property(fc.integer({min: 1, max: 100000}), n => {
        const result = formatDurationHm(n);
        return /^\d+:\d{2}$/.test(result);
      }),
      {numRuns: 200}
    );
  });

  it('format 결과 분 단위 환산 시 input 분 단위 정합 (Math.floor 분)', () => {
    fc.assert(
      fc.property(fc.integer({min: 1, max: 100000}), n => {
        const result = formatDurationHm(n);
        const [h, m] = result.split(':').map(Number);
        return h * 60 + m === Math.floor(n);
      }),
      {numRuns: 200}
    );
  });
});
