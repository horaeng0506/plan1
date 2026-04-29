/**
 * server action 진입 가드.
 *
 * 모든 plan1 server action 은 진입 첫 줄에서 `requireUser()` 호출 → SessionUser.id 받음.
 * 그 id 로 모든 DB query·mutation 을 `WHERE user_id = session.user.id` 강제.
 * 이 강제가 멀티 테넌트 격리의 유일한 방어선 (RLS 미사용).
 *
 * 인증 흐름:
 *   - portal Better Auth 가 cofounder.co.kr 로그인 시 JWT 발급 + cookie 설정
 *   - cofounder-router 가 plan1 으로 reverse proxy 시 cookie 그대로 전달
 *   - plan1 server action 이 cookie 에서 cofounder_jwt 추출 → verify-session.ts 로 검증
 *
 * 환경 변수:
 *   - PORTAL_ISSUER  (예: production "https://cofounder.co.kr" / dev "http://localhost:3456")
 */

import {cookies, headers} from 'next/headers';
import {ServerActionError} from './server-action';
import {verifySessionJwt, type SessionUser} from './verify-session';

const COOKIE_NAME = 'cofounder_jwt';

function getPortalIssuer(): string {
  const issuer = process.env.PORTAL_ISSUER;
  if (!issuer) {
    throw new Error('PORTAL_ISSUER env var not set (production: https://cofounder.co.kr / dev: http://localhost:3456)');
  }
  return issuer;
}

/**
 * server action / route handler 안에서 호출. 인증된 사용자만 통과.
 * 미인증 시 throw — Next.js 가 server action 에러로 처리해 클라이언트에 401 응답.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentSessionUser();
  if (!user) {
    throw new ServerActionError('serverError.unauthorized');
  }
  return user;
}

/**
 * 인증 선택 사용 (예: 공개 페이지에서 로그인 상태에 따라 다른 동작).
 * server action 자체에선 거의 안 씀 — requireUser 사용.
 */
export async function getCurrentSessionUser(): Promise<SessionUser | null> {
  // Track 1.5 phase 3 instrument (2026-04-29): auth_ms 1464ms 비정상 — sub-phase 측정
  const t0 = Date.now();
  const issuer = getPortalIssuer();
  const t1 = Date.now();

  // 1차: Authorization: Bearer 헤더 (API 호출 클라이언트)
  // Next.js 15+ async request APIs (Stage 8.A · 2026-04-28)
  const headerStore = await headers();
  const t2 = Date.now();
  const authHeader = headerStore.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const result = await verifySessionJwt(authHeader.slice(7).trim(), issuer);
    const t3 = Date.now();
    console.log('[plan1.session.bearer]', JSON.stringify({
      issuer_ms: t1 - t0, headers_ms: t2 - t1, verify_ms: t3 - t2, total_ms: t3 - t0
    }));
    return result;
  }

  // 2차: cookie (브라우저 세션 — 일반 케이스)
  const cookieStore = await cookies();
  const t3 = Date.now();
  const tokenCookie = cookieStore.get(COOKIE_NAME);
  if (tokenCookie?.value) {
    const result = await verifySessionJwt(tokenCookie.value, issuer);
    const t4 = Date.now();
    console.log('[plan1.session.cookie]', JSON.stringify({
      issuer_ms: t1 - t0,
      headers_ms: t2 - t1,
      cookies_ms: t3 - t2,
      verify_ms: t4 - t3,
      total_ms: t4 - t0
    }));
    return result;
  }

  console.log('[plan1.session.nocookie]', JSON.stringify({
    issuer_ms: t1 - t0, headers_ms: t2 - t1, cookies_ms: t3 - t2, total_ms: t3 - t0
  }));
  return null;
}
