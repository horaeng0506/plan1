/**
 * Stage 3c critic 회귀 테스트.
 *
 * Critical #1: splitByWorkingHours 이 deterministic ID 발급 (idempotent)
 * Critical #2: split 이 emit 한 part 의 chainedToPrev = false (cascade 이중 shift 방지)
 */

import {describe, it, expect} from 'vitest';
import {splitByWorkingHours} from './split';
import type {Schedule, WorkingHours} from './types';

const NS = 60_000;
const day = (y: number, m: number, d: number, h: number, mi: number) =>
  new Date(y, m - 1, d, h, mi, 0, 0).getTime();

function mkSchedule(id: string, startAt: number, durationMin: number, opts: Partial<Schedule> = {}): Schedule {
  return {
    id,
    title: id,
    categoryId: 'cat-default',
    startAt,
    durationMin,
    timerType: 'countup',
    status: 'pending',
    chainedToPrev: false,
    createdAt: 0,
    updatedAt: 0,
    ...opts
  };
}

const wh: Record<string, WorkingHours> = {};
const defaultWH = {startMin: 9 * 60, endMin: 18 * 60}; // 09:00~18:00

describe('splitByWorkingHours idempotency (Critical #1)', () => {
  it('같은 input 으로 두 번 호출 시 결과 ID·구조 동일', () => {
    // 1일 17:00 시작, 180분 (= 3시간) → 18:00 까지 60분 + 다음날 09:00~10:00 60분 + 다음날 10:00~11:00 60분
    // 실제로는 18:00-17:00=60min fittable, remain=120 → 다음날 09:00 시작 120min → 09:00~11:00 (180까지 안 갈것)
    const s = mkSchedule('sch-A', day(2026, 5, 1, 17, 0), 180);
    const r1 = splitByWorkingHours([s], wh, defaultWH);
    const r2 = splitByWorkingHours([s], wh, defaultWH);
    expect(r1.map(x => x.id)).toEqual(r2.map(x => x.id));
    expect(r1.length).toBeGreaterThanOrEqual(2);
  });

  it('첫 호출 결과를 다시 input 으로 넣으면 ID churn 없음', () => {
    const s = mkSchedule('sch-A', day(2026, 5, 1, 17, 0), 180);
    const r1 = splitByWorkingHours([s], wh, defaultWH);
    // r1 = 원본(잘림) + part(다음날). 이걸 다시 split 입력으로
    const r2 = splitByWorkingHours(r1, wh, defaultWH);
    // 입력에 part 가 있어도 출력 ID 가 변하면 안 됨
    expect(new Set(r2.map(x => x.id))).toEqual(new Set(r1.map(x => x.id)));
  });

  it('part ID 가 deterministic 형식 (baseId__part_N)', () => {
    const s = mkSchedule('sch-A', day(2026, 5, 1, 17, 0), 180);
    const r = splitByWorkingHours([s], wh, defaultWH);
    const parts = r.filter(x => x.splitFrom);
    for (const p of parts) {
      expect(p.id).toMatch(/^sch-A__part_\d+$/);
      expect(p.splitFrom).toBe('sch-A');
    }
  });
});

describe('split part chainedToPrev = false (Critical #2)', () => {
  it('원본이 chainedToPrev=true 여도 emit 된 part 는 false', () => {
    const s = mkSchedule('sch-A', day(2026, 5, 1, 17, 0), 180, {chainedToPrev: true});
    const r = splitByWorkingHours([s], wh, defaultWH);
    const parts = r.filter(x => x.splitFrom);
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) expect(p.chainedToPrev).toBe(false);
  });
});
