'use client';

/**
 * timer1 frozen·idleSince state localStorage persistence
 * (PLAN1-TIMER-DUP-20260504 #4 timer1 초기화 fix).
 *
 * 배경: ActiveTimer 의 frozen·idleSince state 가 useState 로 컴포넌트 안 보관 →
 * 다른 schedule 로 active 가 전환되었다가 돌아오면 useEffect 의 reset 분기
 * (`active?.id !== lastActiveIdRef.current`) 가 idleSince 를 null 로 초기화.
 * 사용자 의도: 진행 중 schedule 의 idle 누적 분이 전환 후 복귀 시에도 보존.
 *
 * 정책 분리:
 *   - server (Neon DB) source of truth = schedule.durationMin (idle 종료 시점에 합산)
 *   - localStorage = idle 진행 중 클라이언트 UI state (transient · 동기화 단위 idleSince ms)
 *   - 즉 idle 진행 중 새로고침/탭전환/active 전환 발생해도 idleSince 복구 가능
 *   - idle 종료 시점에 server.extendScheduleBy 호출 + localStorage 정리
 */

export interface TimerUIState {
  frozen: boolean;
  idleSince: number | null;
}

const STORAGE_KEY = 'plan1.timer-states.v1';

function isClient(): boolean {
  return typeof window !== 'undefined';
}

export function loadAllTimerStates(): Record<string, TimerUIState> {
  if (!isClient()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TimerUIState>;
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    return {};
  }
}

export function loadTimerState(scheduleId: string): TimerUIState {
  const all = loadAllTimerStates();
  return all[scheduleId] ?? {frozen: true, idleSince: null};
}

export function saveTimerState(scheduleId: string, state: TimerUIState): void {
  if (!isClient()) return;
  try {
    const all = loadAllTimerStates();
    all[scheduleId] = state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage quota·세션 모드 etc — 조용히 실패 (UI 동작은 in-memory state 로 계속).
  }
}

export function clearTimerState(scheduleId: string): void {
  if (!isClient()) return;
  try {
    const all = loadAllTimerStates();
    if (scheduleId in all) {
      delete all[scheduleId];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  } catch {
    // see saveTimerState.
  }
}

/**
 * 완료된·삭제된 schedule 의 stale entry 정리 — schedule list 와 cross-check.
 * 호출자: ActiveTimer 가 mount 시 또는 schedule list 갱신 시 1회.
 */
export function pruneTimerStates(activeScheduleIds: string[]): void {
  if (!isClient()) return;
  try {
    const all = loadAllTimerStates();
    const validSet = new Set(activeScheduleIds);
    let changed = false;
    for (const id of Object.keys(all)) {
      if (!validSet.has(id)) {
        delete all[id];
        changed = true;
      }
    }
    if (changed) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 조용히 실패.
  }
}
