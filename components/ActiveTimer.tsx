'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {useAppStore} from '@/lib/store';
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
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

  if (!active || now === null) {
    return (
      <div className="rounded-none border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 font-mono dark:border-gray-700 dark:text-gray-400">
        # idle · no active schedule
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
    void extendScheduleBy(active.id, mins);
  };
  const complete = () => {
    void completeSchedule(active.id, Date.now());
  };
  const setType = (t: TimerType) => {
    void updateSchedule(active.id, {timerType: t});
  };

  const toggleFreeze = () => {
    if (frozen) {
      setIdleSince(Date.now());
      setFrozen(false);
    } else {
      if (idleSince !== null) {
        const elapsedMs = Date.now() - idleSince;
        const elapsedMin = Math.max(0, Math.round(elapsedMs / 60_000));
        if (elapsedMin > 0) void extendScheduleBy(active.id, elapsedMin);
      }
      setIdleSince(null);
      setFrozen(true);
    }
  };

  const neutralBtn =
    'rounded-none border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 font-mono hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800';
  const primaryBtn =
    'rounded-none border border-gray-900 bg-gray-900 px-2 py-1 text-xs text-white font-mono hover:bg-gray-800 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200';
  const typeBtn = (on: boolean) =>
    `flex-1 rounded-none border px-2 py-1 text-xs font-mono transition-colors ${
      on
        ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800'
    }`;
  const freezeBtn = (focused: boolean) =>
    `w-full rounded-none border px-3 py-2 text-sm font-mono transition-colors ${
      focused
        ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'
        : 'border-red-600 bg-red-600/10 text-red-600 hover:bg-red-600/20 dark:text-red-400 dark:border-red-400 dark:bg-red-400/10 dark:hover:bg-red-400/20'
    }`;

  return (
    <div className="rounded-none border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      {actives.length > 1 && (
        <div className="mb-2 text-[10px] font-mono text-gray-500 dark:text-gray-400">
          <span className="text-[#d19a66]"># 겹침 {actives.length}개 </span>· pin=
          <select
            value={pinnedActiveId ?? ''}
            onChange={e => {
              void updateSettings({pinnedActiveId: e.target.value || null});
            }}
            className="ml-1 rounded-none border border-gray-300 bg-white px-1 py-0.5 text-[10px] font-mono dark:border-gray-700 dark:bg-gray-950"
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
        <span className="text-[#5c6370]">▸</span>
        {category && (
          <span
            className="inline-block h-3 w-3 rounded-none"
            style={{backgroundColor: category.color}}
          />
        )}
        <span className="truncate text-sm font-mono font-medium text-gray-800 dark:text-gray-200">
          {active.title}
        </span>
      </div>
      <div className="mb-3 text-[10px] font-mono text-gray-500 dark:text-gray-400">
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
          <div className="mb-1 text-xs font-mono text-gray-500 dark:text-gray-400"># elapsed</div>
          <div className="mb-3 font-mono text-5xl font-medium tracking-tight text-gray-900 dark:text-gray-100">
            {formatHMS(elapsed)}
          </div>
        </>
      )}
      {isTimer1 && (
        <>
          <div className="mb-1 text-xs font-mono text-gray-500 dark:text-gray-400"># target</div>
          <div className="mb-1 font-mono text-4xl font-medium tracking-tight text-gray-900 dark:text-gray-100">
            {formatWall12(displayEndAt)}
          </div>
          <div className="mb-3 text-xs font-mono text-gray-500 dark:text-gray-400">
            # elapsed {formatHMS(now - active.startAt)}
          </div>
          <button type="button" onClick={toggleFreeze} className={freezeBtn(frozen) + ' mb-3'}>
            {frozen ? '[focus] (click to idle)' : '[idle] (click to focus)'}
          </button>
        </>
      )}
      {isCountdown && (
        <>
          <div className="mb-1 text-xs font-mono text-gray-500 dark:text-gray-400"># remaining</div>
          <div className="mb-1 font-mono text-5xl font-medium tracking-tight text-gray-900 dark:text-gray-100">
            {formatHMS(remaining)}
          </div>
          <div className="mb-3 text-xs font-mono text-gray-500 dark:text-gray-400">
            # end-at {formatWall12(endAt)}
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
          <span className="opacity-70">! </span>complete
        </button>
      </div>
    </div>
  );
}
