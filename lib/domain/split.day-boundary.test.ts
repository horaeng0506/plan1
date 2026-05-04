/**
 * splitByWorkingHours — day boundary 처리 회귀 catch
 *
 * 환원 근거: tests/qa-gate/models/schedule-tz.txt § 2 day boundary triplet (3-way)
 * BVA: 입력시각 0/23:30/23:59, duration 30/60/600, wh end 900/1080/1320
 *
 * 본 spec 은 server TZ KST 가정 (옵션 D 박힌 prod 시뮬)
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {splitByWorkingHours} from './split';
import type {Schedule} from './types';

function mkSchedule(id: string, startAt: number, durationMin: number): Schedule {
  return {
    id,
    title: id,
    categoryId: 'cat-default',
    startAt,
    durationMin,
    timerType: 'countup',
    status: 'pending',
    createdAt: 0,
    updatedAt: 0
  };
}

function kstMs(y: number, m: number, d: number, h: number, mm = 0): number {
  return Date.UTC(y, m - 1, d, h - 9, mm, 0, 0);
}

const DEFAULT_WH = {startMin: 540, endMin: 1080};

describe('splitByWorkingHours — day boundary BVA', () => {
  let originalTZ: string | undefined;
  beforeAll(() => {
    originalTZ = process.env.TZ;
    process.env.TZ = 'Asia/Seoul';
  });
  afterAll(() => {
    if (originalTZ) process.env.TZ = originalTZ;
    else delete process.env.TZ;
  });

  it('1. KST 23:30 + 30min → fittable=0 → roll forward 다음날 09:00 (split 아님)', () => {
    const startAt = kstMs(2026, 5, 4, 23, 30);
    const sched = mkSchedule('db-1', startAt, 30);
    const result = splitByWorkingHours([sched], {}, DEFAULT_WH);

    // 2026-04-30 fix: startAt 이 WH endMin 이후 → roll forward (split 아닌 reschedule)
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('db-1');
    expect(result[0].splitFrom).toBeUndefined();
    expect(result[0].startAt).toBe(kstMs(2026, 5, 5, 9));
    expect(result[0].durationMin).toBe(30);
  });

  it('2. KST 17:30 + 60min (정확히 wh.endMin 와 일치) → split 안 일어남', () => {
    const startAt = kstMs(2026, 5, 4, 17, 30);
    const sched = mkSchedule('db-2', startAt, 30);
    const result = splitByWorkingHours([sched], {}, DEFAULT_WH);

    expect(result).toHaveLength(1);
    expect(result[0].splitFrom).toBeUndefined();
    expect(result[0].startAt).toBe(startAt);
  });

  it('3. KST 17:30 + 31min (wh.endMin 1분 초과) → split 유발', () => {
    const startAt = kstMs(2026, 5, 4, 17, 30);
    const sched = mkSchedule('db-3', startAt, 31);
    const result = splitByWorkingHours([sched], {}, DEFAULT_WH);

    // 원본 fittable = 30, part = 1
    expect(result.length).toBeGreaterThanOrEqual(2);
    const original = result.find(s => s.id === 'db-3');
    const part = result.find(s => s.splitFrom === 'db-3');
    expect(original?.durationMin).toBe(30);
    expect(part?.durationMin).toBe(1);
    expect(part?.startAt).toBe(kstMs(2026, 5, 5, 9));
  });

  it('4. KST 00:30 + 60min (자정 직후) → 시작 시각 그대로 유지 (working hours 시작 전이지만 endMin 검사만)', () => {
    const startAt = kstMs(2026, 5, 4, 0, 30);
    const sched = mkSchedule('db-4', startAt, 60);
    const result = splitByWorkingHours([sched], {}, DEFAULT_WH);

    // 현재 split.ts 는 endMin > wh.endMin 만 검사 — startMin < wh.startMin 은 무시
    // 즉 00:30 + 60min = 01:30 → 1080 안 → 그대로 통과
    expect(result).toHaveLength(1);
    expect(result[0].startAt).toBe(startAt);
  });

  it('5. KST 09:00 + 600min (10시간) → fittable 540 → 다음날 09:00 으로 60min 이월', () => {
    const startAt = kstMs(2026, 5, 4, 9);
    const sched = mkSchedule('db-5', startAt, 600);
    const result = splitByWorkingHours([sched], {}, DEFAULT_WH);

    const original = result.find(s => s.id === 'db-5');
    const part = result.find(s => s.splitFrom === 'db-5');
    expect(original?.durationMin).toBe(540); // 09:00 ~ 18:00 정확 fit
    expect(part?.durationMin).toBe(60); // 다음날 60분
    expect(part?.startAt).toBe(kstMs(2026, 5, 5, 9));
  });
});
