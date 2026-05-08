'use client';

/**
 * PLAN1-LOGIN-START-OPT-20260504 #5 — 로그인 안 된 상태 UX.
 * PLAN1-SIGNIN-URL-FIX-20260505 — CTA URL 정정 (`/project/sign-in` 404 → `/project` 홈)
 * PLAN1-SIGNIN-DIRECT-OAUTH-20260508 — "로그인하기" 클릭 → 직접 Google OAuth (정공 fix · 결함 2)
 *
 * 진입 흐름 (정공 · 대장 to-be 그림 정합):
 *   1. plan1 GET /project/plan1 (no cookie · no session)
 *   2. server-side 인증 검증 (app/page.tsx) → 미인증 → 본 컴포넌트 즉시 렌더 (PlanApp import 차단)
 *   3. 사용자 "로그인하기" 클릭 → portal /api/auth/sign-in/social 직접 호출 → Google OAuth 화면
 *   4. Google 인증 → callback → callbackURL = plan1 URL → 자동 plan1 redirect (한 단계 단축)
 *
 * 옛 chain (결함 2):
 *   - "로그인하기" → portal /project 홈 (Sign in with Google 버튼 표시) → 사용자 또 클릭 → Google OAuth
 *   - 한 단계 더 — UX 결함
 *
 * UX:
 *   - "로그인이 필요합니다" + 설명 + CTA "로그인하기" 버튼
 *   - CTA → Better Auth /api/auth/sign-in/social POST → 응답의 url 으로 window.location.href 직접 redirect
 *
 * portal_base 결정:
 *   - production: `https://cofounder.co.kr`
 *   - dev/preview: `process.env.NEXT_PUBLIC_PORTAL_ORIGIN` 환경변수 (없으면 cofounder.co.kr)
 */

import {useState} from 'react';
import {useTranslations} from 'next-intl';

const PORTAL_ORIGIN =
  process.env.NEXT_PUBLIC_PORTAL_ORIGIN ?? 'https://cofounder.co.kr';

export function SignInPrompt() {
  const t = useTranslations('signIn');
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    if (typeof window === 'undefined') return;
    if (busy) return;
    setBusy(true);

    // PLAN1-SIGNIN-DIRECT-OAUTH-20260508 — Fix B (직접 Google OAuth · 결함 2 해결)
    // PLAN1-SIGNIN-CALLBACK-VIA-REFRESH-JWT-20260508 — Fix C (callback chain · 결함 3 해결)
    //
    // 결함 3 (영상 002.mov 2026-05-08 catch):
    //   - Google OAuth 인증 통과 후 callbackURL=plan1URL 으로 redirect → plan1 도착 시 cofounder_jwt 부재
    //   - plan1 page.tsx server component 가 cofounder_jwt 만 검증 (Better Auth session_token 별 영역)
    //   - middleware self-heal redirect chain 영역 결손 또는 timing race
    //   - 결과: 사용자 영상 plan1 도착해도 "로그인이 필요합니다" 잔존 (Better Auth session 발급됐는데 cofounder_jwt 부재)
    //
    // 정공 fix (Fix C):
    //   - callbackURL = portal /api/cofounder/refresh-jwt?return=<plan1URL>
    //   - Better Auth callback 후 portal refresh-jwt 진입
    //   - portal refresh-jwt 가 Better Auth session 검증 (cookie 동반) → cofounder_jwt 발급 + redirect to plan1
    //   - plan1 도착 시 cofounder_jwt 동반 → page.tsx getCurrentSessionUser 통과 → PlanApp 정상
    //
    // chain 정합:
    //   1. SignInPrompt 클릭 → POST /api/auth/sign-in/social {provider:'google', callbackURL: refreshJwtUrl}
    //   2. Better Auth 응답 → Google OAuth URL (callbackURL 박힘 in state cookie)
    //   3. Google 인증 → callback to portal /api/auth/callback/google
    //   4. callback handler → setSessionCookie + redirect to refreshJwtUrl
    //   5. portal refresh-jwt → Better Auth session 검증 → cofounder_jwt 발급 + redirect to plan1
    //   6. plan1 도착 → cofounder_jwt 동반 → page.tsx 통과 → PlanApp 렌더 ✅
    const currentUrl = window.location.href;
    const refreshJwtUrl = `${PORTAL_ORIGIN}/project/api/cofounder/refresh-jwt?return=${encodeURIComponent(currentUrl)}`;

    try {
      const resp = await fetch(`${PORTAL_ORIGIN}/project/api/auth/sign-in/social`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({provider: 'google', callbackURL: refreshJwtUrl})
      });
      if (!resp.ok) {
        // sign-in/social 자체 fail → portal 홈 fallback (옛 chain)
        const portalHome = new URL(`${PORTAL_ORIGIN}/project`);
        portalHome.searchParams.set('return', currentUrl);
        window.location.href = portalHome.toString();
        return;
      }
      const data: {redirect?: boolean; url?: string} = await resp.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      const portalHome = new URL(`${PORTAL_ORIGIN}/project`);
      portalHome.searchParams.set('return', currentUrl);
      window.location.href = portalHome.toString();
    } catch {
      const portalHome = new URL(`${PORTAL_ORIGIN}/project`);
      portalHome.searchParams.set('return', currentUrl);
      window.location.href = portalHome.toString();
    } finally {
      setBusy(false);
    }
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
        disabled={busy}
        className="rounded-none border border-ink bg-ink px-6 py-2 text-sm text-bg font-mono hover:opacity-90 disabled:opacity-60"
      >
        {t('cta')}
      </button>
    </div>
  );
}
