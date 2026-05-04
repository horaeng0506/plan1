'use client';

/**
 * PLAN1-LOGIN-START-OPT-20260504 #5 — 로그인 안 된 상태 UX.
 *
 * 진입 흐름:
 *   1. plan1 GET /project/plan1 (no cookie · no session)
 *   2. middleware.ts authRedirectIfMissingJwt → portal /api/cofounder/refresh-jwt?return=...
 *   3. portal session 없음 → portal /project/sign-in?return=... 으로 redirect
 *   4. 사용자 로그인 안 함 → 다시 plan1 진입 시 store.init() 가 ServerActionError('serverError.unauthorized') throw
 *   5. PlanApp 가 store.errorKey === 'serverError.unauthorized' 분기 → 본 컴포넌트 노출
 *
 * UX:
 *   - "로그인이 필요합니다" + 설명 + CTA "로그인하기" 버튼
 *   - CTA → portal sign-in URL 로 이동 (return 에 현재 plan1 URL 보존)
 *
 * portal_base 결정:
 *   - production: `https://cofounder.co.kr`
 *   - dev/preview: `process.env.NEXT_PUBLIC_PORTAL_ORIGIN` 환경변수 (없으면 cofounder.co.kr)
 */

import {useTranslations} from 'next-intl';

const PORTAL_ORIGIN =
  process.env.NEXT_PUBLIC_PORTAL_ORIGIN ?? 'https://cofounder.co.kr';

export function SignInPrompt() {
  const t = useTranslations('signIn');

  function handleSignIn() {
    if (typeof window === 'undefined') return;
    const currentUrl = window.location.href;
    const signInUrl = new URL(`${PORTAL_ORIGIN}/project/sign-in`);
    signInUrl.searchParams.set('return', currentUrl);
    window.location.href = signInUrl.toString();
  }

  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4"
      role="alert"
      aria-live="polite"
    >
      <h2 className="text-lg font-semibold text-ink font-mono">{t('title')}</h2>
      <p className="max-w-md text-center text-sm text-muted font-mono">
        {t('description')}
      </p>
      <button
        type="button"
        onClick={handleSignIn}
        className="rounded-none border border-ink bg-ink px-6 py-2 text-sm text-bg font-mono hover:opacity-90"
      >
        {t('cta')}
      </button>
    </div>
  );
}
