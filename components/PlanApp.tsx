'use client';

import {useEffect, useState} from 'react';
import dynamic from 'next/dynamic';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {runMutation} from '@/lib/run-mutation';
import {AnalogClock} from './AnalogClock';
import {ActiveTimer} from './ActiveTimer';
import {NewScheduleModal} from './NewScheduleModal';
import {CategoryManager} from './CategoryManager';
import {WorkingHoursEditor} from './WorkingHoursEditor';
import type {Theme} from '@/lib/domain/types';

// FullCalendar v6 는 SSR 시 document/window 직접 접근 위험 — env-critic Stage 3e 진입 게이트.
// next/dynamic({ssr:false}) 으로 client 진입 후에만 로드.
const WeeklyCalendarSkeleton = () => (
  <div className="h-64 border border-dashed border-gray-300 p-4 text-xs font-mono text-gray-500 dark:border-gray-700 dark:text-gray-400">
    # weekly · loading...
  </div>
);
const DailyTimelineSkeleton = () => (
  <div className="h-64 border border-dashed border-gray-300 p-4 text-xs font-mono text-gray-500 dark:border-gray-700 dark:text-gray-400">
    # today · loading...
  </div>
);

const WeeklyCalendar = dynamic(
  () => import('./WeeklyCalendar').then(m => m.WeeklyCalendar),
  {ssr: false, loading: WeeklyCalendarSkeleton}
);
const DailyTimeline = dynamic(
  () => import('./DailyTimeline').then(m => m.DailyTimeline),
  {ssr: false, loading: DailyTimelineSkeleton}
);

