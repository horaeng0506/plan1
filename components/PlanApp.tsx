'use client';

import {useEffect, useState} from 'react';
import dynamic from 'next/dynamic';
import {useTranslations} from 'next-intl';
import {logClientError} from '@/lib/log';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {AnalogClock} from './AnalogClock';
import {ActiveTimer} from './ActiveTimer';
import {ToastContainer} from './ToastContainer';
import {SignInPrompt} from './SignInPrompt';
import {ModalSkeleton} from './ModalSkeleton';
import type {Theme} from '@/lib/domain/types';

// Stage 4d-B: 모달 lazy import (사용자 trigger 전 로드 안 됨 → bundle 절약).
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

// FullCalendar v6 는 SSR 시 document/window 직접 접근 위험 — env-critic Stage 3e 진입 게이트.
// next/dynamic({ssr:false}) 으로 client 진입 후에만 로드.
// Stage 5: skeleton 텍스트는 정적 영어. KO/JA 환경에서도 1~2초 짧게 노출되는
// loading state 라 i18n 미적용 허용.
const DailyTimelineSkeleton = () => (
  <div className="h-64 border border-dashed border-line p-4 text-xs font-mono text-muted">
    timeline · loading...
  </div>
);

// PLAN1-FOCUS-VIEW-REDESIGN-20260506: WeeklyCalendar 폐기 (1일 개념 폐기 + 집중 보기 모드 정합).
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
  // PLAN1-LOGIN-START-OPT-20260504 #5: unauthorized 식별 → SignInPrompt 분기.
  const errorKey = useAppStore(s => s.errorKey);
  const init = useAppStore(s => s.init);
  const theme = useAppStore(s => s.settings.theme);
  const updateSettings = useAppStore(s => s.updateSettings);
  // Track 1 fix (2026-04-29): canOpenNew 가드용 categories select.
  const categories = useAppStore(s => s.categories);

  const [newOpen, setNewOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Stage 3e env-critic Critical: store.init() 트리거. layout/page 단일 진입점에서 1회 호출.
  // Stage 3f Playwright 회귀 fix: error 발생 시에도 재진입 방지.
  useEffect(() => {
    if (!loaded && !loading && !error) {
      init().catch(err => {
        logClientError('[plan1 · store.init]', err);
      });
    }
  }, [loaded, loading, error, init]);

  // 테마 effect — system 환경 매체 변경 추적.
  // Stage 4a env-critic Critical fix: globals.css 4채널 토큰 .light/.dark class 기반 swap 와 짝.
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

  // Track 1 fix (2026-04-29 · logic-critic): listCategories 시드 전 모달 진입 시 modal
  // useState 초기값이 빈 categoryId 캡처 → submit 시 categoryNotFound throw.
  const canOpenNew = loaded && categories.length > 0;
  const openNew = () => {
    if (!canOpenNew) return;
    setEditingId(null);
    setNewOpen(true);
  };
  const handleEventClick = (id: string) => {
    setNewOpen(false);
    setEditingId(id);
  };

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

  // PLAN1-LOGIN-START-OPT-20260504 #5: unauthorized 시 SignInPrompt 만 노출.
  if (errorKey === 'serverError.unauthorized') {
    return (
      <main className="min-h-screen bg-bg text-txt">
        <SignInPrompt />
      </main>
    );
  }

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
        {/* Stage 6.5 UX: schedules 빈 상태 onboarding 배너. */}
        {loaded && !error && (useAppStore.getState().schedules.length === 0) && (
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

        {/* PLAN1-FOCUS-VIEW-REDESIGN-20260506: 헤더 메타 (status meta bar) 폐기.
            DailyTimeline 자체 헤더 안 focus select 가 시간 범위 표시 운반. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <section className="rounded-none border border-line bg-panel p-4">
            <DailyTimeline onEventClick={handleEventClick} />
          </section>
          <aside className="space-y-6">
            <section className="rounded-none border border-line bg-panel p-4">
              <AnalogClock />
            </section>
            <section>
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
      <ToastContainer />
    </main>
  );
}
