import {test as setup, expect, request as playwrightRequest} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

/**
 * QA mutation E2E 인증 setup (Track 2 C-2.5 · 2026-04-29).
 *
 * 흐름:
 *   1. portal /api/auth/sign-in/email POST (qa-bot creds) → better-auth.session_token
 *   2. portal /api/cofounder/refresh-jwt GET → cofounder_jwt cookie 발급
 *   3. plan1 baseURL 의 cookie domain (.cofounder.co.kr) 으로 storageState 저장
 *
 * spec 들이 .auth/qa-bot.json 재사용 → 매 테스트 마다 sign-in 재호출 X
 * → portal Better Auth rate limit (3 req/10s) 충돌 회피.
 */

const STORAGE_STATE_PATH = path.resolve('.auth/qa-bot.json');
const PORTAL_BASE = process.env.PORTAL_BASE_URL ?? 'https://cofounder.co.kr';

setup('authenticate qa-bot', async () => {
  const email = process.env.QA_TEST_USER_EMAIL;
  const password = process.env.QA_TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'QA_TEST_USER_EMAIL · QA_TEST_USER_PASSWORD env 누락. ~/wiki-root/secrets/global.env 또는 CI secrets 확인.'
    );
  }

  // 1·2단계는 같은 request context 안에서 진행 — cookie 자동 보존
  const ctx = await playwrightRequest.newContext({
    baseURL: PORTAL_BASE
  });

  // 1. sign-in
  const signInResp = await ctx.post('/project/api/auth/sign-in/email', {
    headers: {'Content-Type': 'application/json'},
    data: {email, password}
  });
  expect(
    signInResp.status(),
    `portal sign-in expected 200 — got ${signInResp.status()} ${await signInResp.text()}`
  ).toBe(200);
  const signInBody = await signInResp.json();
  expect(signInBody.user?.email).toBe(email);

  // 2. refresh-jwt → cofounder_jwt cookie 발급
  const refreshResp = await ctx.get('/project/api/cofounder/refresh-jwt');
  expect(
    refreshResp.status(),
    `portal refresh-jwt expected 200 — got ${refreshResp.status()} ${await refreshResp.text()}`
  ).toBe(200);
  const refreshBody = await refreshResp.json();
  expect(refreshBody.ok).toBe(true);
  expect(refreshBody.user?.email).toBe(email);

  // 3. storageState 저장 + NEXT_LOCALE cookie 주입
  //    APIRequestContext 는 addCookies 미노출 → storageState() 결과 JSON 에 직접 push.
  //    plan1 i18n/request.ts 가 NEXT_LOCALE 쿠키 우선 (Accept-Language 무시).
  const state = await ctx.storageState();
  state.cookies.push({
    name: 'NEXT_LOCALE',
    value: 'ko',
    domain: '.cofounder.co.kr',
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: 'Lax'
  });

  // 3.5 preview URL 대상일 때 — cofounder.co.kr 도메인 cookie 가 plan1 Vercel preview host
  //     (예: plan1-xxx.vercel.app) 에 자동 전송 안 됨. preview host 에 모든 cofounder.co.kr cookie
  //     명시 inject (cookie-cutter from portal Step 13.c PR #21).
  //
  // 미래 server-side `auth.api.getSession()` 검증 spec 신설 시 better-auth.session_token 도
  // 필요. 현 verify-session.ts 만 쓰는 spec 은 cofounder_jwt 만 필요하지만, cookie-cutter drift
  // 차단 위해 모든 cookie inject (logic-critic 권고 반영).
  //
  // F6 옵션 A (2026-05-04): `vercel deploy --force` 는 분리 적용 안 함 (회귀 catch 후).
  const previewBaseUrl =
    process.env.PLAYWRIGHT_BASE_URL ?? 'https://cofounder.co.kr';
  const previewHost = new URL(previewBaseUrl).hostname;
  if (previewHost !== 'cofounder.co.kr' && !previewHost.endsWith('.cofounder.co.kr')) {
    const cofounderCookies = state.cookies.filter(c =>
      c.domain === '.cofounder.co.kr' || c.domain === 'cofounder.co.kr'
    );
    for (const c of cofounderCookies) {
      state.cookies.push({
        ...c,
        domain: previewHost,
        sameSite: 'Lax'
      });
    }
    state.cookies.push({
      name: 'NEXT_LOCALE',
      value: 'ko',
      domain: previewHost,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax'
    });
  }

  fs.mkdirSync(path.dirname(STORAGE_STATE_PATH), {recursive: true});
  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(state, null, 2));
  await ctx.dispose();

  // sanity — cofounder_jwt 가 storageState 에 박혔는지 확인
  const stored = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf-8')) as {
    cookies: Array<{name: string; domain: string}>;
  };
  const cookieNames = stored.cookies.map(c => c.name);
  const hasJwt =
    cookieNames.includes('cofounder_jwt') ||
    cookieNames.some(n => n.endsWith('cofounder_jwt'));
  expect(
    hasJwt,
    `cofounder_jwt cookie 누락 — storageState cookies: ${cookieNames.join(',')}`
  ).toBe(true);
});
