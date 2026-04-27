'use client';

/**
 * useRunMutation hook (Stage 5.1).
 *
 * Stage 4d-A 의 lib/run-mutation.ts (string context) 후속. context 인자를 i18n
 * key 로 받아 toast 를 사용자 locale 로 노출. 컴포넌트 외 함수 (useTranslations
 * 호출 불가) 제약 → hook 화 + 클로저 t 캡쳐.
 *
 * 호출 패턴:
 *   const run = useRunMutation();
 *   run(updateSettings({theme: 'dark'}), 'setTheme');  // contextKey
 *
 * Stage 6 이월: server action error message (예: "Category not found or not
 * owned") 의 i18n key throw 패턴 도입 — 현재는 raw error message 를 toast 에
 * 표시 (영어 raw 잠재 노출). Stage 6 서버 측 i18n key 화 후 client 매핑.
 */

import {useTranslations} from 'next-intl';
import {pushToast, type ToastSeverity} from './toast';

export type MutationSeverity = 'silent' | 'info' | 'warn' | 'error';

const SEVERITY_TO_TOAST: Record<Exclude<MutationSeverity, 'silent'>, ToastSeverity> = {
  info: 'info',
  warn: 'warn',
  error: 'error'
};

// i18n key union — 빌드 시 검증 (오타 차단). messages/*.json `mutation.*` 와 동기화.
export type MutationContextKey =
  | 'removeCategory'
  | 'extendTimer'
  | 'completeSchedule'
  | 'changeTimerType'
  | 'pinActiveTimer'
  | 'setWeekSpan'
  | 'setTheme'
  | 'toggleWeeklyPanel';

export function useRunMutation() {
  const t = useTranslations();
  return function run<T>(
    promise: Promise<T>,
    contextKey?: MutationContextKey,
    severity: MutationSeverity = 'error'
  ): void {
    promise.catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (severity !== 'silent') {
        const action = contextKey ? t(`mutation.${contextKey}` as 'mutation.setTheme') : '';
        const userMsg = action
          ? t('error.mutationFailed', {action, error: errMsg})
          : errMsg;
        pushToast(userMsg, SEVERITY_TO_TOAST[severity]);
      }
      if (process.env.NODE_ENV !== 'production' && severity !== 'silent') {
        // eslint-disable-next-line no-console
        console.error(`[mutation${contextKey ? ` · ${contextKey}` : ''}]`, errMsg);
      }
    });
  };
}
