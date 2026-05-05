'use client';

/**
 * PLAN1-LOGIN-START-OPT-20260504 #5 — 로그인 안 된 상태 UX.
 * PLAN1-SIGNIN-URL-FIX-20260505 — CTA URL 정정 (`/project/sign-in` 404 → `/project` 홈)
 *
 * 진입 흐름:
 *   1. plan1 GET /project/plan1 (no cookie · no session)
 *   2. middleware fire X 또는 store.init() server action → unauthorized throw
 *   3. PlanApp 가 store.errorKey === 'serverError.unauthorized' 분기 → 본 컴포넌트 노출
 *   4. 사용자 "로그인하기" 클릭 → portal `/project` 홈 (SignInButton + Google OAuth)
 *
 * UX:
 *   - "로그인이 필요합니다" + 설명 + CTA "로그인하기" 버튼
 *   - CTA → portal 홈 (`/project`) — return param 은 현 portal sign-in 흐름 (Better Auth Google OAuth)
 *     이 callbackURL='/project' 으로 hard-coded → return 보존 후속 PR 영역 (portal SignInButton 변경)
 *
 * 사용자 후속 흐름:
 *   - portal 홈 SignInButton 클릭 → Google OAuth → callback `/project` → 수동 plan1 다시 진입
 *   - return param 자동 redirect 는 portal SignInButton 변경 별 PR (`PLAN1-SIGNIN-RETURN-PARAM`)
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
    // PLAN1-SIGNIN-URL-FIX-20260505: portal 홈 (`/project`) 으로 redirect.
    // 기존 `/project/sign-in` 페이지는 portal 에 미존재 → 404. portal 홈에 SignInButton 컴포넌트 +
    // Better Auth Google OAuth 가 sign-in entry point.
    // return param 보존은 별 PR (portal SignInButton 변경 영역).
    const currentUrl = window.location.href;
    const portalHome = new URL(`${PORTAL_ORIGIN}/project`);
    portalHome.searchParams.set('return', currentUrl);
    window.location.href = portalHome.toString();
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
