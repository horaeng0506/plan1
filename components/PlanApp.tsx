'use client';

import {useEffect, useMemo, useState} from 'react';
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

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatMD(d: Date): string {
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} (${DOW[d.getDay()]})`;
}

function formatMDshort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// FullCalendar v6 는 SSR 시 document/window 직접 접근 위험 — env-critic Stage 3e 진입 게이트.
// next/dynamic({ssr:false}) 으로 client 진입 후에만 로드.
const WeeklyCalendarSkeleton = () => (
  <div className="h-64 border border-dashed border-line p-4 text-xs font-mono text-muted">
    weekly · loading...
  </div>
);
const DailyTimelineSkeleton = () => (
  <div className="h-64 border border-dashed border-line p-4 text-xs font-mono text-muted">
    today · loading...
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
  const schedules = useAppStore(s => s.schedules);

  const [newOpen, setNewOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [whOpen, setWhOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Stage 4c — status meta bar 동적 데이터.
  // SSR safe: now=null 초기 → client mount 후 1회 + 60초 간격 갱신.
  // env-critic 가드: hydration mismatch 회피 위해 now null 시 meta 부분 미렌더.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayKey = now ? dateKey(now) : null;
  const todayMeta = now ? formatMD(now) : '';
  const ampm = now ? (now.getHours() < 12 ? 'am' : 'pm') : '';

  const todayEventCount = useMemo(() => {
    if (!todayKey) return 0;
    return schedules.filter(s => dateKey(new Date(s.startAt)) === todayKey).length;
  }, [schedules, todayKey]);

  const weekRange = useMemo(() => {
    if (!now) return '';
    const start = new Date(now);
    const day = start.getDay();
    // ISO week: Monday=1 ... Sunday=0 → start of week = Monday.
    const offset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 7 * weekViewSpan - 1);
    return `${formatMDshort(start)}–${formatMDshort(end)}`;
  }, [now, weekViewSpan]);

  // ui-critic Critical: timer meta DESIGN.md 형식 (`countup · 00:42:13`) 정합 위해
  // 활성 카운트 + 가장 오래 돈 타이머 elapsed 표시.
  const activeMeta = useMemo(() => {
    if (!now) return null;
    const ms = now.getTime();
    const actives = schedules.filter(s => {
      if (s.status === 'done') return false;
      const end = s.startAt + s.durationMin * 60_000;
      return s.startAt <= ms && ms < end;
    });
    if (actives.length === 0) return {count: 0, elapsedMin: 0};
    // 가장 일찍 시작한 (= 가장 오래 돌고 있는) 타이머의 분 단위 elapsed.
    const longest = actives.reduce((a, b) => (a.startAt < b.startAt ? a : b));
    const elapsedMin = Math.max(0, Math.floor((ms - longest.startAt) / 60_000));
    return {count: actives.length, elapsedMin};
  }, [schedules, now]);

  function formatElapsedHM(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${pad(h)}:${pad(m)}`;
  }

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
  // Stage 4a env-critic Critical fix: globals.css 4채널 토큰 .light/.dark class 기반 swap 와 짝.
  // SSR default = dark (.dark 또는 클래스 없음). user "light" = .light 추가 + .dark 제거.
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mq.matches);
      root.classList.toggle('dark', isDark);
      root.classList.toggle('light', !isDark);
    };
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  const handleEventClick = (id: string, splitFrom?: string) => {
    setEditingId(splitFrom ?? id);
  };

  // Stage 4a 4채널 토큰화: gray-* dark:* → bg/panel/line/muted/txt/ink.
  // 활성 inverted 패턴(`bg-gray-900...dark:bg-gray-100`)은 `bg-ink text-bg border-ink`.
  const spanButtonClass = (n: 1 | 2 | 3) =>
    `px-3 py-1 text-sm rounded-none border transition-colors font-mono ${
      weekViewSpan === n
        ? 'bg-ink text-bg border-ink'
        : 'bg-panel text-txt border-line hover:bg-bg'
    }`;

  const themeButtonClass = (tt: Theme) =>
    `px-2 py-1 text-xs rounded-none border transition-colors font-mono ${
      theme === tt
        ? 'bg-ink text-bg border-ink'
        : 'bg-panel text-txt border-line hover:bg-bg'
    }`;

  const neutralBtn =
    'px-3 py-1 text-sm rounded-none border border-line bg-panel text-txt font-mono hover:bg-bg';
  const primaryBtn =
    'px-3 py-1 text-sm rounded-none border border-ink bg-ink text-bg font-mono hover:opacity-90';

  return (
    <main className="min-h-screen bg-bg text-txt">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-sm font-medium tracking-wide font-mono">
            <span className="text-success">{t('app.title')}</span>
            <span className="text-muted"> · </span>
            {t('app.tagline')}
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
          <div className="mb-4 border border-dashed border-line px-4 py-3 text-xs font-mono text-muted">
            {t('loading')}
          </div>
        )}
        {error && (
          <div className="mb-4 border border-danger bg-[rgba(224,108,117,0.1)] px-4 py-3 text-xs font-mono text-danger">
            load failed: {error}
          </div>
        )}

        {/* env-critic Critical: dashed hr 항상 렌더 + visibility class toggle 으로
            SSR/CSR DOM 동일 보장 (weeklyPanelHidden 토글로 mismatch 회피).
            ui-critic Critical: meta bar span 항상 렌더 (now=null placeholder) → CLS 차단. */}
        <section
          className={`mb-6 rounded-none border border-line bg-panel p-4 ${
            weeklyPanelHidden ? 'hidden' : ''
          }`}
        >
          <h2 className="mb-3 text-sm font-semibold text-ink font-mono">
            {t('header.week')}
            <span className="ml-1 font-normal text-muted">
              · {now ? weekRange : '—'} · span={weekViewSpan}w
            </span>
          </h2>
          <WeeklyCalendar onEventClick={handleEventClick} />
        </section>

        <hr
          className={`mb-6 border-t border-dashed border-line ${weeklyPanelHidden ? 'hidden' : ''}`}
          aria-hidden="true"
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <section className="rounded-none border border-line bg-panel p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink font-mono">
              {t('header.today')}
              <span className="ml-1 font-normal text-muted">
                · {now ? todayMeta : '—'} · {todayEventCount} events
              </span>
            </h2>
            <DailyTimeline onEventClick={handleEventClick} />
          </section>
          <aside className="space-y-6">
            <section className="rounded-none border border-line bg-panel p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink font-mono">
                {t('header.clock')}
                <span className="ml-1 font-normal text-muted">
                  · 12h · {now ? ampm : '—'}
                </span>
              </h2>
              <AnalogClock />
            </section>
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink font-mono">
                {t('header.timer')}
                <span className="ml-1 font-normal text-muted">
                  ·{' '}
                  {activeMeta && activeMeta.count > 0
                    ? `${activeMeta.count} active · ${formatElapsedHM(activeMeta.elapsedMin)}`
                    : 'idle'}
                </span>
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
