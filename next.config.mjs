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
        'localhost:3456',
        'localhost:3000',
        ...vercelOrigin
      ]
    }
  }
};

export default withNextIntl(nextConfig);
