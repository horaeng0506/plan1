// Next.js instrumentation hook — Phase 1 S3 (2026-04-30)
//
// 근거: wiki/shared/qa-strategy-research-20260430.md § Phase 1.1
// register() 안에서 runtime 별 sentry config 동적 import.
// onRequestError → Sentry.captureRequestError 위임 (Server Action·route handler 에러 자동 capture).

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
