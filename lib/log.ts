/**
 * 통합 logger (Stage 7 critic 이월).
 *
 * production console error 정책 일관:
 * - client-side: prod 에선 silent (사용자 콘솔 노이즈 차단). dev 에서만 console.error
 * - server-side: 항상 log (Vercel function logs 자동 캡처. Sentry/Datadog hook 자리)
 *
 * 사용처:
 * - useRunMutation, PlanApp, CategoryManager 같은 client 컴포넌트 → logClientError
 * - server actions, runAction wrapper, verify-session 같은 server-side → logServerError
 *
 * 향후 sentry/datadog 통합 시 logServerError 안에 hook 추가 (logClientError 도 선택적 sentry-browser).
 */

export function logClientError(prefix: string, err: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error(prefix, err);
  }
  // production: silent. 향후 sentry-browser 같은 client logger hook 자리.
}

export function logServerError(prefix: string, err: unknown): void {
  // server-side: 항상 log. Vercel function logs (Logs 탭) 에 자동 캡처.
  console.error(prefix, err);
  // 향후 sentry/datadog 통합 hook 자리.
}

export function logServerWarn(prefix: string, err: unknown): void {
  // server-side warn: 인증 실패 등 expected error 의 진단용. 항상 log.
  console.warn(prefix, err);
}
