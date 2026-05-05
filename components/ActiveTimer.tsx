'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useNow} from '@/lib/now';
import {useCategoryDisplay} from '@/lib/category-display';
import {useRunMutation} from '@/lib/use-run-mutation';
import {pad2} from '@/lib/date-format';
import {
  loadTimerState,
  saveTimerState,
  clearTimerState,
  pruneTimerStates,
  type TimerUIState
} from '@/lib/timer-state';
import type {Schedule, TimerType} from '@/lib/domain/types';

function findActiveSchedules(schedules: Schedule[], now: number): Schedule[] {
  const result: Schedule[] = [];
  for (const s of schedules) {
    if (s.status === 'done') continue;
    const end = s.startAt + s.durationMin * 60_000;
    if (s.startAt <= now && now < end) result.push(s);
  }
  return result;
}

/**
 * PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q26 a): 빈 시간 카운트다운용 — "지금부터 향후 24h 안"
 * 미완료 schedule 중 가장 이른 것. 1일 개념 폐기 후 "오늘 한정" 필터 폐기.
 */
function findNextUpcoming(schedules: Schedule[], now: number): Schedule | null {
  const limit = now + 24 * 3600_000;
  let best: Schedule | null = null;
  for (const s of schedules) {
    if (s.status === 'done') continue;
    if (s.startAt <= now) continue;
    if (s.startAt >= limit) continue;
    if (!best || s.startAt < best.startAt) best = s;
  }
  return best;
}

function formatHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function formatWall12(ms: number, amLabel: string, pmLabel: string): string {
  const d = new Date(ms);
  const h24 = d.getHours();
  const ampm = h24 < 12 ? amLabel : pmLabel;
  const h12 = ((h24 + 11) % 12) + 1;
  return `${ampm} ${h12}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

interface TimerCardProps {
  active: Schedule;
  now: number;
  amLabel: string;
  pmLabel: string;
}

/**
 * 단일 schedule 의 timer 표시 + 컨트롤. PLAN1-TIMER-DUP-20260504 #6.2 위해 함수
 * 분리 — main 1개 표시 vs 2개 동시 표시 시 동일 컴포넌트 재사용.
 *
 * timer1 persistence (#4): frozen·idleSince 를 schedule.id 별 localStorage 보관.
 * 다른 schedule 로 active 전환되었다가 돌아와도 idleSince 보존 → idle 누적 분
 * 잃지 않음. idle 종료 시점 (focus 복귀) 에 server.extendScheduleBy 합산 + clear.
 */
function TimerCard({active, now, amLabel, pmLabel}: TimerCardProps) {
  const t = useTranslations();
  const runMutation = useRunMutation();
  const categoryDisplay = useCategoryDisplay();
  const categories = useAppStore(s => s.categories);
  const extendScheduleBy = useAppStore(s => s.extendScheduleBy);
  const completeSchedule = useAppStore(s => s.completeSchedule);
  const updateSchedule = useAppStore(s => s.updateSchedule);

  // localStorage backed state — schedule.id 별 보존. SSR snapshot 단계 (typeof window
  // === 'undefined') 에선 default {frozen:true, idleSince:null}, mount 후 rehydrate.
  const [timerUI, setTimerUI] = useState<TimerUIState>({
    frozen: true,
    idleSince: null
  });
  const lastIdRef = useRef<string | null>(null);
  useEffect(() => {
    // active.id 변경 시 (또는 첫 mount) localStorage 에서 rehydrate.
    if (active.id !== lastIdRef.current) {
      lastIdRef.current = active.id;
      setTimerUI(loadTimerState(active.id));
    }
  }, [active.id]);

  // 변경 시 localStorage 동기화. mount 직후 default 값 저장은 회피 (lastIdRef 동기화 후).
  useEffect(() => {
    if (lastIdRef.current === active.id) {
      saveTimerState(active.id, timerUI);
    }
  }, [active.id, timerUI]);

  const [togglePending, setTogglePending] = useState(false);

  const category = categories.find(c => c.id === active.categoryId);
  const endAt = active.startAt + active.durationMin * 60_000;
  const isCountup = active.timerType === 'countup';
  const isTimer1 = active.timerType === 'timer1';
  const isCountdown = active.timerType === 'countdown';

  const elapsed = now - active.startAt;
  const remaining = Math.max(0, endAt - now);
  const displayEndAt =
    isTimer1 && !timerUI.frozen && timerUI.idleSince !== null
      ? endAt + (now - timerUI.idleSince)
      : endAt;

  const bump = (mins: number) => {
    runMutation(extendScheduleBy(active.id, mins), 'extendTimer');
  };
  const complete = () => {
    clearTimerState(active.id);
    runMutation(completeSchedule(active.id, Date.now()), 'completeSchedule');
  };
  const setType = (typ: TimerType) => {
    runMutation(updateSchedule(active.id, {timerType: typ}), 'changeTimerType');
  };

  const toggleFreeze = async () => {
    if (togglePending) return;
    setTogglePending(true);
    try {
      if (timerUI.frozen) {
        // focus → idle: 진입 시각만 기록, server 호출 없음 (idle 종료 시점에 모아 호출).
        setTimerUI({frozen: false, idleSince: Date.now()});
        return;
      }
      // idle → focus: 누적 idle 시간을 server 에 반영.
      if (timerUI.idleSince !== null) {
        const elapsedMs = Date.now() - timerUI.idleSince;
        const elapsedMin = Math.max(0, Math.round(elapsedMs / 60_000));
        if (elapsedMin > 0) await extendScheduleBy(active.id, elapsedMin);
      }
      setTimerUI({frozen: true, idleSince: null});
    } finally {
      setTogglePending(false);
    }
  };

  const neutralBtn =
    'rounded-none border border-line bg-panel px-2 py-1 text-xs text-txt font-mono hover:bg-bg';
  const primaryBtn =
    'rounded-none border border-ink bg-ink px-2 py-1 text-xs text-bg font-mono hover:opacity-90';
  const typeBtn = (on: boolean) =>
    `flex-1 rounded-none border px-2 py-1 text-xs font-mono transition-colors ${
      on
        ? 'bg-ink text-bg border-ink'
        : 'bg-panel text-txt border-line hover:bg-bg'
    }`;
  const freezeBtn = (focused: boolean) =>
    `w-full rounded-none border px-3 py-2 text-sm font-mono transition-colors ${
      focused
        ? 'border-ink bg-ink text-bg hover:opacity-90'
        : 'border-danger bg-[rgba(224,108,117,0.1)] text-danger hover:bg-[rgba(224,108,117,0.2)]'
    }`;

  return (
    <div className="rounded-none border border-line bg-panel p-4" data-testid="timer-card" data-schedule-id={active.id}>
      <div className="mb-1 flex items-center gap-2">
        {category && (
          <span
            className="inline-block h-3 w-3 rounded-none"
            style={{backgroundColor: category.color}}
          />
        )}
        <span className="truncate text-sm font-mono font-medium text-ink">
          {active.title}
        </span>
      </div>
      <div className="mb-3 text-[10px] font-mono text-muted">
        type={active.timerType} · cat={category ? categoryDisplay(category) : t('timer.categoryFallback')}
      </div>
      <div className="mb-2 flex gap-1">
        <button type="button" onClick={() => setType('countup')} className={typeBtn(isCountup)}>
          {t('timer.typeCountup')}
        </button>
        <button type="button" onClick={() => setType('timer1')} className={typeBtn(isTimer1)}>
          {t('timer.typeTimer1')}
        </button>
        <button type="button" onClick={() => setType('countdown')} className={typeBtn(isCountdown)}>
          {t('timer.typeCountdown')}
        </button>
      </div>
      {isCountup && (
        <>
          <div className="mb-1 text-xs font-mono text-muted">{t('timer.labelElapsed')}</div>
          <div className="mb-3 font-mono text-5xl font-medium tracking-tight text-ink">
            {formatHMS(elapsed)}
          </div>
        </>
      )}
      {isTimer1 && (
        <>
          <div className="mb-1 text-xs font-mono text-muted">{t('timer.labelTarget')}</div>
          <div className="mb-1 font-mono text-4xl font-medium tracking-tight text-ink">
            {formatWall12(displayEndAt, amLabel, pmLabel)}
          </div>
          <div className="mb-3 text-xs font-mono text-muted">
            {t('timer.labelElapsed')} · {formatHMS(now - active.startAt)}
          </div>
          <button
            type="button"
            onClick={toggleFreeze}
            className={freezeBtn(timerUI.frozen) + ' mb-3 whitespace-nowrap'}
            title={timerUI.frozen ? t('timer.tooltipClickToIdle') : t('timer.tooltipClickToFocus')}
          >
            {timerUI.frozen ? t('timer.buttonFocus') : t('timer.buttonIdle')}
          </button>
        </>
      )}
      {isCountdown && (
        <>
          <div className="mb-1 text-xs font-mono text-muted">{t('timer.labelRemaining')}</div>
          <div className="mb-1 font-mono text-5xl font-medium tracking-tight text-ink">
            {formatHMS(remaining)}
          </div>
          <div className="mb-3 text-xs font-mono text-muted">
            {t('timer.labelEndAt')} · {formatWall12(endAt, amLabel, pmLabel)}
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => bump(-30)} className={neutralBtn}>
          -30m
        </button>
        <button type="button" onClick={() => bump(-10)} className={neutralBtn}>
          -10m
        </button>
        <button type="button" onClick={() => bump(10)} className={neutralBtn}>
          +10m
        </button>
        <button type="button" onClick={() => bump(30)} className={neutralBtn}>
          +30m
        </button>
        <button type="button" onClick={complete} className={primaryBtn}>
          {t('timer.buttonComplete')}
        </button>
      </div>
    </div>
  );
}

interface IdleCountdownProps {
  upcoming: Schedule;
  now: number;
}

/**
 * PLAN1-TIMER-DUP-20260504 #3: 빈 시간 카운트다운 — 다음 schedule 까지 남은 시간.
 * 디자인 차별화: 점선 테두리 + 흐릿한 muted 톤 + "다음 스케줄까지" 라벨.
 */
function IdleCountdown({upcoming, now}: IdleCountdownProps) {
  const t = useTranslations();
  const categoryDisplay = useCategoryDisplay();
  const categories = useAppStore(s => s.categories);
  const category = categories.find(c => c.id === upcoming.categoryId);
  const remaining = Math.max(0, upcoming.startAt - now);
  return (
    <div
      className="rounded-none border border-dashed border-line bg-panel p-4 opacity-70"
      data-testid="idle-countdown"
      data-upcoming-id={upcoming.id}
    >
      <div className="mb-1 text-xs font-mono text-muted uppercase tracking-wider">
        {t('timer.labelUpcoming')}
      </div>
      <div className="mb-3 flex items-center gap-2">
        {category && (
          <span
            className="inline-block h-3 w-3 rounded-none opacity-70"
            style={{backgroundColor: category.color}}
          />
        )}
        <span className="truncate text-sm font-mono text-muted">
          {upcoming.title}
        </span>
      </div>
      <div className="mb-1 text-xs font-mono text-muted">{t('timer.labelUntilUpcoming')}</div>
      <div className="font-mono text-4xl font-medium tracking-tight text-muted">
        {formatHMS(remaining)}
      </div>
      <div className="mt-2 text-[10px] font-mono text-muted opacity-80">
        cat={category ? categoryDisplay(category) : t('timer.categoryFallback')}
      </div>
    </div>
  );
}

export function ActiveTimer() {
  const t = useTranslations();
  const schedules = useAppStore(s => s.schedules);
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q23): pinnedActiveId UI 폐기 (MAX_OVERLAP=2 후 사용 영역 거의 없음).
  // Stage 4d-B: useState+interval → 공유 useNow (1초 interval 단일화).
  // hydration 가드: nowMs === 0 → null (SSR snapshot · canSubmit/findActive 차단).
  const nowMs = useNow();
  const now: number | null = nowMs > 0 ? nowMs : null;
  // Stage 5 critic logic Minor #2: 1초 tick 매번 t() 호출 회피 — useMemo 1회.
  const wallLabels = useMemo(
    () => ({am: t('wallTime.am'), pm: t('wallTime.pm')}),
    [t]
  );

  const actives = useMemo(
    () => (now === null ? [] : findActiveSchedules(schedules, now)),
    [schedules, now]
  );
  const upcoming = useMemo(
    () => (now === null ? null : findNextUpcoming(schedules, now)),
    [schedules, now]
  );

  // localStorage stale entry 정리 — schedule list 변경 시 1회.
  // pruneTimerStates 는 SSR safe (typeof window check).
  useEffect(() => {
    pruneTimerStates(schedules.map(s => s.id));
  }, [schedules]);

  // Empty / hydration 단계.
  if (now === null) {
    return (
      <div className="rounded-none border border-dashed border-line p-6 text-center text-sm text-muted font-mono">
        {t('timer.idleEmpty')}
      </div>
    );
  }

  // PLAN1-TIMER-DUP-20260504 #6.2: actives.length === 2 시 둘 다 동시 표시 (stack).
  // length >= 3 (legacy 데이터 — validation 도입 후 새로 생기지 않음) 시 기존 pin
  // 1개 표시 패턴 유지. length === 1 시 단일 표시. length === 0 시 #3 idle countdown.
  if (actives.length === 0) {
    if (upcoming) return <IdleCountdown upcoming={upcoming} now={now} />;
    return (
      <div className="rounded-none border border-dashed border-line p-6 text-center text-sm text-muted font-mono">
        {t('timer.idleEmpty')}
      </div>
    );
  }

  if (actives.length === 2) {
    return (
      <div className="flex flex-col gap-3" data-testid="active-timer-multi">
        <div className="text-[10px] font-mono text-muted uppercase tracking-wider">
          {t('timer.simultaneousLabel', {count: 2})}
        </div>
        {actives.map(a => (
          <TimerCard key={a.id} active={a} now={now} amLabel={wallLabels.am} pmLabel={wallLabels.pm} />
        ))}
      </div>
    );
  }

  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q23): pin UI 폐기. 3개+ legacy 케이스만 첫 번째 표시 + 경고 라벨.
  const active = actives[0];

  return (
    <div className="flex flex-col gap-2">
      {actives.length > 2 && (
        <div className="text-[10px] font-mono text-warn">
          {t('timer.overlapLabel', {count: actives.length})}
        </div>
      )}
      <TimerCard active={active} now={now} amLabel={wallLabels.am} pmLabel={wallLabels.pm} />
    </div>
  );
}
