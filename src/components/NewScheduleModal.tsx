import { useMemo, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '../domain/store'
import { CategoryManager } from './CategoryManager'

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultHour(): number {
  const h = new Date().getHours() + 1
  return h >= 24 ? 23 : h
}

function subscribeNow(cb: () => void) {
  const id = setInterval(cb, 1000)
  return () => clearInterval(id)
}
function getNow() {
  return Date.now()
}

export function NewScheduleModal({ onClose }: { onClose: () => void }) {
  const categories = useAppStore((s) => s.categories)
  const addSchedule = useAppStore((s) => s.addSchedule)

  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [date, setDate] = useState(todayKey())
  const [hour, setHour] = useState<number>(defaultHour())
  const [minute, setMinute] = useState<number>(0)
  const [durationMin, setDurationMin] = useState<number>(60)
  const [catOpen, setCatOpen] = useState(false)

  const startAt = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(y, m - 1, d, hour, minute, 0, 0).getTime()
  }, [date, hour, minute])
  const now = useSyncExternalStore(subscribeNow, getNow)
  const isFuture = startAt > now

  const canSubmit = title.trim().length > 0 && categoryId !== '' && categoryId !== '__NEW__' && durationMin > 0 && isFuture

  const handleCategoryChange = (v: string) => {
    if (v === '__NEW__') {
      setCatOpen(true)
      return
    }
    setCategoryId(v)
  }

  const bumpDuration = (delta: number) => {
    setDurationMin((d) => Math.max(1, d + delta))
  }

  const submit = () => {
    if (!canSubmit) return
    addSchedule({
      title: title.trim(),
      categoryId,
      startAt,
      durationMin,
      timerType: 'countup',
    })
    onClose()
  }

  const fieldCls = 'w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
  const adjustBtn = 'rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div
          className="w-full max-w-md rounded border border-gray-200 bg-white p-6 shadow-lg dark:border-gray-800 dark:bg-gray-900"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">새 스케줄</h2>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">이름</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={fieldCls} autoFocus />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">카테고리</span>
              <select value={categoryId} onChange={(e) => handleCategoryChange(e.target.value)} className={fieldCls}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="__NEW__">+ 카테고리 추가</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">시작 날짜</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldCls} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">시작 시</span>
                <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className={fieldCls}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2, '0')}시</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">시작 분</span>
                <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className={fieldCls}>
                  {[0, 10, 20, 30, 40, 50].map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, '0')}분</option>
                  ))}
                </select>
              </label>
            </div>
            {!isFuture && (
              <p className="text-xs text-red-600 dark:text-red-400">시작 시각은 현재보다 미래여야 합니다.</p>
            )}
            <div>
              <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">소요 시간 (분)</span>
              <input type="number" min={1} value={durationMin} onChange={(e) => setDurationMin(Math.max(1, Number(e.target.value) || 0))} className={fieldCls} />
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" onClick={() => bumpDuration(-60)} className={adjustBtn}>-1시간</button>
                <button type="button" onClick={() => bumpDuration(-30)} className={adjustBtn}>-30분</button>
                <button type="button" onClick={() => bumpDuration(-10)} className={adjustBtn}>-10분</button>
                <button type="button" onClick={() => bumpDuration(10)} className={adjustBtn}>+10분</button>
                <button type="button" onClick={() => bumpDuration(30)} className={adjustBtn}>+30분</button>
                <button type="button" onClick={() => bumpDuration(60)} className={adjustBtn}>+1시간</button>
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
      {catOpen && <CategoryManager onClose={() => setCatOpen(false)} />}
    </>
  )
}
