import { useEffect, useState } from 'react'
import { useAppStore } from './domain/store'
import { WeeklyCalendar } from './components/WeeklyCalendar'
import { DailyTimeline } from './components/DailyTimeline'
import { AnalogClock } from './components/AnalogClock'
import { ActiveTimer } from './components/ActiveTimer'
import { NewScheduleModal } from './components/NewScheduleModal'
import { CategoryManager } from './components/CategoryManager'
import { WorkingHoursEditor } from './components/WorkingHoursEditor'
import type { Theme } from './domain/types'

function App() {
  const weekViewSpan = useAppStore((s) => s.settings.weekViewSpan)
  const weeklyPanelHidden = useAppStore((s) => s.settings.weeklyPanelHidden)
  const theme = useAppStore((s) => s.settings.theme)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const cleanOrphans = useAppStore((s) => s.cleanOrphans)
  const [newOpen, setNewOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [whOpen, setWhOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    cleanOrphans()
  }, [cleanOrphans])

  const handleEventClick = (id: string, splitFrom?: string) => {
    setEditingId(splitFrom ?? id)
  }

  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mq.matches)
      root.classList.toggle('dark', isDark)
    }
    apply()
    if (theme !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const spanButtonClass = (n: 1 | 2 | 3) =>
    `px-3 py-1 text-sm rounded border transition-colors ${
      weekViewSpan === n
        ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'
    }`

  const themeButtonClass = (t: Theme) =>
    `px-2 py-1 text-xs rounded border transition-colors ${
      theme === t
        ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'
    }`

  const neutralBtn = 'px-3 py-1 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'
  const primaryBtn = 'px-3 py-1 text-sm rounded border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-sm font-medium tracking-wide"><span style={{ color: "#98c379" }}>plan@m4</span> <span style={{ color: "#5c6370" }}>$</span> plan --today</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              <button type="button" className={spanButtonClass(1)} onClick={() => updateSettings({ weekViewSpan: 1 })}>1주</button>
              <button type="button" className={spanButtonClass(2)} onClick={() => updateSettings({ weekViewSpan: 2 })}>2주</button>
              <button type="button" className={spanButtonClass(3)} onClick={() => updateSettings({ weekViewSpan: 3 })}>3주</button>
            </div>
            <div className="flex gap-1">
              <button type="button" className={themeButtonClass('light')} onClick={() => updateSettings({ theme: 'light' })}>라이트</button>
              <button type="button" className={themeButtonClass('dark')} onClick={() => updateSettings({ theme: 'dark' })}>다크</button>
              <button type="button" className={themeButtonClass('system')} onClick={() => updateSettings({ theme: 'system' })}>자동</button>
            </div>
            <button type="button" className={neutralBtn} onClick={() => updateSettings({ weeklyPanelHidden: !weeklyPanelHidden })}>
              {weeklyPanelHidden ? '주간 보이기' : '주간 숨기기'}
            </button>
            <button type="button" className={neutralBtn} onClick={() => setWhOpen(true)}>업무시간</button>
            <button type="button" className={neutralBtn} onClick={() => setCatOpen(true)}>카테고리</button>
            <button type="button" className={primaryBtn} onClick={() => setNewOpen(true)}>+ 새 스케줄</button>
          </div>
        </header>

        {!weeklyPanelHidden && (
          <section className="mb-6 rounded border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">주간</h2>
            <WeeklyCalendar onEventClick={handleEventClick} />
          </section>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">오늘</h2>
            <DailyTimeline onEventClick={handleEventClick} />
          </section>
          <aside className="space-y-4">
            <section className="rounded border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">시계</h2>
              <AnalogClock />
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">타이머</h2>
              <ActiveTimer />
            </section>
          </aside>
        </div>
      </div>

      {newOpen && <NewScheduleModal onClose={() => setNewOpen(false)} />}
      {editingId && <NewScheduleModal key={editingId} editingId={editingId} onClose={() => setEditingId(null)} />}
      {catOpen && <CategoryManager onClose={() => setCatOpen(false)} />}
      {whOpen && <WorkingHoursEditor onClose={() => setWhOpen(false)} />}
    </main>
  )
}

export default App
