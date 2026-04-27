/**
 * 모듈 스코프 toast store (Stage 4d-A).
 *
 * 사용자 피드백 채널 — 외부 설계상 단순 함수 호출(`toast(msg, severity)`).
 * `useSyncExternalStore` 로 React 컴포넌트 구독 → ToastContainer 가 렌더.
 * SSR safe — getServerSnapshot 은 빈 배열 freeze.
 *
 * 디자인: DESIGN.md 4채널 위계 운반자 #1 (색상) + #3 (lowercase 단일 동사).
 *   info → text-muted / warn → text-warn / error → text-danger.
 *   prefix 없음 — 색상으로 위계 운반.
 */

export type ToastSeverity = 'info' | 'warn' | 'error';

export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
  ts: number;
}

let toasts: Toast[] = [];
const EMPTY: Toast[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(l => l());
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `t-${Date.now()}-${counter}`;
}

export function pushToast(
  message: string,
  severity: ToastSeverity = 'info',
  ttlMs = 4000
): string {
  const t: Toast = {id: nextId(), message, severity, ts: Date.now()};
  toasts = [...toasts, t];
  notify();
  if (ttlMs > 0) {
    setTimeout(() => dismissToast(t.id), ttlMs);
  }
  return t.id;
}

export function dismissToast(id: string): void {
  const next = toasts.filter(t => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
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
