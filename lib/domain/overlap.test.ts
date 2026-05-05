import { describe, it, expect } from 'vitest';
import { findOverlapping, MAX_OVERLAP } from './overlap';
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
