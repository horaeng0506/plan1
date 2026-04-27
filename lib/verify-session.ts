/**
 * 포털(`cofounder.co.kr/project`)의 Better Auth 가 발급한 JWT 를 plan1 에서 검증.
 * portal/lib/verify-session.ts 와 동일 패턴 (copymaker1 Stage 6 reference).
 *
 * - 포털이 `/api/auth/jwks` 엔드포인트 노출
 * - plan1 은 `jose` 로 JWKS 조회 + JWT 서명 검증 (stateless · DB 불필요)
 * - issuer = `https://cofounder.co.kr` (production) / `http://localhost:3456` (dev portal)
 */

import {jwtVerify, createRemoteJWKSet} from 'jose';
import {logServerWarn} from './log';

export type SessionUser = {
  id: string;
  email?: string;
  name?: string;
  image?: string;
};

// JWKS singleton 캐시 (env-critic Critical #1).
// 매 호출 신규 createRemoteJWKSet 하면 jose 내부 캐시 무력화 → portal /jwks DDoS 가능.
// issuer 별 인스턴스 1개 유지 + 30초 cooldown + 10분 max age.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/api/auth/jwks`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000
    });
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

export async function verifySessionJwt(
  token: string,
  issuer: string
): Promise<SessionUser | null> {
  try {
    const jwks = getJwks(issuer);
    const {payload} = await jwtVerify(token, jwks, {
      issuer,
      audience: issuer
    });

    const user: SessionUser = {
      id: String(payload.sub ?? ''),
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      image: typeof payload.image === 'string' ? payload.image : undefined
    };

    if (!user.id) return null;
    return user;
  } catch (e) {
    // env-critic Minor — silent catch 가 디버깅 막음. Vercel function logs 에 노출.
    logServerWarn('[verify-session] JWT verify failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// dead code — security-auditor MEDIUM 지적: lib/auth-helpers.ts 의 cookies().get()
// 경로와 별개의 raw cookie 파싱 path 가 공존하면 정책 drift 위험. 사용처 0건 (2026-04-28
// 기준 — grep getCurrentUser/getJwks 결과 verify-session.ts 외 매칭 없음). 미래에
// route handler 에서 필요해지면 lib/auth-helpers.ts 패턴으로 통합 신규 구현 권장.
