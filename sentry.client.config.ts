// Sentry client (browser) config — Phase 1 S3 (2026-04-30)
//
// 근거: wiki/shared/qa-strategy-research-20260430.md § Phase 1.1
// 정책:
//   - DSN 미설정 시 자동 비활성 (enabled flag) — 대장 sentry.io 가입·DSN 발급 전에도 코드 통합 안전
//   - tracesSampleRate 0.1 (10% 샘플링) — Sentry free tier (100k event/mo) 안 운영
//   - 4/29 5초 latency 같은 사용자 인터랙션 회귀를 prod 사용자 발견 전 catch

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // production source map upload 은 별도 PR 에서 (org·project·auth token 필요)
  // 현재는 minified stack trace 만 — 2026-04-30 첫 도입 baseline
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});
