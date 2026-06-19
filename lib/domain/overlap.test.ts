import { describe, it, expect } from 'vitest';
import { findOverlapping, exceedsMaxOverlap, maxConcurrency, mutationExceedsOverlap, MAX_OVERLAP } from './overlap';
import type { Schedule } from './types';

function mk(
  id: string,
  startAt: number,
  durationMin: number,
  status: Schedule['status'] = 'pending'
): Schedule {
  return {
    id,
    title: id,
    categoryId: 'cat-default',
    startAt,
    durationMin,
    timerType: 'countup',
    status,
    createdAt: 0,
    updatedAt: 0,
  };
}

const t9am = new Date(2026, 4, 5, 9, 0).getTime();
const t10am = new Date(2026, 4, 5, 10, 0).getTime();
const t11am = new Date(2026, 4, 5, 11, 0).getTime();

describe('findOverlapping', () => {
  it('returns empty when no overlap', () => {
    const list = [mk('a', t9am, 60)]; // 9-10
    expect(findOverlapping(list, t11am, 60)).toEqual([]);
  });

  it('detects start-overlap (later starts before earlier ends)', () => {
    const list = [mk('a', t9am, 90)]; // 9-10:30
    const overlaps = findOverlapping(list, t10am, 30); // 10-10:30
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].id).toBe('a');
  });

  it('detects fully contained schedule', () => {
    const list = [mk('a', t9am, 180)]; // 9-12
    const overlaps = findOverlapping(list, t10am, 60); // 10-11
    expect(overlaps).toHaveLength(1);
  });

  it('excludes self by id (edit mode)', () => {
    const list = [mk('self', t9am, 60), mk('other', t10am, 60)]; // 9-10, 10-11
    const overlaps = findOverlapping(list, t9am, 90, 'self'); // 9-10:30
    expect(overlaps.map(s => s.id)).toEqual(['other']);
  });

  it('ignores done schedules', () => {
    const list = [mk('a', t9am, 60, 'done')];
    expect(findOverlapping(list, t9am, 60)).toEqual([]);
  });

  it('counts multiple simultaneous overlaps', () => {
    const list = [mk('a', t9am, 60), mk('b', t9am, 60)]; // 둘 다 9-10
    const overlaps = findOverlapping(list, t9am, 60);
    expect(overlaps).toHaveLength(2);
    expect(overlaps.length >= MAX_OVERLAP).toBe(true);
  });

  it('back-to-back boundaries do NOT overlap (a.endAt === b.startAt)', () => {
    const list = [mk('a', t9am, 60)]; // 9-10
    const overlaps = findOverlapping(list, t10am, 60); // 10-11
    expect(overlaps).toEqual([]);
  });

  it('symmetric: new schedule fully containing existing', () => {
    const list = [mk('inner', t10am, 30)]; // 10-10:30
    const overlaps = findOverlapping(list, t9am, 180); // 9-12 covers inner
    expect(overlaps).toHaveLength(1);
  });

  it('MAX_OVERLAP constant is 2', () => {
    expect(MAX_OVERLAP).toBe(2);
  });
});

// plan1-mobile A1 — 서버측 overlap 검증 (logic m4). EP/BVA: 동시 0·1·2·3 / 경계 동작.
describe('exceedsMaxOverlap', () => {
  it('empty set → false', () => {
    expect(exceedsMaxOverlap([], MAX_OVERLAP)).toBe(false);
  });

  it('1 concurrent (no overlap chain) → false', () => {
    const list = [mk('a', t9am, 60), mk('b', t10am, 60), mk('c', t11am, 60)];
    expect(exceedsMaxOverlap(list, MAX_OVERLAP)).toBe(false);
  });

  it('2 concurrent at max → false (boundary, allowed)', () => {
    const list = [mk('a', t9am, 60), mk('b', t9am, 60)]; // 둘 다 9-10
    expect(exceedsMaxOverlap(list, MAX_OVERLAP)).toBe(false);
  });

  it('3 concurrent → true (exceeds max=2)', () => {
    const list = [mk('a', t9am, 60), mk('b', t9am, 60), mk('c', t9am, 60)];
    expect(exceedsMaxOverlap(list, MAX_OVERLAP)).toBe(true);
  });

  it('3 partially overlapping (staggered) at one instant → true', () => {
    // a 9:00-10:00, b 9:30-10:30, c 9:45-10:15 → 9:45~10:00 구간 3중첩
    const t930 = new Date(2026, 4, 5, 9, 30).getTime();
    const t945 = new Date(2026, 4, 5, 9, 45).getTime();
    const list = [mk('a', t9am, 60), mk('b', t930, 60), mk('c', t945, 30)];
    expect(exceedsMaxOverlap(list, MAX_OVERLAP)).toBe(true);
  });

  it('done schedules excluded from concurrency', () => {
    const list = [mk('a', t9am, 60), mk('b', t9am, 60), mk('c', t9am, 60, 'done')];
    expect(exceedsMaxOverlap(list, MAX_OVERLAP)).toBe(false); // active 2개만
  });

  it('back-to-back (a.endAt === b.startAt) does not stack', () => {
    // 9-10, 10-11, 11-12 + 9-10 한 개 더 → 어느 시점도 2 초과 안 함
    const list = [mk('a', t9am, 60), mk('a2', t9am, 60), mk('b', t10am, 60), mk('c', t11am, 60)];
    expect(exceedsMaxOverlap(list, MAX_OVERLAP)).toBe(false);
  });

  it('zero-duration schedules ignored (no occupancy)', () => {
    const list = [mk('a', t9am, 0), mk('b', t9am, 0), mk('c', t9am, 0)];
    expect(exceedsMaxOverlap(list, MAX_OVERLAP)).toBe(false);
  });

  it('max=1 (single-lane) → 2 concurrent exceeds', () => {
    const list = [mk('a', t9am, 60), mk('b', t9am, 60)];
    expect(exceedsMaxOverlap(list, 1)).toBe(true);
  });
});

