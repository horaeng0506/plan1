/**
 * plan1 — REST 이중 인증 dispatch (대장 2026-07-02).
 *
 * 하나의 엔드포인트를 세션 JWT(앱·웹 본인) **또는** API 키(plan1_api_*, 외부 클라이언트)
 * 둘 다로 인증할 수 있게 한다. `/api/v1/schedules`(기존 세션 전용) 를 외부 API 키로도
 * 열어 "각 사용자가 자기 API 키로 자기 일정을 추가·조회" 하게 하기 위함.
 *
 * 판정:
 *   - Authorization: Bearer <token> 의 token 이 `plan1_api_` prefix → API 키 경로
 *     (`authenticateApiKey` · hash lookup + token bucket rate limit)
 *   - 그 외 → 세션 JWT 경로 (`authenticateSession` · JWKS 서명 검증)
 *
 * ⚡ 실제 인증(hash·timingSafeEqual·JWKS 검증·rate limit)은 기존 두 함수를 **그대로 재사용**.
 *    여기서는 prefix 로 어느 경로를 탈지 dispatch 만 한다 (새 crypto/auth 로직 없음).
 * IDOR 차단: 두 경로 다 userId 를 돌려주고, 코어가 WHERE user_id = userId 강제.
 */

import type {NextResponse} from 'next/server';
import {authenticateApiKey, RATE_LIMIT_CAP} from '@/lib/api-auth';
import {authenticateSession} from '@/lib/api-session-auth';

const KEY_PREFIX = 'plan1_api_';

export type DualAuthResult =
  | {
      ok: true;
      userId: string;
      via: 'session' | 'apiKey';
      /** API 키 경로일 때만 — 감사 추적용(누가 어느 키로 mutation 했나). */
      apiKeyId?: string;
      /** API 키 경로일 때만 — 성공 응답 X-RateLimit-* 헤더용. */
      rateLimit?: {limit: number; remaining: number; resetUnix: number};
    }
  | {ok: false; response: NextResponse};

export async function authenticateSessionOrApiKey(request: Request): Promise<DualAuthResult> {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (token.startsWith(KEY_PREFIX)) {
    const r = await authenticateApiKey(request);
    return r.ok
      ? {
          ok: true,
          userId: r.user.id,
          via: 'apiKey',
          apiKeyId: r.apiKey.id,
          rateLimit: {limit: RATE_LIMIT_CAP, remaining: r.remaining, resetUnix: r.resetUnix}
        }
      : r;
  }
  const r = await authenticateSession(request);
  return r.ok ? {ok: true, userId: r.user.id, via: 'session'} : r;
}
