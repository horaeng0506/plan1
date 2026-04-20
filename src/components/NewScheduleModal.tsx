import { useState } from 'react'
import { useAppStore } from '../domain/store'
import type { TimerType } from '../domain/types'

export function NewScheduleModal({ onClose }: { onClose: () => void }) {
  const categories = useAppStore((s) => s.categories)
  const addSchedule = useAppStore((s) => s.addSchedule)

  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [startLocal, setStartLocal] = useState(() => defaultStartLocal())
  const [durationMin, setDurationMin] = useState(60)
  const [timerType, setTimerType] = useState<TimerType>('countup')

  const canSubmit = title.trim().length > 0 && categoryId && durationMin > 0 && startLocal

  const submit = () => {
    if (!canSubmit) return
    const startAt = new Date(startLocal).getTime()
    addSchedule({
      title: title.trim(),
      categoryId,
      startAt,
      durationMin,
      timerType,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded border border-gray-200 bg-white p-6 shadow-lg dark:border-gray-800 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">새 스케줄</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">이름</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">카테고리</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">시작 시간</span>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">소요 시간 (분)</span>
            <input
              type="number"
              min={1}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
          </label>
          <div>
            <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">타이머 종류</span>
            <div className="flex gap-3 text-sm text-gray-700 dark:text-gray-300">
              <label className="flex items-center gap-1">
                <input type="radio" name="timerType" checked={timerType === 'countup'} onChange={() => setTimerType('countup')} />
                카운트업 (type1)
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="timerType" checked={timerType === 'timer1'} onChange={() => setTimerType('timer1')} />
                timer1 방식 (type2)
              </label>
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >취소</button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded border border-gray-900 bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          >추가</button>
        </div>
      </div>
    </div>
  )
}

function defaultStartLocal(): string {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${hh}:${mm}`
}
