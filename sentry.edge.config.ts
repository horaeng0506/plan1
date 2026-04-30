// Sentry edge (middleware/edge runtime) config — Phase 1 S3 (2026-04-30)
//
// 근거: wiki/shared/qa-strategy-research-20260430.md § Phase 1.1

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
