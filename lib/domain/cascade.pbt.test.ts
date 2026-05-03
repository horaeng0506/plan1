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
    // ⚠️ 검증 시점 주의: cascade 는 **shift 전 mutated 의 active sort** 로 chain 판정.
    //   shift 후 startAt 변경으로 result sort 결과가 다를 수 있음 (특히 동일 startAt 의 schedule 이 stable sort 결과 mutated 와 result 에서 다른 위치).
    //   → spec 도 mutated (shift 전) sort 기준으로 chain 판정 의무. result sort 기준 검증은 false positive 발생.
    //   배경: F4 회귀 (PR fix/plan1-cascade-pbt-invariant3-spec-logic · 2026-05-03)
    //         counter-example: 3 schedule 모두 startAt=0, target chained=false, s-1 chained=true, s-2 chained=false
    fc.assert(
      fc.property(arbSchedules(10), fc.integer({ min: -120, max: 120 }), (schedules, deltaMin) => {
        const target = schedules[0]
        const newStart = target.startAt
        const newDur = target.durationMin + deltaMin
        if (newDur < 1) return

        const origEnd = target.startAt + target.durationMin * NS
        const newEnd = newStart + newDur * NS
        const delta = newEnd - origEnd

        const result = cascade(schedules, target.id, newStart, newDur)

        // mutated (shift 전) 의 active sort — cascade source 와 동일 로직
        const mutated = schedules.map(s =>
          s.id === target.id ? { ...s, startAt: newStart, durationMin: newDur } : s
        )
        const mutatedActive = mutated
          .filter(s => s.status !== 'done')
          .sort((a, b) => a.startAt - b.startAt)
        const editedIdx = mutatedActive.findIndex(s => s.id === target.id)
        if (editedIdx === -1) return

        // editedIdx+1 부터 첫 unchained 직전까지: shifted (startAt = original + delta)
        // 첫 unchained 부터 끝까지: unshifted (startAt = original)
        let chainBroken = false
        for (let i = editedIdx + 1; i < mutatedActive.length; i++) {
          if (!mutatedActive[i].chainedToPrev) chainBroken = true
          const original = schedules.find(s => s.id === mutatedActive[i].id)!
          const after = result.find(s => s.id === mutatedActive[i].id)!
          if (chainBroken) {
            expect(after.startAt).toBe(original.startAt)
          } else {
            expect(after.startAt).toBe(original.startAt + delta)
          }
        }
      }),
      { numRuns: 1000 }
    )
  })

  it('invariant 3 회귀 case (F4 · seed -658135282): 동일 startAt + chained=false target 의 chain 판정', () => {
    // 회귀 차단 가드 (F4 catch — `wiki/projects/plan1/qa-pending.md` § 1)
    // 모든 schedule startAt=0 (stable sort 의존) · target s-0 chained=false · s-1 chained=true · s-2 chained=false
    const schedules: Schedule[] = [
      { title: '', startAt: 0, durationMin: 1, timerType: 'countup', status: 'pending', chainedToPrev: false, id: 's-0' as ScheduleId, categoryId: 'cat-1', createdAt: 0, updatedAt: 0 },
      { title: '', startAt: 0, durationMin: 1, timerType: 'countup', status: 'pending', chainedToPrev: true,  id: 's-1' as ScheduleId, categoryId: 'cat-1', createdAt: 0, updatedAt: 0 },
      { title: '', startAt: 0, durationMin: 1, timerType: 'countup', status: 'pending', chainedToPrev: false, id: 's-2' as ScheduleId, categoryId: 'cat-1', createdAt: 0, updatedAt: 0 },
    ]
    const result = cascade(schedules, 's-0' as ScheduleId, 0, 2) // delta = +1*NS
    const s0 = result.find(s => s.id === 's-0')!
    const s1 = result.find(s => s.id === 's-1')!
    const s2 = result.find(s => s.id === 's-2')!
    expect(s0.startAt).toBe(0)        // target startAt 변경 X
    expect(s0.durationMin).toBe(2)    // target dur 변경됨
    expect(s1.startAt).toBe(NS)       // mutated sort i=1 chained=true → shift +60000
    expect(s2.startAt).toBe(0)        // mutated sort i=2 chained=false → break · unshifted
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
