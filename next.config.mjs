import {withSentryConfig} from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// security-auditor MEDIUM: PORTAL_ISSUER 미설정 시 런타임 매 요청 500 폭발 회피.
// 빌드 시점에 fail-fast — Vercel 빌드 단계에서 잡혀 production 첫 5분 outage 차단.
// (Vercel Settings → Environment Variables 에 PORTAL_ISSUER 등록 필수)
if (!process.env.PORTAL_ISSUER) {
  throw new Error(
    'PORTAL_ISSUER env var is required at build time. ' +
      'Set in Vercel Settings → Environment Variables (production / preview / development).'
  );
}

// Vercel 자동 주입 환경변수 — preview URL 동적 추가 (Stage 7).
// VERCEL_URL 형식: 'plan1-git-foo-team.vercel.app' (preview) 또는 production URL.
// Next.js 14 allowedOrigins 는 wildcard 미지원 → 빌드 시점 정확 URL 주입.
const vercelOrigin = process.env.VERCEL_URL ? [process.env.VERCEL_URL] : [];
const isProduction = process.env.NODE_ENV === 'production';

// ship-gate security Low (2026-04-28): production 빌드에서 localhost dev origin 제거 (정합성).
// Next.js dev 빌드에서만 dev portal/dev next 두 origin 허용.
const devOrigins = isProduction ? [] : ['localhost:3456', 'localhost:3000'];

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/project/plan1',
  // env-critic Critical #2 — server action CSRF: cofounder-router reverse proxy 가
  // origin=cofounder.co.kr, host=plan1.vercel.app 으로 분리시킴 → default 매칭 실패 가능.
  // 실제 사용자 진입 origin 명시 (production + 로컬 dev portal + Vercel preview).
  experimental: {
    serverActions: {
      allowedOrigins: [
        'cofounder.co.kr',
        'www.cofounder.co.kr',
        ...devOrigins,
        ...vercelOrigin
      ]
    }
  },
  // ship-gate security Medium (2026-04-28): 보안 헤더 일괄 적용.
  // CSP 는 phased rollout — Report-Only 1주 (위반 console 노출 모니터) → enforce 전환.
  async headers() {
    // CSP Report-Only directives.
    // - 'unsafe-inline' style: Tailwind inline · Next.js framework inline 필요
    // - 'unsafe-inline' script: Next.js bootstrap inline (서비스 워커 nonce 도입 후 제거 검토)
    // - 'unsafe-eval' script: Vercel · Next.js dev/Turbopack 호환
    // - frame-ancestors 'none': X-Frame-Options DENY 와 일관 (CSP 가 더 강한 deny)
    // - connect-src: server actions · JWKS endpoint · Vercel telemetry
    // - font-src 'self' data:: JetBrains Mono · 자체 hosted (외부 font CDN 미사용)
    const cspReportOnly = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://cofounder.co.kr https://*.vercel.app",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://cofounder.co.kr"
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {key: 'X-Frame-Options', value: 'SAMEORIGIN'},
          {key: 'X-Content-Type-Options', value: 'nosniff'},
          {key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'},
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          },
          // CSP Report-Only — 1주 모니터 후 enforce 전환 (Stage 8.G phased rollout).
          // 위반 시 브라우저 console 에 'CSP report' 노출 + 페이지 동작 영향 0.
          {key: 'Content-Security-Policy-Report-Only', value: cspReportOnly}
        ]
      }
    ];
  }
};

// Phase 1 S3 (2026-04-30): Sentry 통합 — DSN 미설정 시 SDK no-op (대장 sentry.io 가입·DSN 발급 전 안전).
// org/project/authToken 미설정 시 source map upload skip (조용히 빌드 통과).
// 근거: wiki/shared/qa-strategy-research-20260430.md § Phase 1.1
export default withSentryConfig(withNextIntl(nextConfig), {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: false,
  // tunnel 우회 (ad-blocker 회피) 는 별도 PR (rewrites 충돌 검증 필요)
  tunnelRoute: undefined
});
