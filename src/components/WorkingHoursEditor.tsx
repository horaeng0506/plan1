import { useState } from 'react'
import { useAppStore } from '../domain/store'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, '0')
  const m = (min % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function enumerateDates(from: string, to: string, weekdaysOnly: boolean): string[] {
  const result: string[] = []
  let cur = from
  let guard = 0
  while (cur <= to && guard < 1000) {
    const [y, m, d] = cur.split('-').map(Number)
    const dow = new Date(y, m - 1, d).getDay()
    const isWeekend = dow === 0 || dow === 6
    if (!weekdaysOnly || !isWeekend) result.push(cur)
    cur = addDaysKey(cur, 1)
    guard++
  }
  return result
}

type Mode = 'single' | 'range'

export function WorkingHoursEditor({ onClose }: { onClose: () => void }) {
  const defaultWH = useAppStore((s) => s.settings.defaultWorkingHours)
  const setWorkingHours = useAppStore((s) => s.setWorkingHours)
  const bulkSetWorkingHours = useAppStore((s) => s.bulkSetWorkingHours)
  const setDefaultWorkingHours = useAppStore((s) => s.setDefaultWorkingHours)

  const [mode, setMode] = useState<Mode>('single')
  const [date, setDate] = useState(todayKey())
  const [fromDate, setFromDate] = useState(todayKey())
  const [toDate, setToDate] = useState(addDaysKey(todayKey(), 6))
  const [weekdaysOnly, setWeekdaysOnly] = useState(true)
  const [startTime, setStartTime] = useState(minToTime(defaultWH.startMin))
  const [endTime, setEndTime] = useState(minToTime(defaultWH.endMin))
  const [alsoDefault, setAlsoDefault] = useState(false)

  const startMin = timeToMin(startTime)
  const endMin = timeToMin(endTime)
  const valid = startMin < endMin

  const save = () => {
    if (!valid) return
    const hours = { startMin, endMin }
    if (mode === 'single') {
      setWorkingHours(date, hours)
    } else {
      const dates = enumerateDates(fromDate, toDate, weekdaysOnly)
      if (dates.length > 0) bulkSetWorkingHours(dates, hours)
    }
    if (alsoDefault) setDefaultWorkingHours(hours)
    onClose()
  }

  const tabBtn = (active: boolean) =>
    `px-3 py-1 text-sm rounded border ${active ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'}`

  const fieldWrap = 'w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded border border-gray-200 bg-white p-6 shadow-lg dark:border-gray-800 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">업무 시간</h2>

        <div className="mb-4 flex gap-1">
          <button type="button" className={tabBtn(mode === 'single')} onClick={() => setMode('single')}>특정 날짜</button>
          <button type="button" className={tabBtn(mode === 'range')} onClick={() => setMode('range')}>기간 일괄</button>
        </div>

        <div className="space-y-3">
          {mode === 'single' && (
            <label className="block">
              <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">날짜</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldWrap} />
            </label>
          )}
          {mode === 'range' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">시작일</span>
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={fieldWrap} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">종료일</span>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={fieldWrap} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={weekdaysOnly} onChange={(e) => setWeekdaysOnly(e.target.checked)} />
                평일만 (월~금)
              </label>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">시작 시각</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={fieldWrap} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">종료 시각</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={fieldWrap} />
            </label>
          </div>
          {!valid && <p className="text-xs text-red-600 dark:text-red-400">종료 시각은 시작 시각보다 늦어야 합니다.</p>}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={alsoDefault} onChange={(e) => setAlsoDefault(e.target.checked)} />
            기본값으로도 저장
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >취소</button>
          <button
            type="button"
            onClick={save}
            disabled={!valid}
            className="rounded border border-gray-900 bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          >저장</button>
        </div>
      </div>
    </div>
  )
}
