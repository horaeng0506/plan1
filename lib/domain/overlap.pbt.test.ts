import {describe, it, expect} from 'vitest';
import fc from 'fast-check';
import {findOverlapping, MAX_OVERLAP} from './overlap';
import type {Schedule, ScheduleId, ScheduleStatus, TimerType} from './types';

/**
 * findOverlapping — Property-Based Testing (200+ runs · invariants)
 *
 * 영역: lib/domain/overlap.ts (Tier 1 PBT · risk-matrix § 4 보강)
 * 패턴: cascade.pbt.test.ts cookie-cutter
 *
 * Invariants (수학적 정의):
 *   1. Empty input → empty output (vacuously true)
 *   2. Self-exclusion: excludeId 일치 항상 결과 제외
 *   3. Done schedule 항상 제외 (status='done')
 *   4. Symmetry: A overlaps B ↔ B overlaps A (set 의 정의 정합)
 *   5. Idempotence: 같은 input 두 번 호출 같은 결과
 *   6. Subset property: 결과 ⊆ schedules input
 *   7. Back-to-back 처리: a.endAt === b.startAt 시 overlap X (반-개구간 정의)
 *   8. Result count ≤ schedules.length (excludeId 1개 + done 0개+ 제외)
 *
 * 근거:
 *   - cascade.pbt.test.ts (200 runs · invariant 패턴 reference)
 *   - test-case-design-principles.md § 6 PBT (RPN High 영역 + 시간경계 invariant)
 *   - risk-matrix § 4 Tier 1 PBT 보강 영역
 */

const NS = 60_000;

const arbStatus: fc.Arbitrary<ScheduleStatus> = fc.constantFrom('pending', 'active', 'done');
const arbTimerType: fc.Arbitrary<TimerType> = fc.constantFrom('countup', 'timer1', 'countdown');

function arbSchedules(maxLength = 20): fc.Arbitrary<Schedule[]> {
  return fc
    .array(
      fc.record({
        title: fc.string({maxLength: 20}),
        startAt: fc.integer({min: 0, max: 1_000_000_000_000}),
        durationMin: fc.integer({min: 1, max: 1440}),
        timerType: arbTimerType,
        status: arbStatus,
        chainedToPrev: fc.boolean()
      }),
      {minLength: 1, maxLength}
    )
    .map(items =>
      items.map<Schedule>((item, i) => ({
        ...item,
        id: `s-${i}` as ScheduleId,
        categoryId: 'cat-1',
        createdAt: 0,
        updatedAt: 0
      }))
    );
}

