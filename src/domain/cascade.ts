import type { Schedule, ScheduleId } from './types'

const NS = 60_000

// 편집된 스케줄의 새 종료시각과 원래 종료시각의 차이 delta를 계산해,
// 시간순으로 뒤이어 오는 스케줄들 중 `chainedToPrev === true` 연속 구간에만
// startAt += delta 전파 (간격 유지). `false` 만나는 순간 체인 끊기고 중단.
// done 상태 스케줄은 skip.
// 새 정책에선 extend·complete 모두 delta 전파 동일 로직이라 mode 파라미터 폐기.
export function cascade(
  schedules: Schedule[],
  editedId: ScheduleId,
  newStartAt: number,
  newDurationMin: number,
): Schedule[] {
  const original = schedules.find((s) => s.id === editedId)
  if (!original) return schedules

  const origEnd = original.startAt + original.durationMin * NS
  const newEnd = newStartAt + newDurationMin * NS
  const delta = newEnd - origEnd

  const mutated = schedules.map((s) =>
    s.id === editedId
      ? { ...s, startAt: newStartAt, durationMin: newDurationMin, updatedAt: Date.now() }
      : s
  )

  if (delta === 0) return mutated

  const active = mutated.filter((s) => s.status !== 'done')
  active.sort((a, b) => a.startAt - b.startAt)

  const editedIdx = active.findIndex((s) => s.id === editedId)
  if (editedIdx === -1) return mutated

  const shiftedIds = new Set<ScheduleId>()
  for (let i = editedIdx + 1; i < active.length; i++) {
    const cur = active[i]
    if (!cur.chainedToPrev) break
    shiftedIds.add(cur.id)
  }

  if (shiftedIds.size === 0) return mutated

  return mutated.map((s) =>
    shiftedIds.has(s.id) ? { ...s, startAt: s.startAt + delta, updatedAt: Date.now() } : s
  )
}
