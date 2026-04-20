import type { Schedule, ScheduleId } from './types'

const NS = 60_000

export function cascade(
  schedules: Schedule[],
  editedId: ScheduleId,
  newStartAt: number,
  newDurationMin: number,
  mode: 'extend' | 'complete'
): Schedule[] {
  const mutated = schedules.map((s) =>
    s.id === editedId
      ? { ...s, startAt: newStartAt, durationMin: newDurationMin, updatedAt: Date.now() }
      : s
  )

  const baselineStart = new Map<ScheduleId, number>()
  for (const s of schedules) baselineStart.set(s.id, s.startAt)
  baselineStart.set(editedId, newStartAt)

  const active = mutated.filter((s) => s.status !== 'done')
  active.sort((a, b) => a.startAt - b.startAt)

  const editedIdx = active.findIndex((s) => s.id === editedId)
  if (editedIdx === -1) return mutated

  const adjusted = [...active]
  for (let i = editedIdx + 1; i < adjusted.length; i++) {
    const prev = adjusted[i - 1]
    const prevEnd = prev.startAt + prev.durationMin * NS
    const cur = adjusted[i]
    const baseline = baselineStart.get(cur.id) ?? cur.startAt
    const newCurStart = mode === 'extend' ? Math.max(baseline, prevEnd) : prevEnd
    if (newCurStart !== cur.startAt) {
      adjusted[i] = { ...cur, startAt: newCurStart, updatedAt: Date.now() }
    }
  }

  const adjustedMap = new Map<ScheduleId, Schedule>(adjusted.map((s) => [s.id, s]))
  return mutated.map((s) => adjustedMap.get(s.id) ?? s)
}