export function PlanApp() {
  const t = useTranslations();
  const loaded = useAppStore(s => s.loaded);
  const loading = useAppStore(s => s.loading);
  const error = useAppStore(s => s.error);
  const init = useAppStore(s => s.init);
  const weekViewSpan = useAppStore(s => s.settings.weekViewSpan);
  const weeklyPanelHidden = useAppStore(s => s.settings.weeklyPanelHidden);
  const theme = useAppStore(s => s.settings.theme);
  const updateSettings = useAppStore(s => s.updateSettings);

  const [newOpen, setNewOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [whOpen, setWhOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Stage 3e env-critic Critical: store.init() 트리거. layout/page 단일 진입점에서 1회 호출.
  // Stage 3f Playwright 회귀 fix: error 발생 시에도 재진입 방지 (loaded=false 인데 loading=false 로
  // 떨어지면 useEffect 재실행 → init 무한 루프). error 가 있으면 사용자 의도(retry 버튼)가 있을
  // 때만 다시 시도. 현재는 retry UI 미구현 → error 후 재시도 차단.
  useEffect(() => {
    if (!loaded && !loading && !error) {
      init().catch(err => {
        // eslint-disable-next-line no-console
        console.error('[plan1 · store.init]', err);
      });
    }
  }, [loaded, loading, error, init]);

  // 테마 effect — system 환경 매체 변경 추적.
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mq.matches);
      root.classList.toggle('dark', isDark);
    };
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const handleEventClick = (id: string, splitFrom?: string) => {
    setEditingId(splitFrom ?? id);
  };

  const spanButtonClass = (n: 1 | 2 | 3) =>
    `px-3 py-1 text-sm rounded-none border transition-colors font-mono ${
      weekViewSpan === n
        ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'
    }`;

  const themeButtonClass = (tt: Theme) =>
    `px-2 py-1 text-xs rounded-none border transition-colors font-mono ${
      theme === tt
        ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'
    }`;

  const neutralBtn =
    'px-3 py-1 text-sm rounded-none border border-gray-300 bg-white text-gray-700 font-mono hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800';
  const primaryBtn =
    'px-3 py-1 text-sm rounded-none border border-gray-900 bg-gray-900 text-white font-mono hover:bg-gray-800 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200';

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-sm font-medium tracking-wide font-mono">
            <span style={{color: '#98c379'}}>{t('app.title')}</span>{' '}
            <span style={{color: '#5c6370'}}>$</span> {t('app.tagline')}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              <button
                type="button"
                className={spanButtonClass(1)}
                onClick={() =>
                  runMutation(updateSettings({weekViewSpan: 1}), 'set week span 1')
                }
              >
                {t('nav.weekSpan1')}
              </button>
              <button
                type="button"
                className={spanButtonClass(2)}
                onClick={() =>
                  runMutation(updateSettings({weekViewSpan: 2}), 'set week span 2')
                }
              >
                {t('nav.weekSpan2')}
              </button>
              <button
                type="button"
                className={spanButtonClass(3)}
                onClick={() =>
                  runMutation(updateSettings({weekViewSpan: 3}), 'set week span 3')
                }
              >
                {t('nav.weekSpan3')}
              </button>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                className={themeButtonClass('light')}
                onClick={() => runMutation(updateSettings({theme: 'light'}), 'set theme light')}
              >
                {t('nav.themeLight')}
              </button>
              <button
                type="button"
                className={themeButtonClass('dark')}
                onClick={() => runMutation(updateSettings({theme: 'dark'}), 'set theme dark')}
              >
                {t('nav.themeDark')}
              </button>
              <button
                type="button"
                className={themeButtonClass('system')}
                onClick={() => runMutation(updateSettings({theme: 'system'}), 'set theme system')}
              >
                {t('nav.themeSystem')}
              </button>
            </div>
            <button
              type="button"
              className={neutralBtn}
              onClick={() =>
                runMutation(
                  updateSettings({weeklyPanelHidden: !weeklyPanelHidden}),
                  'toggle weekly panel'
                )
              }
            >
              {weeklyPanelHidden ? t('nav.weeklyShow') : t('nav.weeklyHide')}
            </button>
            <button type="button" className={neutralBtn} onClick={() => setWhOpen(true)}>
              {t('nav.workingHours')}
            </button>
            <button type="button" className={neutralBtn} onClick={() => setCatOpen(true)}>
              {t('nav.categories')}
            </button>
            <button type="button" className={primaryBtn} onClick={() => setNewOpen(true)}>
              + {t('nav.newSchedule')}
            </button>
          </div>
        </header>

        {!loaded && loading && (
          <div className="mb-4 border border-dashed border-gray-300 px-4 py-3 text-xs font-mono text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <span className="text-[#5c6370]"># </span>
            {t('loading')}
          </div>
        )}
        {error && (
          <div className="mb-4 border border-red-600 bg-red-50 px-4 py-3 text-xs font-mono text-red-700 dark:border-red-400 dark:bg-red-400/10 dark:text-red-300">
            <span className="opacity-80">! </span>load failed: {error}
          </div>
        )}

        {!weeklyPanelHidden && (
          <section className="mb-6 rounded-none border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300 font-mono">
              <span className="text-[#5c6370]"># </span>
              {t('header.week')}
            </h2>
            <WeeklyCalendar onEventClick={handleEventClick} />
          </section>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded-none border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300 font-mono">
              <span className="text-[#5c6370]"># </span>
              {t('header.today')}
            </h2>
            <DailyTimeline onEventClick={handleEventClick} />
          </section>
          <aside className="space-y-4">
            <section className="rounded-none border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300 font-mono">
                <span className="text-[#5c6370]"># </span>
                {t('header.clock')}
              </h2>
              <AnalogClock />
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300 font-mono">
                <span className="text-[#5c6370]"># </span>
                {t('header.timer')}
              </h2>
              <ActiveTimer />
            </section>
          </aside>
        </div>
      </div>

      {newOpen && <NewScheduleModal onClose={() => setNewOpen(false)} />}
      {editingId && (
        <NewScheduleModal
          key={editingId}
          editingId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}
      {catOpen && <CategoryManager onClose={() => setCatOpen(false)} />}
      {whOpen && <WorkingHoursEditor onClose={() => setWhOpen(false)} />}
    </main>
  );
}
