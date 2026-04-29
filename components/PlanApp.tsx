'use client';

import {useEffect, useMemo, useState} from 'react';
import dynamic from 'next/dynamic';
import {useTranslations} from 'next-intl';
import {logClientError} from '@/lib/log';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {AnalogClock} from './AnalogClock';
import {ActiveTimer} from './ActiveTimer';
import {ToastContainer} from './ToastContainer';
import {ModalSkeleton} from './ModalSkeleton';
import {useNow} from '@/lib/now';
import {pad2, dateKey} from '@/lib/date-format';
import type {Theme} from '@/lib/domain/types';

// Stage 4d-B: 모달 3개 lazy import (사용자 trigger 전 로드 안 됨 → bundle 절약).
// Stage 4e: ModalSkeleton 추가로 50-200ms chunk fetch 깜빡임 차단.
// SSR 안 함 — 모달은 클라 only.
const NewScheduleModal = dynamic(
  () => import('./NewScheduleModal').then(m => m.NewScheduleModal),
  {ssr: false, loading: ModalSkeleton}
);
const CategoryManager = dynamic(
  () => import('./CategoryManager').then(m => m.CategoryManager),
  {ssr: false, loading: ModalSkeleton}
);
const WorkingHoursEditor = dynamic(
  () => import('./WorkingHoursEditor').then(m => m.WorkingHoursEditor),
  {ssr: false, loading: ModalSkeleton}
);

