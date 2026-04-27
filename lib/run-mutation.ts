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
    if (severity !== 'silent') {
      // Stage 5 i18n: context 인자는 dev console 전용 (영어 raw). user-facing toast 에는
      // server error message 만 노출. Stage 5.1 (이월): context 시그니처를 i18n key 로
      // 변경 + server error 도 i18n key throw 패턴 도입 (영어 raw leak 완전 차단).
      pushToast(msg, SEVERITY_TO_TOAST[severity]);
    }
    if (process.env.NODE_ENV !== 'production' && severity !== 'silent') {
      // eslint-disable-next-line no-console
      console.error(`[mutation${context ? ` · ${context}` : ''}]`, msg);
    }
  });
}
