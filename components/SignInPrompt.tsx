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

    // PLAN1-SIGNIN-DIRECT-OAUTH-20260508 (정공 fix · 결함 2):
    // Better Auth /api/auth/sign-in/social POST → 응답의 url 으로 직접 navigate
    // → portal /project 거쳐서 Sign in with Google 또 클릭하는 한 단계 단축
    // callbackURL = current plan1 URL (Better Auth 가 OAuth callback 후 그 URL 으로 redirect)
    const currentUrl = window.location.href;
    try {
      const resp = await fetch(`${PORTAL_ORIGIN}/project/api/auth/sign-in/social`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'include',
        body: JSON.stringify({provider: 'google', callbackURL: currentUrl})
      });
      if (!resp.ok) {
        // sign-in/social 자체 fail (Better Auth provider config 영역) → portal 홈 fallback
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
      // 응답에 url 영역 없음 (예상 외 응답) → portal 홈 fallback
      const portalHome = new URL(`${PORTAL_ORIGIN}/project`);
      portalHome.searchParams.set('return', currentUrl);
      window.location.href = portalHome.toString();
    } catch {
      // network 실패 등 — portal 홈 fallback (옛 chain · UX 결함이지만 안전)
      const portalHome = new URL(`${PORTAL_ORIGIN}/project`);
      portalHome.searchParams.set('return', currentUrl);
      window.location.href = portalHome.toString();
    } finally {
      // window.location.href 후엔 page navigate — busy reset 영역 안 도달
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
