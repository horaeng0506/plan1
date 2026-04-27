import type { Schedule, WorkingHours } from './types'

const NS = 60_000

function dateKeyOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function minutesOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

function dayStartMs(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function addDaysMs(ms: number, days: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

function whFor(dateKey: string, workingHours: Record<string, WorkingHours>, defaultWH: { startMin: number; endMin: number }): { startMin: number; endMin: number } {
  const entry = workingHours[dateKey]
  if (entry) return { startMin: entry.startMin, endMin: entry.endMin }
  return { startMin: defaultWH.startMin, endMin: defaultWH.endMin }
}

function makePartId(): string {
  return `sch-${crypto.randomUUID()}`
}

export function splitByWorkingHours(
  schedules: Schedule[],
  workingHours: Record<string, WorkingHours>,
  defaultWH: { startMin: number; endMin: number }
): Schedule[] {
  const done = schedules.filter((s) => s.status === 'done')
  const queue: Schedule[] = schedules.filter((s) => s.status !== 'done')
  const out: Schedule[] = []
  let iter = 0
  while (queue.length > 0 && iter < 5000) {
    const s = queue.shift() as Schedule
    iter++
    const dateKey = dateKeyOf(s.startAt)
    const wh = whFor(dateKey, workingHours, defaultWH)
    const startMin = minutesOfDay(s.startAt)
    const endMin = startMin + s.durationMin
    if (endMin <= wh.endMin) {
      out.push(s)
      continue
    }
    const fittable = Math.max(0, wh.endMin - startMin)
    if (fittable > 0) {
      out.push({ ...s, durationMin: fittable })
    }
    const remain = s.durationMin - fittable
    if (remain <= 0) continue
    const nextDayMs = dayStartMs(addDaysMs(s.startAt, 1))
    const nextDateKey = dateKeyOf(nextDayMs)
    const nextWH = whFor(nextDateKey, workingHours, defaultWH)
    const nextStartAt = nextDayMs + nextWH.startMin * NS
    const baseId = s.splitFrom ?? s.id
    queue.push({
      ...s,
      id: makePartId(),
      startAt: nextStartAt,
      durationMin: remain,
      splitFrom: baseId,
      updatedAt: Date.now(),
    })
  }
  return [...done, ...out]
}
