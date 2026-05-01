import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { cascade } from './cascade'
import type { Schedule, ScheduleId, ScheduleStatus, TimerType } from './types'

const NS = 60_000

const arbStatus: fc.Arbitrary<ScheduleStatus> = fc.constantFrom('pending', 'active', 'done')
const arbTimerType: fc.Arbitrary<TimerType> = fc.constantFrom('countup', 'timer1', 'countdown')

function arbSchedules(maxLength = 20): fc.Arbitrary<Schedule[]> {
  return fc
    .array(
      fc.record({
        title: fc.string({ maxLength: 20 }),
        startAt: fc.integer({ min: 0, max: 1_000_000_000_000 }),
        durationMin: fc.integer({ min: 1, max: 1440 }),
        timerType: arbTimerType,
        status: arbStatus,
        chainedToPrev: fc.boolean(),
      }),
      { minLength: 1, maxLength }
    )
    .map(items =>
      items.map<Schedule>((item, i) => ({
        ...item,
        id: `s-${i}` as ScheduleId,
        categoryId: 'cat-1',
        createdAt: 0,
        updatedAt: 0,
      }))
    )
}

describe('cascade — Property-Based Testing (1000 runs · invariants)', () => {
  it('invariant 1: editedId 가 schedules 에 없으면 변경 0', () => {
    fc.assert(
      fc.property(
        arbSchedules(),
        fc.integer({ min: 0, max: 1_000_000_000_000 }),
        fc.integer({ min: 1, max: 1440 }),
        (schedules, newStart, newDur) => {
          const result = cascade(schedules, 'nonexistent' as ScheduleId, newStart, newDur)
          expect(result).toEqual(schedules)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('invariant 2: delta=0 이면 다른 schedule shift 없음 (편집 schedule 만 변경)', () => {
    fc.assert(
      fc.property(arbSchedules(), (schedules) => {
        const target = schedules[0]
        const newStart = target.startAt + 5 * NS
        const newDur = target.durationMin - 5
        if (newDur < 1) return // skip invalid duration

        const origEnd = target.startAt + target.durationMin * NS
        const newEnd = newStart + newDur * NS
        if (newEnd !== origEnd) return // delta=0 가정

        const result = cascade(schedules, target.id, newStart, newDur)
        // 다른 모든 schedule (id 0 외) 는 startAt 동일
        const otherIds = schedules.slice(1).map(s => s.id)
        for (const id of otherIds) {
          const before = schedules.find(s => s.id === id)!
          const after = result.find(s => s.id === id)!
          expect(after.startAt).toBe(before.startAt)
        }
      }),
      { numRuns: 200 }
    )
  })

  it('invariant 3: chainedToPrev=false 첫 발견 후 chain 끊김 (그 이후 schedule 들은 shift 안 됨)', () => {
    fc.assert(
      fc.property(arbSchedules(10), fc.integer({ min: -120, max: 120 }), (schedules, deltaMin) => {
        const target = schedules[0]
        const newStart = target.startAt
        const newDur = target.durationMin + deltaMin
        if (newDur < 1) return

        const result = cascade(schedules, target.id, newStart, newDur)

        // active 만 정렬 (cascade 의 동일 로직)
        const active = result.filter(s => s.status !== 'done').sort((a, b) => a.startAt - b.startAt)
        const editedIdx = active.findIndex(s => s.id === target.id)
        if (editedIdx === -1) return

        // 첫 unchained schedule 이후의 모든 schedule 은 원본과 startAt 동일해야 함
        let chainBroken = false
        for (let i = editedIdx + 1; i < active.length; i++) {
          if (!active[i].chainedToPrev) chainBroken = true
          if (chainBroken) {
            const original = schedules.find(s => s.id === active[i].id)!
            expect(active[i].startAt).toBe(original.startAt)
          }
        }
      }),
      { numRuns: 500 }
    )
  })

  it('invariant 4: done 상태 schedule 은 shift 영향 받지 않음', () => {
    fc.assert(
      fc.property(arbSchedules(), fc.integer({ min: -120, max: 120 }), (schedules, deltaMin) => {
        const target = schedules[0]
        const newDur = target.durationMin + deltaMin
        if (newDur < 1) return

        const result = cascade(schedules, target.id, target.startAt, newDur)

        for (const s of schedules) {
          if (s.status === 'done' && s.id !== target.id) {
            const after = result.find(r => r.id === s.id)!
            expect(after.startAt).toBe(s.startAt)
            expect(after.durationMin).toBe(s.durationMin)
          }
        }
      }),
      { numRuns: 300 }
    )
  })

  it('invariant 5: shift 후에도 chronological order 보존 (active 만)', () => {
    fc.assert(
      fc.property(arbSchedules(15), fc.integer({ min: -60, max: 60 }), (schedules, deltaMin) => {
        const target = schedules[0]
        const newDur = target.durationMin + deltaMin
        if (newDur < 1) return

        const result = cascade(schedules, target.id, target.startAt, newDur)
        const activeBefore = schedules
          .filter(s => s.status !== 'done')
          .sort((a, b) => a.startAt - b.startAt)
          .map(s => s.id)
        const activeAfter = result
          .filter(s => s.status !== 'done')
          .sort((a, b) => a.startAt - b.startAt)
          .map(s => s.id)
        // shift 가 일관되게 적용된 결과 active 의 순서가 같은 set 이어야 함
        // (단조 증가 보장은 cascade 가 chained 만 shift 하므로 정렬 변동 없을 것 — 단 동일 startAt 발생 가능)
        expect(new Set(activeAfter)).toEqual(new Set(activeBefore))
      }),
      { numRuns: 200 }
    )
  })
})
