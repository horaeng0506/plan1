import { describe, it, expect } from 'vitest';
import { findOverlapping, exceedsMaxOverlap, maxConcurrency, mutationExceedsOverlap, mutationCreatesSameTypeOverlap, findSameTypeOverlapping, MAX_OVERLAP } from './overlap';
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

// chainedToPrev 지정 헬퍼 (S5 같은 종류 겹침 테스트용). true = 연결(1열) · false = 시작 시간 고정(2열).
function mkc(
  id: string,
  startAt: number,
  durationMin: number,
  chainedToPrev: boolean,
  status: Schedule['status'] = 'pending'
): Schedule {
  return { ...mk(id, startAt, durationMin, status), chainedToPrev };
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

// S5 — 같은 종류(chainedToPrev) 겹침 불가. 열끼리(연결↔고정)는 겹침 허용.
describe('mutationCreatesSameTypeOverlap', () => {
  it('시작 시간 고정 둘이 새로 겹침 → true', () => {
    const prev = [mkc('a', t9am, 60, false)];
    const next = [...prev, mkc('b', t9am, 60, false)]; // 고정 2개 9-10 겹침
    expect(mutationCreatesSameTypeOverlap(prev, next)).toBe(true);
  });

  it('연결 1 + 고정 1 겹침(다른 열) → false (허용)', () => {
    const prev: Schedule[] = [];
    const next = [mkc('a', t9am, 60, true), mkc('b', t9am, 60, false)]; // 연결1+고정1 = 동시2
    expect(mutationCreatesSameTypeOverlap(prev, next)).toBe(false);
  });

  it('연결 둘이 새로 겹침 → true', () => {
    const prev = [mkc('a', t9am, 60, true)];
    const next = [...prev, mkc('b', t9am, 60, true)];
    expect(mutationCreatesSameTypeOverlap(prev, next)).toBe(true);
  });

  it('같은 종류라도 시간 안 겹치면 → false', () => {
    const prev = [mkc('a', t9am, 60, false)];
    const next = [...prev, mkc('b', t11am, 60, false)]; // 9-10, 11-12
    expect(mutationCreatesSameTypeOverlap(prev, next)).toBe(false);
  });

  it('⚡ prev 가 이미 고정 2중(과거 누적) + 무관한 곳에 고정 추가 → false (lock-out 해소)', () => {
    const stale = [mkc('s1', t9am, 60, false), mkc('s2', t9am, 60, false)]; // 고정 2중
    const next = [...stale, mkc('n', t11am, 60, false)]; // 여전히 peak 2, 신규 위반 아님
    expect(mutationCreatesSameTypeOverlap(stale, next)).toBe(false);
  });

  it('⚡ prev 가 이미 겹침(과거 누적) + 다른 시간대에 새 같은 종류 겹침 → true (global-peak 버그 회귀)', () => {
    // PLAN1-SAME-TYPE-OVERLAP-FIX-20260701 대장 실기 catch: 옛 규칙 겹침 쌍이 있으면
    // 전 종전 global-peak 방식은 peak 이 안 늘어 새 겹침(z,w)을 통과시켰다.
    const stale = [mkc('s1', t9am, 60, true), mkc('s2', t9am, 60, true)]; // 연결 2개 9-10 겹침(과거)
    const next = [...stale, mkc('z', t11am, 60, true), mkc('w', t11am, 60, true)]; // 연결 2개 11-12 새 겹침
    expect(mutationCreatesSameTypeOverlap(stale, next)).toBe(true);
  });

  it('⚡ prev 겹침 쌍이 next 에 그대로 유지(같은 id) → false (grandfather 재거부 안 함)', () => {
    const stale = [mkc('s1', t9am, 60, true), mkc('s2', t9am, 60, true)]; // 연결 2개 겹침
    const next = [mkc('s1', t9am, 60, true), mkc('s2', t9am, 60, true)]; // 동일 쌍 유지
    expect(mutationCreatesSameTypeOverlap(stale, next)).toBe(false);
  });

  it('undefined chainedToPrev 는 고정(false)으로 정규화 → 고정끼리 겹침 true', () => {
    const prev = [mk('a', t9am, 60)]; // chainedToPrev undefined = 고정
    const next = [...prev, mkc('b', t9am, 60, false)];
    expect(mutationCreatesSameTypeOverlap(prev, next)).toBe(true);
  });
});

describe('findSameTypeOverlapping', () => {
  const list = [mkc('fix', t9am, 60, false), mkc('chain', t9am, 60, true)];
  it('같은 종류(고정)만 반환 — 다른 열(연결) 제외', () => {
    const r = findSameTypeOverlapping(list, t9am, 60, false);
    expect(r.map(s => s.id)).toEqual(['fix']);
  });
  it('연결 조회 시 연결만 반환', () => {
    const r = findSameTypeOverlapping(list, t9am, 60, true);
    expect(r.map(s => s.id)).toEqual(['chain']);
  });
  it('excludeId 자기 자신 제외', () => {
    const r = findSameTypeOverlapping(list, t9am, 60, false, 'fix');
    expect(r).toEqual([]);
  });
});
