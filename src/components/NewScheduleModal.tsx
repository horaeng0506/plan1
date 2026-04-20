import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
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

function dateKeyFromMs(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let nowCache = Date.now()
function subscribeNow(cb: () => void) {
  const id = setInterval(() => {
    nowCache = Date.now()
    cb()
  }, 1000)
  return () => clearInterval(id)
}
function getNow() {
  return nowCache
}

const MINUTE_OPTIONS = [0, 10, 20, 30, 40, 50]

export function NewScheduleModal({ onClose, editingId }: { onClose: () => void; editingId?: string }) {
  const categories = useAppStore((s) => s.categories)
  const schedules = useAppStore((s) => s.schedules)
  const addSchedule = useAppStore((s) => s.addSchedule)
  const updateSchedule = useAppStore((s) => s.updateSchedule)
  const removeSchedule = useAppStore((s) => s.removeSchedule)

  const editing = editingId ? schedules.find((s) => s.id === editingId) ?? null : null
  const isEdit = !!editing

  const initDate = editing ? dateKeyFromMs(editing.startAt) : todayKey()
  const initHour = editing ? new Date(editing.startAt).getHours() : defaultHour()
  const initMinute = editing ? new Date(editing.startAt).getMinutes() : 0
  const initDuration = editing?.durationMin ?? 60
  const initTitle = editing?.title ?? ''
  const initCategoryId = editing?.categoryId ?? (categories[0]?.id ?? '')

  const [title, setTitle] = useState(initTitle)
  const [categoryId, setCategoryId] = useState(initCategoryId)
  const [date, setDate] = useState(initDate)
  const [hour, setHour] = useState<number>(initHour)
  const [minute, setMinute] = useState<number>(initMinute)
  const [durationMin, setDurationMin] = useState<number>(initDuration)
  const [catOpen, setCatOpen] = useState(false)

  const [deleteArmed, setDeleteArmed] = useState(false)
  const deleteTimerRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
  }, [])

  const startAt = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(y, m - 1, d, hour, minute, 0, 0).getTime()
  }, [date, hour, minute])
  const now = useSyncExternalStore(subscribeNow, getNow)
  const isFuture = startAt > now

  const minuteOptions = useMemo(() => {
    if (MINUTE_OPTIONS.includes(minute)) return MINUTE_OPTIONS
    return [...MINUTE_OPTIONS, minute].sort((a, b) => a - b)
  }, [minute])

  const isDirty = editing
    ? title.trim() !== editing.title ||
      categoryId !== editing.categoryId ||
      startAt !== editing.startAt ||
      durationMin !== editing.durationMin
    : false

  const baseOk =
    title.trim().length > 0 &&
    categoryId !== '' &&
    categoryId !== '__NEW__' &&
    durationMin > 0
  const canSubmit = isEdit ? baseOk && isDirty : baseOk && isFuture

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
    if (isEdit && editing) {
      updateSchedule(editing.id, {
        title: title.trim(),
        categoryId,
        startAt,
        durationMin,
      })
    } else {
      addSchedule({
        title: title.trim(),
        categoryId,
        startAt,
        durationMin,
        timerType: 'countup',
      })
    }
    onClose()
  }

  const handleDelete = () => {
    if (!editing) return
    if (!deleteArmed) {
      setDeleteArmed(true)
      deleteTimerRef.current = window.setTimeout(() => setDeleteArmed(false), 2000)
      return
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    removeSchedule(editing.id)
    onClose()
  }

  const fieldCls = 'w-full rounded-none border border-gray-300 bg-white px-3 py-2 text-gray-900 font-mono dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
  const adjustBtn = 'rounded-none border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 font-mono hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'

  const headerTxt = isEdit ? 'schedule --edit' : 'schedule --new'
  const submitLabel = isEdit ? 'save' : 'add'

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.75)] p-4" onClick={onClose}>
        <div
          className="w-full max-w-md rounded-none border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100"><span className="text-[#98c379]">$ </span>{headerTxt}</h2>
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
                  {minuteOptions.map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, '0')}분</option>
                  ))}
                </select>
              </label>
            </div>
            {!isEdit && !isFuture && (
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
          <div className="mt-6 flex justify-between gap-2">
            <div>
              {isEdit && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`rounded-none border px-4 py-2 text-sm font-mono ${
                    deleteArmed
                      ? 'border-red-600 bg-red-600 text-white hover:bg-red-700 dark:border-red-400 dark:bg-red-400 dark:text-gray-900 dark:hover:bg-red-300'
                      : 'border-red-600 bg-white text-red-600 hover:bg-red-50 dark:border-red-400 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-400/10'
                  }`}
                >
                  <span className="opacity-80">! </span>{deleteArmed ? 'confirm delete' : 'delete'}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-none border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 font-mono hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >cancel</button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="rounded-none border border-gray-900 bg-gray-900 px-4 py-2 text-sm text-white font-mono hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
              ><span className="opacity-70">$ </span>{submitLabel}</button>
            </div>
          </div>
        </div>
      </div>
      {catOpen && <CategoryManager onClose={() => setCatOpen(false)} />}
    </>
  )
}