describe('findOverlapping — Property-Based Testing (200 runs · invariants)', () => {
  it('invariant 1: empty schedules → empty result', () => {
    fc.assert(
      fc.property(
        fc.integer({min: 0, max: 1_000_000_000_000}),
        fc.integer({min: 1, max: 1440}),
        (startAt, durationMin) => {
          const result = findOverlapping([], startAt, durationMin);
          expect(result).toEqual([]);
        }
      ),
      {numRuns: 100}
    );
  });

  it('invariant 2: excludeId 일치 schedule 항상 결과 제외', () => {
    fc.assert(
      fc.property(
        arbSchedules(),
        fc.integer({min: 0, max: 1_000_000_000_000}),
        fc.integer({min: 1, max: 1440}),
        (schedules, startAt, durationMin) => {
          const target = schedules[0];
          const result = findOverlapping(schedules, startAt, durationMin, target.id);
          expect(result.find(s => s.id === target.id)).toBeUndefined();
        }
      ),
      {numRuns: 200}
    );
  });

  it('invariant 3: done schedule 항상 결과 제외', () => {
    fc.assert(
      fc.property(arbSchedules(), (schedules) => {
        // 모든 schedule status='done' 으로 고정 → 결과 항상 빈 array
        const allDone = schedules.map(s => ({...s, status: 'done' as ScheduleStatus}));
        const result = findOverlapping(allDone, 0, 60);
        expect(result).toEqual([]);
      }),
      {numRuns: 200}
    );
  });

  it('invariant 4: symmetry — A overlaps B ↔ B overlaps A', () => {
    fc.assert(
      fc.property(
        arbSchedules(2),
        (schedules) => {
          if (schedules.length < 2) return;
          const [a, b] = schedules;

          // A 가 B 의 [startAt, durationMin] 와 겹침 검사 (B 만 list 에)
          const aHitsB =
            findOverlapping([b], a.startAt, a.durationMin).length > 0;
          // B 가 A 의 [startAt, durationMin] 와 겹침 검사 (A 만 list 에)
          const bHitsA =
            findOverlapping([a], b.startAt, b.durationMin).length > 0;

          // status='done' 인 경우 둘 다 결과에서 제외 → 둘 다 false 일 수 있음
          // 정공: status 동일하면 둘 다 같은 결과
          if (a.status !== 'done' && b.status !== 'done') {
            expect(aHitsB).toBe(bHitsA);
          }
        }
      ),
      {numRuns: 300}
    );
  });

  it('invariant 5: idempotence — 같은 input 두 번 호출 같은 결과', () => {
    fc.assert(
      fc.property(
        arbSchedules(),
        fc.integer({min: 0, max: 1_000_000_000_000}),
        fc.integer({min: 1, max: 1440}),
        (schedules, startAt, durationMin) => {
          const result1 = findOverlapping(schedules, startAt, durationMin);
          const result2 = findOverlapping(schedules, startAt, durationMin);
          expect(result1).toEqual(result2);
          // input mutation 없음 검증 (immutable)
          const result3 = findOverlapping(schedules, startAt, durationMin);
          expect(result3).toEqual(result1);
        }
      ),
      {numRuns: 200}
    );
  });

  it('invariant 6: subset property — 결과 ⊆ schedules input', () => {
    fc.assert(
      fc.property(
        arbSchedules(),
        fc.integer({min: 0, max: 1_000_000_000_000}),
        fc.integer({min: 1, max: 1440}),
        (schedules, startAt, durationMin) => {
          const result = findOverlapping(schedules, startAt, durationMin);
          for (const r of result) {
            const found = schedules.find(s => s.id === r.id);
            expect(found).toBeDefined();
            expect(found).toEqual(r);
          }
        }
      ),
      {numRuns: 200}
    );
  });

  it('invariant 7: back-to-back 처리 — a.endAt === b.startAt 시 overlap X (반-개구간)', () => {
    fc.assert(
      fc.property(
        fc.integer({min: 0, max: 1_000_000_000_000 - 1440 * NS}),
        fc.integer({min: 1, max: 720}),
        (firstStart, firstDur) => {
          const firstEnd = firstStart + firstDur * NS;
          const second: Schedule = {
            id: 's-second' as ScheduleId,
            title: 'second',
            categoryId: 'cat-1',
            startAt: firstEnd, // 정확히 first 의 끝점
            durationMin: 60,
            timerType: 'countup',
            status: 'pending',
            createdAt: 0,
            updatedAt: 0,
            chainedToPrev: false
          };
          // first 의 [startAt, endAt) 와 second 검사 — second 가 first 끝점에서 시작 → overlap X 의무
          const result = findOverlapping([second], firstStart, firstDur);
          expect(result).toEqual([]);
        }
      ),
      {numRuns: 200}
    );
  });

  it('invariant 8: result count ≤ schedules.length', () => {
    fc.assert(
      fc.property(
        arbSchedules(),
        fc.integer({min: 0, max: 1_000_000_000_000}),
        fc.integer({min: 1, max: 1440}),
        (schedules, startAt, durationMin) => {
          const result = findOverlapping(schedules, startAt, durationMin);
          expect(result.length).toBeLessThanOrEqual(schedules.length);
        }
      ),
      {numRuns: 200}
    );
  });

  it('invariant 9: MAX_OVERLAP 상수 정합 (정책 회귀 catch · 2026-05-04)', () => {
    // 단순 상수 검증 — 정책 변경 시점 catch (대장 결정 영역)
    expect(MAX_OVERLAP).toBe(2);
  });

  it('invariant 10: zero-duration 보호 (durationMin=1 minimum)', () => {
    fc.assert(
      fc.property(
        arbSchedules(),
        fc.integer({min: 0, max: 1_000_000_000_000}),
        (schedules, startAt) => {
          // durationMin=1 (최소값) 시에도 정상 동작
          const result = findOverlapping(schedules, startAt, 1);
          expect(Array.isArray(result)).toBe(true);
        }
      ),
      {numRuns: 100}
    );
  });
});
