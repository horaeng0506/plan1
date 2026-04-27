/**
 * 포털(`cofounder.co.kr/project`)의 Better Auth 가 발급한 JWT 를 plan1 에서 검증.
 * portal/lib/verify-session.ts 와 동일 패턴 (copymaker1 Stage 6 reference).
 *
 * - 포털이 `/api/auth/jwks` 엔드포인트 노출
 * - plan1 은 `jose` 로 JWKS 조회 + JWT 서명 검증 (stateless · DB 불필요)
 * - issuer = `https://cofounder.co.kr` (production) / `http://localhost:3456` (dev portal)
 */

import {jwtVerify, createRemoteJWKSet} from 'jose';

export type SessionUser = {
  id: string;
  email?: string;
  name?: string;
  image?: string;
};

export async function verifySessionJwt(
  token: string,
  issuer: string
): Promise<SessionUser | null> {
  try {
    const jwks = createRemoteJWKSet(new URL(`${issuer}/api/auth/jwks`));
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
  } catch {
    return null;
  }
}

export async function getCurrentUser(
  request: Request,
  issuer: string
): Promise<SessionUser | null> {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return verifySessionJwt(authHeader.slice(7).trim(), issuer);
  }
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)cofounder_jwt=([^;]+)/);
  if (match) {
    return verifySessionJwt(decodeURIComponent(match[1]), issuer);
  }
  return null;
}
