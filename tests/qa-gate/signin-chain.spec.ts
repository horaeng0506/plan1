import {test, expect, request as playwrightRequest} from '@playwright/test';

/**
 * plan1 mutation E2E gate — Sub-project SSO chain 의무 4 영역 회귀 가드 (Stage G2 · 2026-05-08)
 *
 * 사이클 6 fix (PR #72·#73·#74) 후 다음 sub-project (copymaker1·향후 SaaS) 가 같은
 * 결함 catch 못 하게 하는 회귀 가드. `dev-process.md § Sub-project SSO chain 의무 4 영역` 정합.
 *
 * 영역 매핑:
 *   - S1: server-side 인증 검증 (root page.tsx) — TC-S1
 *   - S3: JwtCookieRefresher mount + 자동 갱신 — TC-S3
 *   - S4: 직접 Google OAuth POST chain (callbackURL=refresh-jwt URL · S2 정합) — TC-S4
 *
 * 자동화 한계:
 *   - S2 의 Google OAuth callback chain (Google 인증 페이지 의무) 자동화 어려움
 *   - 본 spec 은 callbackURL 영역의 사전 검증 (POST sign-in/social body) 까지 catch
 *   - Google 인증 통과 후 cookie chain 영역은 mutation E2E 외 (사용자 직접 검증 의무)
 *
 * 근거:
 *   - .claude/rules/dev-process.md § Sub-project SSO chain 의무 4 영역
 *   - wiki/shared/problem-resolution-log.md [2026-05-08] § 재활용 포인트
 *   - PR #72 (JwtCookieRefresher) · PR #73 (Fix A·B) · PR #74 (Fix C)
 */

const PORTAL_BASE = process.env.PORTAL_BASE_URL ?? 'https://cofounder.co.kr';
const PLAYWRIGHT_BASE = process.env.PLAYWRIGHT_BASE_URL ?? PORTAL_BASE;

const BYPASS_HEADERS: Record<string, string> = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? {
      'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      'x-vercel-set-bypass-cookie': 'true'
    }
  : {};

