import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../domain/store'
import type { Schedule, TimerType } from '../domain/types'

function findActiveSchedule(schedules: Schedule[], now: number): Schedule | null {
  for (const s of schedules) {
    if (s.status === 'done') continue
    const end = s.startAt + s.durationMin * 60_000
    if (s.startAt <= now && now < end) return s
  }
  return null
}

function formatHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatWall12(ms: number): string {
  const d = new Date(ms)
  const h24 = d.getHours()
  const ampm = h24 < 12 ? '오전' : '오후'
  const h12 = ((h24 + 11) % 12) + 1
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${ampm} ${h12}:${mm}:${ss}`
}

export function ActiveTimer() {
  const schedules = useAppStore((s) => s.schedules)
  const categories = useAppStore((s) => s.categories)
  const extendScheduleBy = useAppStore((s) => s.extendScheduleBy)
  const completeSchedule = useAppStore((s) => s.completeSchedule)
  const updateSchedule = useAppStore((s) => s.updateSchedule)
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const active = useMemo(() => findActiveSchedule(schedules, now), [schedules, now])

  const [frozen, setFrozen] = useState<boolean>(true)
  const [idleSince, setIdleSince] = useState<number | null>(null)
  const lastActiveIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (active?.id !== lastActiveIdRef.current) {
      lastActiveIdRef.current = active?.id ?? null
      setFrozen(true)
      setIdleSince(null)
    }
  }, [active?.id])

  if (!active) {
    return (
      <div className="rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        활성 스케줄 없음
      </div>
    )
  }

  const category = categories.find((c) => c.id === active.categoryId)
  const endAt = active.startAt + active.durationMin * 60_000
  const isCountup = active.timerType === 'countup'
  const isTimer1 = active.timerType === 'timer1'

  const elapsed = now - active.startAt
  const displayEndAt = isTimer1 && !frozen && idleSince !== null
    ? endAt + (now - idleSince)
    : endAt

  const bump = (mins: number) => extendScheduleBy(active.id, mins)
  const complete = () => completeSchedule(active.id, Date.now())
  const setType = (t: TimerType) => updateSchedule(active.id, { timerType: t })

  const toggleFreeze = () => {
    if (frozen) {
      setIdleSince(Date.now())
      setFrozen(false)
    } else {
      if (idleSince !== null) {
        const elapsedMs = Date.now() - idleSince
        const elapsedMin = Math.max(0, Math.round(elapsedMs / 60_000))
        if (elapsedMin > 0) extendScheduleBy(active.id, elapsedMin)
      }
      setIdleSince(null)
      setFrozen(true)
    }
  }

  const neutralBtn = 'rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
  const primaryBtn = 'rounded border border-gray-900 bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-800 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
  const typeBtn = (on: boolean) =>
    `flex-1 rounded border px-2 py-1 text-xs transition-colors ${
      on
        ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'
    }`
  const freezeBtn = (focused: boolean) =>
    `w-full rounded border px-3 py-2 text-sm font-medium transition-colors ${
      focused
        ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
        : 'border-red-600 bg-red-600/10 text-red-600 hover:bg-red-600/20 dark:text-red-400 dark:border-red-400 dark:bg-red-400/10 dark:hover:bg-red-400/20'
    }`

  return (
    <div className="rounded border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-1 flex items-center gap-2">
        {category && <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: category.color }} />}
        <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{active.title}</span>
      </div>
      <div className="mb-2 flex gap-1">
        <button type="button" onClick={() => setType('countup')} className={typeBtn(isCountup)}>카운트업</button>
        <button type="button" onClick={() => setType('timer1')} className={typeBtn(isTimer1)}>timer1</button>
      </div>
      {isCountup && (
        <>
          <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">경과</div>
          <div className="mb-3 font-mono text-3xl text-gray-900 dark:text-gray-100">
            {formatHMS(elapsed)}
          </div>
        </>
      )}
      {isTimer1 && (
        <>
          <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">목표 시각</div>
          <div className="mb-1 font-mono text-2xl text-gray-900 dark:text-gray-100">
            {formatWall12(displayEndAt)}
          </div>
          <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            지금 {formatHMS(now - active.startAt)} 경과
          </div>
          <button type="button" onClick={toggleFreeze} className={freezeBtn(frozen) + ' mb-3'}>
            {frozen ? '집중 중 (누르면 딴짓 시작)' : '딴짓거리 중 (누르면 집중 복귀)'}
          </button>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => bump(10)} className={neutralBtn}>+10분</button>
        <button type="button" onClick={() => bump(30)} className={neutralBtn}>+30분</button>
        <button type="button" onClick={() => bump(60)} className={neutralBtn}>+1시간</button>
        <button type="button" onClick={complete} className={primaryBtn}>즉시 완료</button>
      </div>
    </div>
  )
}
