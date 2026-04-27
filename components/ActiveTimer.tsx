'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {useAppStore} from '@/lib/store';
import {useNow} from '@/lib/now';
import {runMutation} from '@/lib/run-mutation';
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

function formatHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatWall12(ms: number): string {
  const d = new Date(ms);
  const h24 = d.getHours();
  const ampm = h24 < 12 ? '오전' : '오후';
  const h12 = ((h24 + 11) % 12) + 1;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${ampm} ${h12}:${mm}:${ss}`;
}

export function ActiveTimer() {
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);
  const pinnedActiveId = useAppStore(s => s.settings.pinnedActiveId);
  const updateSettings = useAppStore(s => s.updateSettings);
  const extendScheduleBy = useAppStore(s => s.extendScheduleBy);
  const completeSchedule = useAppStore(s => s.completeSchedule);
  const updateSchedule = useAppStore(s => s.updateSchedule);
  // Stage 4d-B: useState+interval → 공유 useNow (1초 interval 단일화).
  // hydration 가드: nowMs === 0 → null (SSR snapshot · canSubmit/findActive 차단).
  const nowMs = useNow();
  const now: number | null = nowMs > 0 ? nowMs : null;

  const actives = useMemo(
    () => (now === null ? [] : findActiveSchedules(schedules, now)),
    [schedules, now]
  );
  const pinned = pinnedActiveId ? actives.find(a => a.id === pinnedActiveId) : null;
  const active = pinned ?? actives[0] ?? null;

  const [frozen, setFrozen] = useState<boolean>(true);
  const [idleSince, setIdleSince] = useState<number | null>(null);
  const lastActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (active?.id !== lastActiveIdRef.current) {
      lastActiveIdRef.current = active?.id ?? null;
      setFrozen(true);
      setIdleSince(null);
    }
  }, [active?.id]);

  // toggleFreeze busy state — 빠른 토글 race 방지 (Stage 3e logic-critic Medium #4).
  // Stage 3f logic-critic Critical: 두 분기 모두 togglePending 체크 — focus→idle 도 락 진입.
  const [togglePending, setTogglePending] = useState(false);

  if (!active || now === null) {
    return (
      <div className="rounded-none border border-dashed border-line p-6 text-center text-sm text-muted font-mono">
        idle · no active schedule
      </div>
    );
  }

  const category = categories.find(c => c.id === active.categoryId);
  const endAt = active.startAt + active.durationMin * 60_000;
  const isCountup = active.timerType === 'countup';
  const isTimer1 = active.timerType === 'timer1';
  const isCountdown = active.timerType === 'countdown';

  const elapsed = now - active.startAt;
  const remaining = Math.max(0, endAt - now);
  const displayEndAt =
    isTimer1 && !frozen && idleSince !== null ? endAt + (now - idleSince) : endAt;

  const bump = (mins: number) => {
    runMutation(extendScheduleBy(active.id, mins), 'extend timer');
  };
  const complete = () => {
    runMutation(completeSchedule(active.id, Date.now()), 'complete schedule');
  };
  const setType = (t: TimerType) => {
    runMutation(updateSchedule(active.id, {timerType: t}), 'change timer type');
  };

  const toggleFreeze = async () => {
    if (togglePending) return;
    setTogglePending(true);
    try {
      if (frozen) {
        // focus → idle: 진입 시각만 기록, server 호출 없음 (idle 종료 시점에 모아 호출).
        setIdleSince(Date.now());
        setFrozen(false);
        return;
      }
      // idle → focus: 누적 idle 시간을 server 에 반영.
      if (idleSince !== null) {
        const elapsedMs = Date.now() - idleSince;
        const elapsedMin = Math.max(0, Math.round(elapsedMs / 60_000));
        if (elapsedMin > 0) await extendScheduleBy(active.id, elapsedMin);
      }
      setIdleSince(null);
      setFrozen(true);
    } finally {
      setTogglePending(false);
    }
  };

  // Stage 4a 4채널 토큰화 (gray-* dark:* → bg/panel/line/muted/txt/ink).
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
    <div className="rounded-none border border-line bg-panel p-4">
      {actives.length > 1 && (
        <div className="mb-2 text-[10px] font-mono text-muted">
          <span className="text-warn">겹침 {actives.length}개</span> · pin=
          <select
            value={pinnedActiveId ?? ''}
            onChange={e => {
              runMutation(
                updateSettings({pinnedActiveId: e.target.value || null}),
                'pin active timer'
              );
            }}
            className="ml-1 rounded-none border border-line bg-panel px-1 py-0.5 text-[10px] font-mono text-txt"
          >
            <option value="">auto (첫 번째)</option>
            {actives.map(a => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </div>
      )}
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
        type={active.timerType} · cat={category?.name ?? '?'}
      </div>
      <div className="mb-2 flex gap-1">
        <button type="button" onClick={() => setType('countup')} className={typeBtn(isCountup)}>
          countup
        </button>
        <button type="button" onClick={() => setType('timer1')} className={typeBtn(isTimer1)}>
          timer1
        </button>
        <button type="button" onClick={() => setType('countdown')} className={typeBtn(isCountdown)}>
          countdown
        </button>
      </div>
      {isCountup && (
        <>
          <div className="mb-1 text-xs font-mono text-muted">elapsed</div>
          <div className="mb-3 font-mono text-5xl font-medium tracking-tight text-ink">
            {formatHMS(elapsed)}
          </div>
        </>
      )}
      {isTimer1 && (
        <>
          <div className="mb-1 text-xs font-mono text-muted">target</div>
          <div className="mb-1 font-mono text-4xl font-medium tracking-tight text-ink">
            {formatWall12(displayEndAt)}
          </div>
          <div className="mb-3 text-xs font-mono text-muted">
            elapsed · {formatHMS(now - active.startAt)}
          </div>
          <button
            type="button"
            onClick={toggleFreeze}
            className={freezeBtn(frozen) + ' mb-3 whitespace-nowrap'}
            title={frozen ? '클릭하면 idle 로 전환' : '클릭하면 focus 로 전환'}
          >
            {frozen ? 'focus' : 'idle'}
          </button>
        </>
      )}
      {isCountdown && (
        <>
          <div className="mb-1 text-xs font-mono text-muted">remaining</div>
          <div className="mb-1 font-mono text-5xl font-medium tracking-tight text-ink">
            {formatHMS(remaining)}
          </div>
          <div className="mb-3 text-xs font-mono text-muted">
            end-at · {formatWall12(endAt)}
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
          complete
        </button>
      </div>
    </div>
  );
}