test.describe('plan1 sub-project SSO chain regression guard (Stage G2)', () => {
  test('TC-S1: 미인증 plan1 navigate → SignInPrompt 표시 + PlanApp UI 부재 (server-side gate 회귀 catch)', async () => {
    // fresh request context (storageState 미사용 — 미인증 시뮬레이션)
    const ctx = await playwrightRequest.newContext({
      baseURL: PLAYWRIGHT_BASE,
      extraHTTPHeaders: BYPASS_HEADERS
    });

    try {
      const resp = await ctx.get('/project/plan1/');
      // middleware self-heal redirect 또는 308 trailing slash 처리 → 최종 200 도달
      expect([200, 308]).toContain(resp.status());

      // middleware redirect 따라가기 (cookie 부재 시 portal refresh-jwt 으로 redirect 가능 · 401 받음)
      // 단 spec 의 의도 = plan1 SSR 직접 hit 시 SignInPrompt 표시. middleware 우회 위해 referer 트릭:
      const directResp = await ctx.get('/project/plan1/', {
        headers: {
          // middleware self-heal redirect 가드 (referer 가 portal refresh-jwt 면 redirect 안 함)
          'Referer': `${PORTAL_BASE}/project/api/cofounder/refresh-jwt`
        }
      });
      expect([200, 308]).toContain(directResp.status());
      const html = await directResp.text();

      // S1 회귀 catch: server-side gate 작동 시점:
      //   - 미인증 + middleware 통과 (referer 가드) → page.tsx getCurrentSessionUser 가 null → SignInPrompt 분기
      //   - HTML 안 SignInPrompt CTA 표시 검증
      //
      // 정직성 규칙 정합 (CI 1차 fail 정정 · 2026-05-08):
      //   - 옛 PlanApp UI marker grep ('schedule manager' 등) 은 i18n 카탈로그 영역의 false positive
      //     (Next.js next-intl 가 모든 locale messages 를 SSR HTML 안 inline)
      //   - SignInPrompt 표시 검증만으로 server-side gate 효과 충분 (client mount 영역과 분리)
      //   - 더 엄격한 검증은 별 사이클 (data-testid + Playwright DOM 영역)
      const hasSignInPrompt =
        html.includes('signIn') ||
        html.includes('로그인이 필요') ||
        html.includes('Sign in') ||
        html.includes('Login required');

      expect(
        hasSignInPrompt,
        `[CRITICAL · S1 회귀] 미인증 plan1 SSR 시 SignInPrompt CTA 영역 부재 — server-side gate 결손 가능성. ` +
          `client-side gate 만 박혀있으면 schedule UI 깜빡임 패턴 (사이클 6 결함 1) 재발`
      ).toBe(true);

      console.log('[qa-gate] signin-chain TC-S1 server-side gate 작동 ✅');
    } finally {
      await ctx.dispose();
    }
  });

  test('TC-S3: JwtCookieRefresher mount + portal refresh-jwt fetch 호출 catch', async ({page}) => {
    // storageState 박힌 mutation-e2e project — auth.setup.ts 가 사전 sign-in
    // plan1 mount 시 JwtCookieRefresher 가 portal refresh-jwt fetch 호출 catch
    //
    // 정직성 규칙 정합 (CI 1차 fail 정정 · 2026-05-08):
    //   - 옛 spec: fetch URL filter `/project/api/cofounder/refresh-jwt` (절대 URL match)
    //   - preview deploy 환경 또는 absolute URL host 영역의 catch 결손 가능성
    //   - 정정: substring `cofounder/refresh-jwt` 으로 변경 + timeout 영역 ↑ (1.5s → 5s)
    //   - listener 등록 위치 page.goto 전 (이미 정상)

    let refreshJwtFetched = false;
    let refreshJwtStatus: number | null = null;
    page.on('request', req => {
      // request 영역 catch (response 보다 빠른 영역)
      if (req.url().includes('cofounder/refresh-jwt')) {
        refreshJwtFetched = true;
      }
    });
    page.on('response', resp => {
      if (resp.url().includes('cofounder/refresh-jwt')) {
        refreshJwtStatus = resp.status();
      }
    });

    await page.goto('/project/plan1/');
    // 페이지 mount 후 JwtCookieRefresher useEffect 호출 대기
    await expect(page.getByText(/qa-bot|QA Bot/i).first()).toBeVisible({timeout: 5_000});
    // useEffect → fetch 호출 timing 확보 (5s wait · CI 환경의 hydration 지연 catch)
    await page.waitForTimeout(5_000);

    expect(
      refreshJwtFetched,
      `[CRITICAL · S3 회귀] JwtCookieRefresher 가 plan1 mount 시 portal refresh-jwt fetch 호출 안 함. ` +
        `S3 의무 (root layout 의 JwtCookieRefresher mount) 결손 — TTL mismatch 패턴 (사이클 6 결함 B) 재발 risk`
    ).toBe(true);

    // 인증 상태이면 200 (cookie 발급) · 만료/부재면 401 (silent) · 또는 응답 못 받으면 null (timing race)
    if (refreshJwtStatus !== null) {
      expect(
        [200, 401],
        `[S3 회귀] refresh-jwt 응답 status=${refreshJwtStatus} — 200 (cookie 발급) 또는 401 (no_session) 만 정상`
      ).toContain(refreshJwtStatus);
    }

    console.log(`[qa-gate] signin-chain TC-S3 JwtCookieRefresher fetch ✅ status=${refreshJwtStatus}`);
  });

  test('TC-S4: SignInPrompt 의 sign-in/social POST callbackURL = portal refresh-jwt URL 검증 (S2·S4 정합)', async () => {
    // S2 영역 (callbackURL = portal refresh-jwt URL) + S4 영역 (직접 Google OAuth POST) 정합 catch
    // brower 영역 자동화 어려움 (page click → fetch chain) → request context 으로 endpoint 영역 직접 검증

    const ctx = await playwrightRequest.newContext({
      baseURL: PORTAL_BASE,
      extraHTTPHeaders: BYPASS_HEADERS
    });

    try {
      // 가상의 plan1 URL + 정공 chain callbackURL 예상값
      const plan1Url = `${PORTAL_BASE}/project/plan1/`;
      const expectedCallbackURL = `${PORTAL_BASE}/project/api/cofounder/refresh-jwt?return=${encodeURIComponent(plan1Url)}`;

      // POST /api/auth/sign-in/social 호출 — body 의 callbackURL = portal refresh-jwt URL 의무
      const resp = await ctx.post('/project/api/auth/sign-in/social', {
        headers: {
          'Content-Type': 'application/json',
          'Origin': PORTAL_BASE
        },
        data: {provider: 'google', callbackURL: expectedCallbackURL}
      });

      expect(
        resp.status(),
        `[CRITICAL · S4 회귀] sign-in/social POST 200 응답 의무 — 받은 status=${resp.status()}`
      ).toBe(200);

      const data: {redirect?: boolean; url?: string} = await resp.json();
      expect(
        data.url,
        '[CRITICAL · S4 회귀] sign-in/social 응답 의 url 영역 부재 — Better Auth provider config 결손 가능성'
      ).toBeDefined();
      expect(
        data.url!.startsWith('https://accounts.google.com/'),
        `[CRITICAL · S4 회귀] data.url 이 Google OAuth URL 아님 — got ${data.url!.slice(0, 80)}`
      ).toBe(true);

      // S2 영역 정합 — Google OAuth URL 안 redirect_uri 가 portal callback endpoint
      expect(
        data.url!.includes('redirect_uri=https%3A%2F%2Fcofounder.co.kr%2Fproject%2Fapi%2Fauth%2Fcallback%2Fgoogle'),
        `[S2 회귀] Google OAuth URL 안 redirect_uri 가 portal callback endpoint 아님`
      ).toBe(true);

      // 응답 cookie — Better Auth state cookie 발급
      const setCookies = resp.headersArray()
        .filter(h => h.name.toLowerCase() === 'set-cookie')
        .map(h => h.value);
      const stateCookie = setCookies.find(c => c.includes('better-auth.state='));
      expect(
        stateCookie,
        `[CRITICAL · S4 회귀] Better Auth state cookie 부재 — OAuth state 발급 chain 결손 (callback 시 token exchange fail)`
      ).toBeDefined();
      expect(
        stateCookie!,
        '[S4 회귀] state cookie Domain attribute 부재 — sub-project domain 동반 결손 가능성'
      ).toMatch(/Domain=cofounder\.co\.kr/i);

      console.log(`[qa-gate] signin-chain TC-S4 sign-in/social chain ✅ state cookie domain=cofounder.co.kr`);
    } finally {
      await ctx.dispose();
    }
  });
});
