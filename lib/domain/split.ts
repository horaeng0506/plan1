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

// Deterministic part ID — 같은 원본·같은 dayIndex 면 항상 같은 ID.
// 매 호출마다 새 UUID 발급하던 이전 동작은 ID churn → cascade·pin·revalidate 회귀 (logic-critic Critical #1)
function makePartId(baseId: string, dayIndex: number): string {
  return `${baseId}__part_${dayIndex}`
}

export function splitByWorkingHours(
  schedules: Schedule[],
  workingHours: Record<string, WorkingHours>,
  defaultWH: { startMin: number; endMin: number }
): Schedule[] {
  const done = schedules.filter((s) => s.status === 'done')
  // queue 진입 시 dayIndex 추적 (원본 = 0, 첫 part = 1, 두번째 = 2, ...)
  type QueueItem = { schedule: Schedule; dayIndex: number }
  const queue: QueueItem[] = schedules
    .filter((s) => s.status !== 'done')
    .map((s) => {
      // 기존 part 가 input 으로 들어오면 id 패턴에서 dayIndex 추출
      if (s.splitFrom) {
        const m = /__part_(\d+)$/.exec(s.id)
        if (m) return { schedule: s, dayIndex: parseInt(m[1], 10) }
      }
      return { schedule: s, dayIndex: 0 }
    })
  const out: Schedule[] = []
  let iter = 0
  while (queue.length > 0 && iter < 5000) {
    const { schedule: s, dayIndex } = queue.shift() as QueueItem
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
    // 2026-04-30 fix: startAt 이 WH endMin 이후면 fittable=0. 원본을 emit 안 한 채 part 만 emit 하면
    // part.split_from 가 존재하지 않는 원본 ID 를 가리켜 FK violation (Track 2 C-3 1차 PR 검증에서 노출).
    // → 원본 자체를 다음 날 WH 시작 시각으로 roll forward (split 아닌 reschedule). dayIndex=0 유지 (part 아님).
    if (fittable === 0) {
      const rollDayMs = dayStartMs(addDaysMs(s.startAt, 1))
      const rollDateKey = dateKeyOf(rollDayMs)
      const rollWH = whFor(rollDateKey, workingHours, defaultWH)
      queue.push({
        schedule: { ...s, startAt: rollDayMs + rollWH.startMin * NS, updatedAt: Date.now() },
        dayIndex: 0,
      })
      continue
    }
    out.push({ ...s, durationMin: fittable })
    const remain = s.durationMin - fittable
    if (remain <= 0) continue
    const nextDayMs = dayStartMs(addDaysMs(s.startAt, 1))
    const nextDateKey = dateKeyOf(nextDayMs)
    const nextWH = whFor(nextDateKey, workingHours, defaultWH)
    const nextStartAt = nextDayMs + nextWH.startMin * NS
    const baseId = s.splitFrom ?? s.id
    const nextDayIndex = dayIndex + 1
    queue.push({
      schedule: {
        ...s,
        id: makePartId(baseId, nextDayIndex),
        startAt: nextStartAt,
        durationMin: remain,
        splitFrom: baseId,
        // Part 의 chainedToPrev 는 false 강제 (logic-critic Critical #2).
        // cascade 가 part 를 별개 chain 으로 보고 이중 shift 하는 것 방지.
        chainedToPrev: false,
        updatedAt: Date.now(),
      },
      dayIndex: nextDayIndex,
    })
  }
  return [...done, ...out]
}