function formatMD(d: Date, weekdayLabel: (idx: number) => string): string {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} (${weekdayLabel(d.getDay())})`;
}

function formatMDshort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// FullCalendar v6 는 SSR 시 document/window 직접 접근 위험 — env-critic Stage 3e 진입 게이트.
// next/dynamic({ssr:false}) 으로 client 진입 후에만 로드.
// Stage 5: skeleton 텍스트는 정적 영어. KO/JA 환경에서도 1~2초 짧게 노출되는
// loading state 라 i18n 미적용 허용 (i18n-extract 0건 정책의 예외 — 단발 노출).
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
  const runMutation = useRunMutation();
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

  // Stage 4d-B + critic fix: useNow + useMemo deps 분 단위 떨굼 (60배 recompute 절감).
  // logic-critic Major: Date 인스턴스를 deps 로 쓰면 매 렌더 새 ref → useMemo 무력화.
  // todayMeta/weekRange/activeMeta 모두 분 단위 정확도면 충분 (초 단위 갱신 의미 없음).
  const nowMs = useNow();
  const nowMin = nowMs > 0 ? Math.floor(nowMs / 60_000) : 0;
  const now = nowMs > 0 ? new Date(nowMs) : null;

  // Stage 5 i18n: weekday 영문 raw 배열 제거 → t('weekdays.0~6') 매핑.
  const weekdayLabels = useMemo(
    () => [
      t('weekdays.0'),
      t('weekdays.1'),
      t('weekdays.2'),
      t('weekdays.3'),
      t('weekdays.4'),
      t('weekdays.5'),
      t('weekdays.6')
    ],
    [t]
  );
  const weekdayLabel = (idx: number) => weekdayLabels[idx] ?? '';

  const todayKey = now ? dateKey(now) : null;
  const todayMeta = now ? formatMD(now, weekdayLabel) : '';
  const ampm = now ? (now.getHours() < 12 ? t('meta.amLower') : t('meta.pmLower')) : '';

  const todayEventCount = useMemo(() => {
    if (!todayKey) return 0;
    return schedules.filter(s => dateKey(new Date(s.startAt)) === todayKey).length;
  }, [schedules, todayKey]);

  const weekRange = useMemo(() => {
    if (nowMs === 0) return '';
    const start = new Date(nowMs);
    const day = start.getDay();
    // ISO week: Monday=1 ... Sunday=0 → start of week = Monday.
    const offset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + offset);
    const end = new Date(start);
    end.setDate(end.getDate() + 7 * weekViewSpan - 1);
    return `${formatMDshort(start)}–${formatMDshort(end)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMin, weekViewSpan]);

  // ui-critic Critical: timer meta DESIGN.md 형식 (`countup · 00:42:13`) 정합 위해
  // 활성 카운트 + 가장 오래 돈 타이머 elapsed 표시.
  const activeMeta = useMemo(() => {
    if (nowMs === 0) return null;
    const actives = schedules.filter(s => {
      if (s.status === 'done') return false;
      const end = s.startAt + s.durationMin * 60_000;
      return s.startAt <= nowMs && nowMs < end;
    });
    if (actives.length === 0) return {count: 0, elapsedMin: 0};
    // 가장 일찍 시작한 (= 가장 오래 돌고 있는) 타이머의 분 단위 elapsed.
    const longest = actives.reduce((a, b) => (a.startAt < b.startAt ? a : b));
    const elapsedMin = Math.max(0, Math.floor((nowMs - longest.startAt) / 60_000));
    return {count: actives.length, elapsedMin};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, nowMin]);

  function formatElapsedHM(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${pad2(h)}:${pad2(m)}`;
  }

  // Stage 3e env-critic Critical: store.init() 트리거. layout/page 단일 진입점에서 1회 호출.
  // Stage 3f Playwright 회귀 fix: error 발생 시에도 재진입 방지 (loaded=false 인데 loading=false 로
  // 떨어지면 useEffect 재실행 → init 무한 루프). error 가 있으면 사용자 의도(retry 버튼)가 있을
  // 때만 다시 시도. 현재는 retry UI 미구현 → error 후 재시도 차단.
  useEffect(() => {
    if (!loaded && !loading && !error) {
      init().catch(err => {
        logClientError('[plan1 · store.init]', err);
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

  // Stage 4e env-critic Major fix: newOpen 과 editingId 동시 mount race 차단.
  // Esc 키 1회로 둘 다 닫히는 시나리오 회피 + 사용자 mental model 정렬.
  // Track 1 fix (2026-04-29 · logic-critic): listCategories 시드 전 모달 진입 시 modal
  // useState 초기값이 빈 categoryId 캡처 → submit 시 categoryNotFound throw. loaded +
  // categories 둘 다 보장되기 전엔 modal open 자체 차단 (버튼 disabled 와 이중 가드).
  const canOpenNew = loaded && categories.length > 0;
  const openNew = () => {
    if (!canOpenNew) return;
    setEditingId(null);
    setNewOpen(true);
  };
  const handleEventClick = (id: string, splitFrom?: string) => {
    setNewOpen(false);
    setEditingId(splitFrom ?? id);
  };

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
    'px-3 py-1 text-sm rounded-none border border-ink bg-ink text-bg font-mono hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

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
                  runMutation(updateSettings({weekViewSpan: 1}), 'setWeekSpan')
                }
              >
                {t('nav.weekSpan1')}
              </button>
              <button
                type="button"
                className={spanButtonClass(2)}
                onClick={() =>
                  runMutation(updateSettings({weekViewSpan: 2}), 'setWeekSpan')
                }
              >
                {t('nav.weekSpan2')}
              </button>
              <button
                type="button"
                className={spanButtonClass(3)}
                onClick={() =>
                  runMutation(updateSettings({weekViewSpan: 3}), 'setWeekSpan')
                }
              >
                {t('nav.weekSpan3')}
              </button>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                className={themeButtonClass('light')}
                onClick={() => runMutation(updateSettings({theme: 'light'}), 'setTheme')}
              >
                {t('nav.themeLight')}
              </button>
              <button
                type="button"
                className={themeButtonClass('dark')}
                onClick={() => runMutation(updateSettings({theme: 'dark'}), 'setTheme')}
              >
                {t('nav.themeDark')}
              </button>
              <button
                type="button"
                className={themeButtonClass('system')}
                onClick={() => runMutation(updateSettings({theme: 'system'}), 'setTheme')}
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
                  'toggleWeeklyPanel'
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
            <button
              type="button"
              className={primaryBtn}
              onClick={openNew}
              disabled={!canOpenNew}
            >
              + {t('nav.newSchedule')}
            </button>
          </div>
        </header>

        {!loaded && loading && (
          <div className="mb-4 border border-dashed border-line px-4 py-3 text-xs font-mono text-muted">
            {t('loading')}
          </div>
        )}
        {/* Stage 6.5 UX: schedules 빈 상태 onboarding 배너. loaded + 빈 schedules
            + error 없음 조건. 첫 스케줄 추가 CTA 가 4 영역 모두 채우는 효과 시각화. */}
        {loaded && !error && schedules.length === 0 && (
          <div className="mb-6 rounded-none border border-dashed border-line bg-panel px-6 py-8 text-center">
            <p className="mb-2 text-sm font-semibold text-ink font-mono">
              {t('onboarding.welcome')}
            </p>
            <p className="mb-4 text-xs font-normal text-muted font-mono">
              {t('onboarding.firstSchedule')}
            </p>
            <button type="button" className={primaryBtn} onClick={openNew}>
              + {t('onboarding.addFirst')}
            </button>
          </div>
        )}

        {error && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-danger bg-[rgba(224,108,117,0.1)] px-4 py-3 text-xs font-mono text-danger">
            <span>{t('error.loadFailedLabel')} {error}</span>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                init().catch(err => {
                  logClientError('[plan1 · store.init retry]', err);
                });
              }}
              className="rounded-none border border-danger bg-panel px-3 py-1 text-xs text-danger font-mono hover:bg-danger hover:text-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('common.retry')}
            </button>
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
              · {now ? weekRange : t('meta.placeholder')} · span={weekViewSpan}{t('meta.spanSuffix')}
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
                · {now ? todayMeta : t('meta.placeholder')} · {todayEventCount} {t('meta.eventsLabel')}
              </span>
            </h2>
            <DailyTimeline onEventClick={handleEventClick} />
          </section>
          <aside className="space-y-6">
            <section className="rounded-none border border-line bg-panel p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink font-mono">
                {t('header.clock')}
                <span className="ml-1 font-normal text-muted">
                  · {t('meta.twelveHour')} · {now ? ampm : t('meta.placeholder')}
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
                    ? `${activeMeta.count} ${t('meta.activeLabel')} · ${formatElapsedHM(activeMeta.elapsedMin)}`
                    : t('meta.idle')}
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
      <ToastContainer />
    </main>
  );
}
