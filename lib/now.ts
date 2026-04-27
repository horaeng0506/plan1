/**
 * 공유 now 클럭 — 단일 1초 interval + useSyncExternalStore subscribe pattern.
 *
 * Stage 4d-B critic Major fix: PlanApp/AnalogClock/ActiveTimer/NewScheduleModal 가
 * 각자 useState+useEffect interval 또는 모듈 스코프 nowCache 로 분산. 1초 interval
 * 4개 동시 실행 + 동기화 race 잠재. 단일 모듈로 통합 — 첫 subscriber 가 interval
 * 시작, 마지막 unsubscribe 시 cleanup.
 *
 * SSR safe: getNowServerSnapshot = 0 (frozen) 반환. 클라 mount 후 subscribeNow 가
 * 실제값 set + notify. canSubmit 등 hydration 가드는 `now > 0` 검증.
 */

import {useSyncExternalStore} from 'react';

let nowCache = 0;
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function notify(): void {
  listeners.forEach(l => l());
}

function ensureInterval(): void {
  if (intervalId !== null) return;
  nowCache = Date.now();
  intervalId = setInterval(() => {
    nowCache = Date.now();
    notify();
  }, 1000);
}

function teardownIfIdle(): void {
  if (intervalId !== null && listeners.size === 0) {
    clearInterval(intervalId);
    intervalId = null;
    // nowCache 는 0 으로 reset 하지 않음 — 다음 subscribe 시 ensureInterval 가
    // Date.now() 재할당. 0 reset 시 hydration 가드 (`now > 0`) 가 일시적 false 로
    // 떨어져 사용자 인터랙션 차단 위험.
  }
}

export function subscribeNow(cb: () => void): () => void {
  listeners.add(cb);
  ensureInterval();
  return () => {
    listeners.delete(cb);
    teardownIfIdle();
  };
}

export function getNow(): number {
  return nowCache;
}

export function getNowServerSnapshot(): number {
  return 0;
}

export function useNow(): number {
  return useSyncExternalStore(subscribeNow, getNow, getNowServerSnapshot);
}
