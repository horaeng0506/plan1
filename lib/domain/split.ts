import type { Schedule, WorkingHours } from './types'

const NS = 60_000

// 옵션 A — user TZ aware Date helper (Intl.DateTimeFormat 기반).
// server local TZ (Vercel iad1 = UTC) 와 무관하게 user TZ 기준 wall-clock day key + minutes-of-day 산출.
//
// 사고: 2026-05-04 prod 사용자 KST 07:00 입력 → 14:00 fall-back. root cause:
//   - Vercel iad1 default UTC + TZ env reserved (변경 불가)
//   - server-TZ-naive Date API → user wall-clock day boundary 잘못 인식
//   - line 74-83 fittable=0 분기 가 다음 날 wh.startMin 으로 roll forward → fall-back
// 해결: user TZ 인자를 splitByWorkingHours signature 에 추가. settings.userTz 에서 주입.
//
// DST 안전성: Asia/Seoul 은 DST 없음. 다중 사용자 SaaS 시 America/Los_Angeles 같은 DST TZ 에선
// dayStartMs 가 dayStart 의 24h 차이가 23h/25h 가 될 수 있어 addDaysMs 가 dayStartMs 으로 재정렬.

function getDateParts(
  ms: number,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  // hour12=false 일부 환경에서 자정이 '24' 로 나올 수 있음 → 0 normalize
  const rawHour = get('hour')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: get('minute'),
  }
}

function dateKeyOf(ms: number, timeZone: string): string {
  const { year, month, day } = getDateParts(ms, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function minutesOfDay(ms: number, timeZone: string): number {
  const { hour, minute } = getDateParts(ms, timeZone)
  return hour * 60 + minute
}

function dayStartMs(ms: number, timeZone: string): number {
  // user TZ 의 wall-clock 00:00 의 epoch ms — 단순 minute-of-day 차감
  return ms - minutesOfDay(ms, timeZone) * NS
}

function addDaysMs(ms: number, days: number, timeZone: string): number {
  // user TZ wall-clock day 단위 이동. DST 안전 (dayStartMs 재정렬)
  const start = dayStartMs(ms, timeZone)
  const approx = start + days * 24 * 60 * NS
  return dayStartMs(approx, timeZone)
}

function whFor(
  dateKey: string,
  workingHours: Record<string, WorkingHours>,
  defaultWH: { startMin: number; endMin: number }
): { startMin: number; endMin: number } {
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
  defaultWH: { startMin: number; endMin: number },
  userTz: string = 'Asia/Seoul'
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
    const dateKey = dateKeyOf(s.startAt, userTz)
    const wh = whFor(dateKey, workingHours, defaultWH)
    const startMin = minutesOfDay(s.startAt, userTz)
    const endMin = startMin + s.durationMin
    if (endMin <= wh.endMin) {
      out.push(s)
      continue
    }
    const fittable = Math.max(0, wh.endMin - startMin)
    // 2026-04-30 fix: startAt 이 WH endMin 이후면 fittable=0. 원본을 emit 안 한 채 part 만 emit 하면
    // part.split_from 가 존재하지 않는 원본 ID 를 가리켜 FK violation (Track 2 C-3 1차 PR 검증에서 노출).
    // → 원본 자체를 다음 날 WH 시작 시각으로 roll forward (split 아닌 reschedule). dayIndex=0 유지 (part 아님).
    //
    // 2026-05-04 옵션 A 보강: rollDayMs 를 user TZ wall-clock 다음날 00:00 으로 산출 →
    // server TZ UTC 환경에서도 user TZ 기준 정확한 다음날 wh 매칭.
    if (fittable === 0) {
      const rollDayMs = addDaysMs(s.startAt, 1, userTz)
      const rollDateKey = dateKeyOf(rollDayMs, userTz)
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
    const nextDayMs = addDaysMs(s.startAt, 1, userTz)
    const nextDateKey = dateKeyOf(nextDayMs, userTz)
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
