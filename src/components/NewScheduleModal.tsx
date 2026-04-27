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
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function formatEndDisplay(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mn = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mn} (${WEEKDAYS[d.getDay()]})`
}

export function NewScheduleModal({ onClose, editingId: propEditingId }: { onClose: () => void; editingId?: string }) {
  const categories = useAppStore((s) => s.categories)
  const schedules = useAppStore((s) => s.schedules)
  const addSchedule = useAppStore((s) => s.addSchedule)
  const updateSchedule = useAppStore((s) => s.updateSchedule)
  const removeSchedule = useAppStore((s) => s.removeSchedule)

  const [editingId, setEditingId] = useState<string | null>(propEditingId ?? null)
  const editing = editingId ? schedules.find((s) => s.id === editingId) ?? null : null
  const isEdit = !!editing

  useEffect(() => {
    if (propEditingId && !schedules.find((s) => s.id === propEditingId)) onClose()
  }, [propEditingId, schedules, onClose])

  const initDate = editing ? dateKeyFromMs(editing.startAt) : todayKey()
  const initHour = editing ? new Date(editing.startAt).getHours() : defaultHour()
  const initMinute = editing ? new Date(editing.startAt).getMinutes() : 0
  const initDuration = editing?.durationMin ?? 0
  const initTitle = editing?.title ?? ''
  const initCategoryId = editing?.categoryId ?? (categories[0]?.id ?? '')
  const initChained = editing?.chainedToPrev ?? false

  const [title, setTitle] = useState(initTitle)
  const [categoryId, setCategoryId] = useState(initCategoryId)
  const [date, setDate] = useState(initDate)
  const [hour, setHour] = useState<number>(initHour)
  const [minute, setMinute] = useState<number>(initMinute)
  const [durationMin, setDurationMin] = useState<number>(initDuration)
  const [chainedToPrev, setChainedToPrev] = useState<boolean>(initChained)
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
  const endAt = startAt + durationMin * 60_000

  const minuteOptions = useMemo(() => {
    if (MINUTE_OPTIONS.includes(minute)) return MINUTE_OPTIONS
    return [...MINUTE_OPTIONS, minute].sort((a, b) => a - b)
  }, [minute])

  const isDirty = editing
    ? title.trim() !== editing.title ||
      categoryId !== editing.categoryId ||
      startAt !== editing.startAt ||
      durationMin !== editing.durationMin ||
      chainedToPrev !== (editing.chainedToPrev ?? false)
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
    setDurationMin((d) => Math.max(0, d + delta))
  }

  const setNowStart = () => {
    const n = new Date()
    setDate(dateKeyFromMs(n.getTime()))
    setHour(n.getHours())
    setMinute(n.getMinutes())
  }

  const submit = () => {
    if (!canSubmit) return
    if (isEdit && editing) {
      updateSchedule(editing.id, {
        title: title.trim(),
        categoryId,
        startAt,
        durationMin,
        chainedToPrev,
      })
    } else {
      addSchedule({
        title: title.trim(),
        categoryId,
        startAt,
        durationMin,
        timerType: 'countup',
        chainedToPrev,
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

  const handleNextAfter = () => {
    if (!editing) return
    if (isDirty && baseOk) {
      updateSchedule(editing.id, {
        title: title.trim(),
        categoryId,
        startAt,
        durationMin,
        chainedToPrev,
      })
    }
    const formEndAt = startAt + durationMin * 60_000
    const nextStart = formEndAt + 10 * 60_000
    const d = new Date(nextStart)
    setEditingId(null)
    setTitle('')
    setCategoryId(categories[0]?.id ?? '')
    setDate(dateKeyFromMs(nextStart))
    setHour(d.getHours())
    setMinute(d.getMinutes())
    setDurationMin(0)
    setChainedToPrev(false)
    setDeleteArmed(false)
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
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
            <div>
              <button type="button" onClick={setNowStart} className={adjustBtn}>
                <span className="opacity-70">$ </span>now (시작을 지금으로)
              </button>
            </div>
            {!isEdit && !isFuture && (
              <p className="text-xs text-red-600 dark:text-red-400">시작 시각은 현재보다 미래여야 합니다.</p>
            )}
            <div>
              <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">소요 시간 (분)</span>
              <input type="number" min={0} value={durationMin} onChange={(e) => setDurationMin(Math.max(0, Number(e.target.value) || 0))} className={fieldCls} />
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" onClick={() => bumpDuration(-30)} className={adjustBtn}>-30분</button>
                <button type="button" onClick={() => bumpDuration(-10)} className={adjustBtn}>-10분</button>
                <button type="button" onClick={() => bumpDuration(10)} className={adjustBtn}>+10분</button>
                <button type="button" onClick={() => bumpDuration(30)} className={adjustBtn}>+30분</button>
                <button type="button" onClick={() => bumpDuration(60)} className={adjustBtn}>+1시간</button>
              </div>
            </div>
            <div className="text-xs font-mono text-gray-600 dark:text-gray-400">
              <span className="text-[#5c6370]"># </span>end → {durationMin > 0 ? formatEndDisplay(endAt) : <span className="text-gray-400 dark:text-gray-600">— (소요 0분)</span>}
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 font-mono">
              <input
                type="checkbox"
                checked={chainedToPrev}
                onChange={(e) => setChainedToPrev(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="text-[#5c6370]">⤴</span> 이전 스케줄과 연결 (cascade 받음)
                <span className="block text-xs text-gray-500 dark:text-gray-400">앞 스케줄이 늘어나거나 줄면 이 스케줄도 함께 이동 (간격 유지)</span>
              </span>
            </label>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            {isEdit && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`rounded-none border px-3 py-2 text-sm font-mono ${
                    deleteArmed
                      ? 'border-red-600 bg-red-600 text-white hover:bg-red-700 dark:border-red-400 dark:bg-red-400 dark:text-gray-900 dark:hover:bg-red-300'
                      : 'border-red-600 bg-white text-red-600 hover:bg-red-50 dark:border-red-400 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-400/10'
                  }`}
                >
                  <span className="opacity-80">! </span>{deleteArmed ? 'confirm delete' : 'delete'}
                </button>
                <button
                  type="button"
                  onClick={handleNextAfter}
                  className={adjustBtn}
                  title="현재 편집 저장(dirty 시) + 종료시각 + 10분을 시작으로 가지는 새 스케줄 모달 오픈"
                >
                  <span className="opacity-70">$ </span>next +10m (완료 후 새 스케줄)
                </button>
              </div>
            )}
            <div className="flex justify-end gap-2">
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
