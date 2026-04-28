import { describe, it, expect } from 'vitest'
import { cascade } from './cascade'
import type { Schedule } from './types'


function mkSchedule(
  id: string,
  startAt: number,
  durationMin: number,
  opts: { status?: Schedule['status']; chainedToPrev?: boolean } = {}
): Schedule {
  return {
    id,
    title: id,
    categoryId: 'cat-default',
    startAt,
    durationMin,
    timerType: 'countup',
    status: opts.status ?? 'pending',
    chainedToPrev: opts.chainedToPrev,
    createdAt: 0,
    updatedAt: 0,
  }
}

function atHour(h: number, m = 0): number {
  return new Date(2026, 3, 20, h, m, 0, 0).getTime()
}

describe('cascade (chainedToPrev 기반)', () => {
  it('1. 링크 없음 → 뒤 스케줄 그대로', () => {
    const s1 = mkSchedule('s1', atHour(9), 60)
    const s2 = mkSchedule('s2', atHour(10, 30), 60) // 기본 chainedToPrev 없음
    const result = cascade([s1, s2], 's1', atHour(9), 120)
    const r2 = result.find((s) => s.id === 's2')!
    expect(r2.startAt).toBe(atHour(10, 30))
  })

  it('2. 링크됨 → delta 만큼 뒤 스케줄 이동 (간격 유지)', () => {
    const s1 = mkSchedule('s1', atHour(9), 60)
    const s2 = mkSchedule('s2', atHour(10, 30), 60, { chainedToPrev: true })
    const result = cascade([s1, s2], 's1', atHour(9), 90) // +30분
    const r2 = result.find((s) => s.id === 's2')!
    expect(r2.startAt).toBe(atHour(11)) // 10:30 + 30 = 11:00
  })

  it('3. 체인 끊김 → false 만나는 순간 중단, 그 뒤는 true여도 안 움직임', () => {
    const s1 = mkSchedule('s1', atHour(9), 60)
    const s2 = mkSchedule('s2', atHour(10, 30), 60, { chainedToPrev: true })
    const s3 = mkSchedule('s3', atHour(12), 60)                       // chainedToPrev 없음 (끊김)
    const s4 = mkSchedule('s4', atHour(13, 30), 60, { chainedToPrev: true }) // 링크지만 앞이 끊어져 무시
    const result = cascade([s1, s2, s3, s4], 's1', atHour(9), 90) // +30분
    const r2 = result.find((s) => s.id === 's2')!
    const r3 = result.find((s) => s.id === 's3')!
    const r4 = result.find((s) => s.id === 's4')!
    expect(r2.startAt).toBe(atHour(11))
    expect(r3.startAt).toBe(atHour(12))       // 그대로
    expect(r4.startAt).toBe(atHour(13, 30))   // 그대로
  })

  it('4. complete 단축 → 링크된 뒤 스케줄 당김 (간격 유지)', () => {
    const s1 = mkSchedule('s1', atHour(9), 60) // 09:00-10:00
    const s2 = mkSchedule('s2', atHour(10, 30), 60, { chainedToPrev: true }) // 10:30, gap 30
    const result = cascade([s1, s2], 's1', atHour(9), 30) // 09:30 종료 → delta -30분
    const r2 = result.find((s) => s.id === 's2')!
    expect(r2.startAt).toBe(atHour(10)) // 10:30 - 30 = 10:00 (gap 30분 유지)
  })

  it('5. done 스케줄은 skip, 링크된 활성만 이동', () => {
    const sDone = mkSchedule('s-done', atHour(8), 60, { status: 'done' })
    const s1 = mkSchedule('s1', atHour(9), 60)
    const s2 = mkSchedule('s2', atHour(10, 30), 60, { chainedToPrev: true })
    const result = cascade([sDone, s1, s2], 's1', atHour(9), 90)
    const rDone = result.find((s) => s.id === 's-done')!
    const r2 = result.find((s) => s.id === 's2')!
    expect(rDone.startAt).toBe(atHour(8))
    expect(rDone.status).toBe('done')
    expect(r2.startAt).toBe(atHour(11))
  })
})
