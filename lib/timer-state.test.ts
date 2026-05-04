import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  loadTimerState,
  saveTimerState,
  clearTimerState,
  pruneTimerStates,
  loadAllTimerStates,
} from './timer-state';

const STORAGE_KEY = 'plan1.timer-states.v1';

interface MockStorage {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear: () => void;
}

function createMockStorage(): MockStorage {
  const store = new Map<string, string>();
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: k => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  const storage = createMockStorage();
  // timer-state.ts 의 isClient() = `typeof window !== 'undefined'` 만 검사.
  // window.localStorage 만 있으면 함수 동작. jsdom 의존 회피.
  vi.stubGlobal('window', {localStorage: storage});
});

describe('timer-state persistence (PLAN1-TIMER-DUP #4)', () => {
  it('loadTimerState returns default when not stored', () => {
    expect(loadTimerState('s1')).toEqual({frozen: true, idleSince: null});
  });

  it('saveTimerState then loadTimerState returns saved value', () => {
    saveTimerState('s1', {frozen: false, idleSince: 1_700_000_000_000});
    expect(loadTimerState('s1')).toEqual({frozen: false, idleSince: 1_700_000_000_000});
  });

  it('multiple schedules keep independent state (idle 진행 중 active 전환 후 복귀)', () => {
    // 시나리오: s1 idle 진행 중 → s2 active → s1 로 복귀 → s1 의 idleSince 보존
    saveTimerState('s1', {frozen: false, idleSince: 1_111});
    saveTimerState('s2', {frozen: true, idleSince: null});
    expect(loadTimerState('s1')).toEqual({frozen: false, idleSince: 1_111});
    expect(loadTimerState('s2')).toEqual({frozen: true, idleSince: null});
  });

  it('clearTimerState removes specified entry only', () => {
    saveTimerState('a', {frozen: false, idleSince: 100});
    saveTimerState('b', {frozen: true, idleSince: null});
    clearTimerState('a');
    expect(loadTimerState('a')).toEqual({frozen: true, idleSince: null});
    expect(loadTimerState('b')).toEqual({frozen: true, idleSince: null});
    expect('a' in loadAllTimerStates()).toBe(false);
    expect('b' in loadAllTimerStates()).toBe(true);
  });

  it('pruneTimerStates removes stale (deleted/completed) schedule entries', () => {
    saveTimerState('alive', {frozen: false, idleSince: 1});
    saveTimerState('stale', {frozen: false, idleSince: 2});
    pruneTimerStates(['alive']);
    expect('alive' in loadAllTimerStates()).toBe(true);
    expect('stale' in loadAllTimerStates()).toBe(false);
  });

  it('handles malformed JSON gracefully (returns defaults)', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-json');
    expect(loadTimerState('s1')).toEqual({frozen: true, idleSince: null});
    expect(loadAllTimerStates()).toEqual({});
  });

  it('save survives page reload simulation (localStorage 직접 read)', () => {
    saveTimerState('persist', {frozen: false, idleSince: 9_999});
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.persist).toEqual({frozen: false, idleSince: 9_999});
  });

  it('SSR safe — when window undefined, loaders return defaults / setters no-op', () => {
    vi.stubGlobal('window', undefined);
    expect(loadTimerState('any')).toEqual({frozen: true, idleSince: null});
    expect(() => saveTimerState('any', {frozen: false, idleSince: 1})).not.toThrow();
    expect(() => clearTimerState('any')).not.toThrow();
    expect(() => pruneTimerStates(['x'])).not.toThrow();
  });
});
