// Sentry server (Node.js) config — Phase 1 S3 (2026-04-30)
//
// 근거: wiki/shared/qa-strategy-research-20260430.md § Phase 1.1
// 정책:
//   - DSN 미설정 시 자동 비활성 (enabled flag)
//   - tracesSampleRate 0.1 (Server Action·route handler 응답 시간 분포)
//   - 4/29 cross-continent latency 같은 server-side 회귀 자동 catch (mutation E2E gate 보완재)

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
