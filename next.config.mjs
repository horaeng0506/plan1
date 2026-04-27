import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/project/plan1',
  // env-critic Critical #2 — server action CSRF: cofounder-router reverse proxy 가
  // origin=cofounder.co.kr, host=plan1.vercel.app 으로 분리시킴 → default 매칭 실패 가능.
  // 실제 사용자 진입 origin 명시 (production + 로컬 dev portal).
  experimental: {
    serverActions: {
      allowedOrigins: ['cofounder.co.kr', 'www.cofounder.co.kr', 'localhost:3456']
    }
  }
};

export default withNextIntl(nextConfig);