// PLAN1-OVERLAP-FIX-20260619 — 최대 동시수 peak.
describe('maxConcurrency', () => {
  it('empty → 0', () => expect(maxConcurrency([])).toBe(0));
  it('1 lane chain → 1', () => {
    expect(maxConcurrency([mk('a', t9am, 60), mk('b', t10am, 60)])).toBe(1);
  });
  it('2 simultaneous → 2', () => {
    expect(maxConcurrency([mk('a', t9am, 60), mk('b', t9am, 60)])).toBe(2);
  });
  it('3 simultaneous → 3', () => {
    expect(maxConcurrency([mk('a', t9am, 60), mk('b', t9am, 60), mk('c', t9am, 60)])).toBe(3);
  });
  it('done excluded', () => {
    expect(maxConcurrency([mk('a', t9am, 60), mk('b', t9am, 60, 'done')])).toBe(1);
  });
});

// delta 스코프 — 이번 변경이 만든 신규 위반만 거부 (과거 누적 lock-out 해소).
describe('mutationExceedsOverlap', () => {
  it('clean prev + next adds 3rd at same time → true (신규 위반 거부)', () => {
    const prev = [mk('a', t9am, 60), mk('b', t9am, 60)]; // 2
    const next = [...prev, mk('c', t9am, 60)]; // 3
    expect(mutationExceedsOverlap(prev, next, MAX_OVERLAP)).toBe(true);
  });

  it('clean prev + next adds non-overlapping → false', () => {
    const prev = [mk('a', t9am, 60)];
    const next = [...prev, mk('b', t11am, 60)];
    expect(mutationExceedsOverlap(prev, next, MAX_OVERLAP)).toBe(false);
  });

  it('⚡ prev 가 이미 3중(과거 누적) + 무관한 곳에 2중 추가 → false (lock-out 해소)', () => {
    // 과거 시각 t9am 에 이미 3중 누적(미완료). 오늘 무관한 t11am 에 일반 일정 추가.
    const stale = [mk('s1', t9am, 60), mk('s2', t9am, 60), mk('s3', t9am, 60)]; // 3
    const next = [...stale, mk('new', t11am, 60)]; // 여전히 peak 3 (t9am), 신규 위반 아님
    expect(mutationExceedsOverlap(stale, next, MAX_OVERLAP)).toBe(false);
  });

  it('prev 가 이미 3중 + 그 시각을 4중으로 악화 → true', () => {
    const stale = [mk('s1', t9am, 60), mk('s2', t9am, 60), mk('s3', t9am, 60)]; // 3
    const next = [...stale, mk('s4', t9am, 60)]; // 4 (악화)
    expect(mutationExceedsOverlap(stale, next, MAX_OVERLAP)).toBe(true);
  });

  it('prev 2 → next 2 (변동 없음) → false', () => {
    const prev = [mk('a', t9am, 60), mk('b', t9am, 60)];
    const next = [mk('a', t9am, 60), mk('b', t9am, 90)]; // 여전히 2
    expect(mutationExceedsOverlap(prev, next, MAX_OVERLAP)).toBe(false);
  });
});
