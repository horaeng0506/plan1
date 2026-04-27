/**
 * fire-and-forget mutation 핸들러용 공통 .catch 래퍼.
 *
 * void promise() 패턴은 rejection 을 unhandled 로 만들어 toast/UI 피드백 누락 유발.
 * Stage 3e logic-critic Medium #3 대응 + Stage 4d-A toast 통합.
 *
 * severity 'silent' = 토스트·콘솔 모두 출력 안 함 (의도적 무시).
 * 기본 'error' = 사용자에게 toast.error + dev 환경 console.error.
 */

import {pushToast, type ToastSeverity} from './toast';

export type MutationSeverity = 'silent' | 'info' | 'warn' | 'error';

const SEVERITY_TO_TOAST: Record<Exclude<MutationSeverity, 'silent'>, ToastSeverity> = {
  info: 'info',
  warn: 'warn',
  error: 'error'
};

export function runMutation<T>(
  promise: Promise<T>,
  context?: string,
  severity: MutationSeverity = 'error'
): void {
  promise.catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const userMsg = context ? `${context} · ${msg}` : msg;
    if (severity !== 'silent') {
      pushToast(userMsg, SEVERITY_TO_TOAST[severity]);
    }
    // dev 환경 콘솔 흔적 유지 — production 노이즈 방지 위해 NODE_ENV 가드.
    if (process.env.NODE_ENV !== 'production' && severity !== 'silent') {
      // eslint-disable-next-line no-console
      console.error(`[mutation${context ? ` · ${context}` : ''}]`, msg);
    }
  });
}
