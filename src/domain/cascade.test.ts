import { describe, it, expect } from 'vitest'
import { cascade } from './cascade'
import type { Schedule } from './types'


function mkSchedule(id: string, startAt: number, durationMin: number, status: Schedule['status'] = 'pending'): Schedule {
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
  }
}

function atHour(h: number, m = 0): number {
  return new Date(2026, 3, 20, h, m, 0, 0).getTime()
}

describe('cascade', () => {
  it('1. extend no-op when gap is larger than extension', () => {
    const s1 = mkSchedule('s1', atHour(9), 60)      // 09:00-10:00
    const s2 = mkSchedule('s2', atHour(11), 60)     // 11:00-12:00 (gap 60)
    const result = cascade([s1, s2], 's1', atHour(9), 90, 'extend') // extend to 10:30
    const r2 = result.find((s) => s.id === 's2')!
    expect(r2.startAt).toBe(atHour(11))
  })

  it('2. extend fully absorbs gap (partial shift of next)', () => {
    const s1 = mkSchedule('s1', atHour(9), 60)      // 09:00-10:00
    const s2 = mkSchedule('s2', atHour(10, 30), 60) // 10:30-11:30 (gap 30)
    const result = cascade([s1, s2], 's1', atHour(9), 120, 'extend') // extend to 11:00
    const r2 = result.find((s) => s.id === 's2')!
    expect(r2.startAt).toBe(atHour(11))
  })

  it('3. extend partial gap absorb + cascade to next-next', () => {
    const s1 = mkSchedule('s1', atHour(9), 60)       // 09:00-10:00
    const s2 = mkSchedule('s2', atHour(10, 30), 60)  // 10:30-11:30 (gap 30)
    const s3 = mkSchedule('s3', atHour(11, 30), 30)  // 11:30-12:00 (gap 0)
    const result = cascade([s1, s2, s3], 's1', atHour(9), 120, 'extend')
    const r2 = result.find((s) => s.id === 's2')!
    const r3 = result.find((s) => s.id === 's3')!
    expect(r2.startAt).toBe(atHour(11))
    expect(r3.startAt).toBe(atHour(12))
  })

  it('4. complete (tight pack) pulls next schedule immediately after', () => {
    const s1 = mkSchedule('s1', atHour(9), 60)       // 09:00-10:00
    const s2 = mkSchedule('s2', atHour(10, 30), 60)  // 10:30-11:30 (gap 30)
    // user clicks 즉시 완료 at 09:30 → new durationMin 30 → newEnd 09:30
    const result = cascade([s1, s2], 's1', atHour(9), 30, 'complete')
    const r2 = result.find((s) => s.id === 's2')!
    expect(r2.startAt).toBe(atHour(9, 30))
  })

  it('5. done schedules are skipped during cascade', () => {
    const sDone = mkSchedule('s-done', atHour(8), 60, 'done') // 08:00-09:00 done (ignored)
    const s1 = mkSchedule('s1', atHour(9), 60)                // 09:00-10:00
    const s2 = mkSchedule('s2', atHour(10, 30), 60)           // 10:30-11:30
    const result = cascade([sDone, s1, s2], 's1', atHour(9), 120, 'extend')
    const rDone = result.find((s) => s.id === 's-done')!
    const r2 = result.find((s) => s.id === 's2')!
    expect(rDone.startAt).toBe(atHour(8))
    expect(rDone.status).toBe('done')
    expect(r2.startAt).toBe(atHour(11))
  })
})
