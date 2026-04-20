import { useAppStore } from './domain/store'
import { WeeklyCalendar } from './components/WeeklyCalendar'

function App() {
  const weekViewSpan = useAppStore((s) => s.settings.weekViewSpan)
  const weeklyPanelHidden = useAppStore((s) => s.settings.weeklyPanelHidden)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const spanButtonClass = (n: 1 | 2 | 3) =>
    `px-3 py-1 text-sm rounded border transition-colors ${
      weekViewSpan === n
        ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'
    }`

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold">plan1</h1>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <button type="button" className={spanButtonClass(1)} onClick={() => updateSettings({ weekViewSpan: 1 })}>1주</button>
              <button type="button" className={spanButtonClass(2)} onClick={() => updateSettings({ weekViewSpan: 2 })}>2주</button>
              <button type="button" className={spanButtonClass(3)} onClick={() => updateSettings({ weekViewSpan: 3 })}>3주</button>
            </div>
            <button
              type="button"
              className="px-3 py-1 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800"
              onClick={() => updateSettings({ weeklyPanelHidden: !weeklyPanelHidden })}
            >
              {weeklyPanelHidden ? '주간 보이기' : '주간 숨기기'}
            </button>
          </div>
        </header>
        {!weeklyPanelHidden && (
          <section className="rounded border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <WeeklyCalendar />
          </section>
        )}
        {weeklyPanelHidden && (
          <section className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400">
            주간 패널이 숨겨진 상태입니다.
          </section>
        )}
      </div>
    </main>
  )
}

export default App
