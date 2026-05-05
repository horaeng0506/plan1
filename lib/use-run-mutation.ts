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
 * Stage 5.1 part 2 (2026-04-28): server action 의 사용자 facing error 는
 * `ServerActionError` 클래스 instance 로 던져짐. 단 server action 자체가 throw
 * 하면 Next.js prod 에서 message 가 redact 되므로 server action 은
 * `createServerAction` HOF 로 감싸 ServerActionResult 로 return 하고,
 * `lib/store.ts` 에서 `unwrapServerActionResult(...)` 가 client-side 로 다시
 * `ServerActionError` throw → 여기서 instance 잡아 t(key, params) 매핑.
 *
 * 일반 Error (PORTAL_ISSUER 누락, DB 연결 실패 등 internal) 는 prod 에서 redact
 * 된 generic 메시지로 노출됨. 이는 의도 — 사용자에게 dev/internal 정보 노출 차단.
 */

import {useTranslations} from 'next-intl';
import {logClientError} from './log';
import {isServerActionError} from './server-action';
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
  | 'toggleWeeklyPanel'
  | 'setFocus';

export function useRunMutation() {
  const t = useTranslations();
  return function run<T>(
    promise: Promise<T>,
    contextKey?: MutationContextKey,
    severity: MutationSeverity = 'error'
  ): void {
    promise.catch((err: unknown) => {
      let displayErrMsg: string;
      if (isServerActionError(err)) {
        // 사용자 facing — i18n key 로 매핑 (Symbol.for brand 검사 — cross-module instanceof 회피)
        displayErrMsg = t(err.errorKey as 'serverError.unauthorized', err.params);
      } else {
        // 일반 Error · prod redacted generic 메시지 등 — fallback unknown
        displayErrMsg = t('error.unknown');
      }
      if (severity !== 'silent') {
        const action = contextKey ? t(`mutation.${contextKey}` as 'mutation.setTheme') : '';
        const userMsg = action
          ? t('error.mutationFailed', {action, error: displayErrMsg})
          : displayErrMsg;
        pushToast(userMsg, SEVERITY_TO_TOAST[severity]);
      }
      if (severity !== 'silent') {
        // logClientError 가 NODE_ENV 가드 처리 (prod silent · dev console.error)
        logClientError(`[mutation${contextKey ? ` · ${contextKey}` : ''}]`, err);
      }
    });
  };
}
