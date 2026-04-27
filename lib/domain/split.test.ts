import { describe, it, expect } from 'vitest'
import { splitByWorkingHours } from './split'
import type { Schedule, WorkingHours } from './types'

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

function at(y: number, m: number, d: number, h: number, mm = 0): number {
  return new Date(y, m - 1, d, h, mm, 0, 0).getTime()
}

const DEFAULT_WH = { startMin: 540, endMin: 1080 }

describe('splitByWorkingHours', () => {
  it('1. schedule within working hours is unchanged', () => {
    const s = mkSchedule('s1', at(2026, 4, 20, 10), 60)
    const result = splitByWorkingHours([s], {}, DEFAULT_WH)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s1')
    expect(result[0].durationMin).toBe(60)
    expect(result[0].splitFrom).toBeUndefined()
  })

  it('2. schedule crossing end of working hours splits into today + next day', () => {
    const s = mkSchedule('s1', at(2026, 4, 20, 17), 120)
    const result = splitByWorkingHours([s], {}, DEFAULT_WH)
    expect(result).toHaveLength(2)
    const original = result.find((r) => r.id === 's1')!
    expect(original.durationMin).toBe(60)
    const part = result.find((r) => r.id !== 's1')!
    expect(part.splitFrom).toBe('s1')
    expect(part.durationMin).toBe(60)
    expect(new Date(part.startAt).getDate()).toBe(21)
    expect(new Date(part.startAt).getHours()).toBe(9)
  })

  it('3. split remainder that also exceeds next day recurses into third day', () => {
    const s = mkSchedule('s1', at(2026, 4, 20, 17), 660)
    const result = splitByWorkingHours([s], {}, DEFAULT_WH)
    expect(result).toHaveLength(3)
    const original = result.find((r) => r.id === 's1')!
    expect(original.durationMin).toBe(60)
    const parts = result.filter((r) => r.id !== 's1')
    expect(parts).toHaveLength(2)
    parts.forEach((p) => expect(p.splitFrom).toBe('s1'))
    const day22Part = parts.find((p) => new Date(p.startAt).getDate() === 22)
    expect(day22Part).toBeDefined()
    expect(day22Part!.durationMin).toBe(60)
  })

  it('4. done schedules are passed through unchanged regardless of overflow', () => {
    const s = mkSchedule('s1', at(2026, 4, 20, 17), 120, 'done')
    const result = splitByWorkingHours([s], {}, DEFAULT_WH)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('s1')
    expect(result[0].durationMin).toBe(120)
    expect(result[0].status).toBe('done')
  })

  it('5. per-day override: custom working hours shrink or expand the window', () => {
    const wh: Record<string, WorkingHours> = {
      '2026-04-20': { date: '2026-04-20', startMin: 540, endMin: 720 },
    }
    const s = mkSchedule('s1', at(2026, 4, 20, 11), 120)
    const result = splitByWorkingHours([s], wh, DEFAULT_WH)
    expect(result).toHaveLength(2)
    const original = result.find((r) => r.id === 's1')!
    expect(original.durationMin).toBe(60)
    const part = result.find((r) => r.id !== 's1')!
    expect(part.splitFrom).toBe('s1')
    expect(part.durationMin).toBe(60)
    expect(new Date(part.startAt).getDate()).toBe(21)
  })
})
