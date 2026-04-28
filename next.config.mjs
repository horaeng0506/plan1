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
  // CSP 는 next-intl·Vercel inline 스크립트 호환 검증 후 phased rollout 별도 (Report-Only 1주 → enforce).
  async headers() {
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
          }
        ]
      }
    ];
  }
};

export default withNextIntl(nextConfig);
