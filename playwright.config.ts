import {defineConfig, devices} from '@playwright/test';

/**
 * plan1 mutation E2E gate (Track 2 C-2.5 · 2026-04-29).
 *
 * 시나리오: tests/qa-gate/*.spec.ts 가 portal Better Auth qa-bot sign-in 후
 *   plan1 의 핵심 mutation (schedule 추가) 응답 시간을 SLA 게이트 (< 3000ms warm).
 *
 * 인증: tests/qa-gate/auth.setup.ts 가 portal /api/auth/sign-in/email POST +
 *   /api/cofounder/refresh-jwt GET 으로 cofounder_jwt cookie 발급 → .auth/qa-bot.json
 *   에 storageState 저장. spec 들이 그 storageState 재사용.
 *
 * 환경:
 *   - PLAYWRIGHT_BASE_URL  대상 plan1 URL (default: cofounder.co.kr/project/plan1/)
 *   - PORTAL_BASE_URL      sign-in 호출 대상 portal (default: cofounder.co.kr)
 *   - QA_TEST_USER_EMAIL   portal qa-bot identifier (secrets/global.env)
 *   - QA_TEST_USER_PASSWORD portal qa-bot password (secrets/global.env)
 *
 * 근거: wiki/shared/saas-qa-gate-research-20260429.md § 5 / 6
 */

// baseURL 은 origin 만 — spec 에서 /project/plan1/ 등 절대 path 명시.
// (Playwright baseURL 은 절대 path goto 시 path 부분 drop)
const PLAN1_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? 'https://cofounder.co.kr';

export default defineConfig({
  testDir: './tests/qa-gate',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', {open: 'never'}]],
  timeout: 30_000,
  use: {
    baseURL: PLAN1_BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Vercel Protection Bypass for Automation — preview URL (Vercel SSO 게이트) 우회.
    // prod URL (cofounder.co.kr) 대상 시 secret 미설정 → 헤더 추가 안 함.
    // x-vercel-set-bypass-cookie 는 후속 페이지 로드 (rewrites · redirects) 도 bypass 유지.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          'x-vercel-set-bypass-cookie': 'true'
        }
      : {}
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/
    },
    {
      name: 'mutation-e2e',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/qa-bot.json'
      },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts$/
    }
  ]
});
