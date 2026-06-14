/**
 * plan1-mobile A1 — REST API 세션 JWT 인증 (Decision A1 설계 노트 GAP 3).
 *
 * `/api/v1/tasks` 의 bearer auth(`lib/api-auth.ts`)는 3rd-party 용 `plan1_api_*` API key
 * (token bucket) 경로다. 모바일 앱(plan1-mobile)은 portal Better Auth 세션 JWT(`cofounder_jwt`)
 * 로 자기 데이터를 다루므로 별개 인증 경로가 필요하다.
 *
 * 흐름:
 *   1. Authorization: Bearer <cofounder_jwt> (모바일 네이티브)
 *   2. lib/verify-session.ts 의 verifySessionJwt(JWKS 서명 검증 · aud=iss · stateless) 재사용
 *   3. {user} 반환 — 핸들러가 모든 query 에 WHERE user_id = user.id 강제 (IDOR 차단)
 *
 * ⚡ Bearer 헤더 전용 (쿠키 인증 의도적 미지원):
 *   - state-changing REST 엔드포인트에 cofounder_jwt 쿠키 인증을 허용하면 CSRF 표면이 생긴다
 *     (브라우저가 쿠키를 자동 첨부 → 타 사이트가 인증된 mutation 유발). Bearer 는 자동 첨부
 *     안 되므로 CSRF-safe. 모바일 앱은 Bearer 사용 · 웹은 server action(getCurrentSessionUser
 *     쪽 쿠키 경로)을 그대로 사용하므로 REST 는 Bearer-only 가 정공. (A4 에서 웹→REST 전환 시
 *     쿠키 필요해지면 CSRF 토큰 동반해 별도 도입.)
 *
 * verify-session.ts 는 변경하지 않는다 (server action·route 공용 검증기 단일 원천).
 * Request 기반(api-auth.ts 와 동일 결)이라 CORS 헤더 붙은 401 envelope 를 돌려준다.
 */

import {NextResponse} from 'next/server';
import {verifySessionJwt, type SessionUser} from '@/lib/verify-session';

export interface SessionAuthSuccess {
  ok: true;
  user: SessionUser;
}
export type SessionAuthResult = SessionAuthSuccess | {ok: false; response: NextResponse};

export function sessionCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type'
  };
}

function unauthorized(reason: string): NextResponse {
  return NextResponse.json(
    {data: null, error: {code: 'unauthorized', message: reason}},
    {status: 401, headers: sessionCorsHeaders()}
  );
}

function getPortalIssuer(): string {
  const issuer = process.env.PORTAL_ISSUER;
  if (!issuer) {
    throw new Error(
      'PORTAL_ISSUER env var not set (production: https://cofounder.co.kr / dev: http://localhost:3456)'
    );
  }
  return issuer;
}

/** Authorization Bearer 헤더에서만 토큰 추출 (쿠키 미지원 · CSRF-safe · 위 § 참조). */
function extractToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

/**
 * route handler 안에서 호출. 인증된 세션 사용자만 통과.
 * 실패 시 {ok:false, response} (CORS 헤더 붙은 401) 반환 — 핸들러가 그대로 return.
 */
export async function authenticateSession(request: Request): Promise<SessionAuthResult> {
  const token = extractToken(request);
  if (!token) {
    return {ok: false, response: unauthorized('Missing session token')};
  }
  const issuer = getPortalIssuer();
  const user = await verifySessionJwt(token, issuer);
  if (!user) {
    return {ok: false, response: unauthorized('Invalid or expired session token')};
  }
  return {ok: true, user};
}

export function buildSessionOptionsResponse(): NextResponse {
  return new NextResponse(null, {status: 204, headers: sessionCorsHeaders()});
}
