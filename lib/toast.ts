/**
 * 모듈 스코프 toast store (Stage 4d-A · critic fix 적용).
 *
 * 사용자 피드백 채널 — 외부 설계상 단순 함수 호출(`pushToast(msg, severity)`).
 * `useSyncExternalStore` 로 React 컴포넌트 구독 → ToastContainer 가 렌더.
 * SSR safe — getServerSnapshot 은 EMPTY freeze (getSnapshot 도 초기 EMPTY 공유로 ref 안정).
 *
 * 디자인: DESIGN.md 4채널 위계 운반자 #1 (색상).
 *   info → text-info border-info / warn → text-warn / error → text-danger.
 *   prefix 없음 — 색상으로 위계 운반.
 *
 * critic fix:
 * - env-critic Critical: nextId 에 Math.random 결합 (HMR counter reset 충돌 방어)
 * - env-critic Major: setTimeout handle 추적 + dismissToast 시 clearTimeout (메모리 정리)
 * - ui-critic Major: severity 별 ttl 차등 (info 3s · warn 4s · error 6s)
 */

export type ToastSeverity = 'info' | 'warn' | 'error';

export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
  ts: number;
}

const EMPTY: Toast[] = [];
let toasts: Toast[] = EMPTY;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const DEFAULT_TTL: Record<ToastSeverity, number> = {
  info: 3000,
  warn: 4000,
  error: 6000
};

function notify() {
  listeners.forEach(l => l());
}

function nextId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pushToast(
  message: string,
  severity: ToastSeverity = 'info',
  ttlMs?: number
): string {
  const ttl = ttlMs ?? DEFAULT_TTL[severity];
  const t: Toast = {id: nextId(), message, severity, ts: Date.now()};
  toasts = [...toasts, t];
  notify();
  if (ttl > 0) {
    const handle = setTimeout(() => dismissToast(t.id), ttl);
    timers.set(t.id, handle);
  }
  return t.id;
}

export function dismissToast(id: string): void {
  const handle = timers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    timers.delete(id);
  }
  const next = toasts.filter(t => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next.length === 0 ? EMPTY : next;
  notify();
}

export function subscribeToasts(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getToastsSnapshot(): Toast[] {
  return toasts;
}

export function getToastsServerSnapshot(): Toast[] {
  return EMPTY;
}
