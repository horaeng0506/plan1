import {createHash, timingSafeEqual} from 'node:crypto';
import {sql, eq} from 'drizzle-orm';
import {NextResponse} from 'next/server';
import {db} from '@/lib/db';
import {plan1ApiKeys} from '@/lib/db/schema';

/**
 * PLAN1-TASKS-FEATURE-20260509 — bearer auth + token bucket rate limit (Critical S4 정합).
 *
 * 흐름:
 *   1. Authorization: Bearer plan1_api_xxx 추출 (prefix 검증)
 *   2. SHA-256 hash → DB lookup (keyHash unique index)
 *   3. revokedAt / expiresAt 검사
 *   4. token bucket atomic UPDATE 단일 query (race condition 차단)
 *   5. lastUsedAt async fire-and-forget UPDATE
 *   6. {user, apiKey, remaining} 반환 — handler 가 IDOR 차단 위해 apiKey.userId WHERE 강제
 *
 * timing attack 차단: timingSafeEqual (hash 비교)
 * IDOR 차단: handler 가 모든 query WHERE eq(plan1Tasks.userId, apiKey.userId) 강제
 * rate limit: token bucket cap 60 · refill 1/sec (60/60 sec) · 단일 UPDATE atomic
 */

const KEY_PREFIX = 'plan1_api_';
export const RATE_LIMIT_CAP = 60;
const RATE_LIMIT_REFILL_PER_MIN = 60;

export interface AuthSuccess {
  ok: true;
  user: {id: string};
  apiKey: {id: string; userId: string};
  remaining: number;
  resetUnix: number;
}

export type AuthResult = AuthSuccess | {ok: false; response: NextResponse};

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type'
  };
}

function unauthorized(reason: string): NextResponse {
  return NextResponse.json(
    {data: null, error: {code: 'unauthorized', message: reason}},
    {status: 401, headers: corsHeaders()}
  );
}

function rateLimited(remaining: number, resetUnix: number): NextResponse {
  return NextResponse.json(
    {data: null, error: {code: 'rate_limited', message: 'API rate limit exceeded'}},
    {
      status: 429,
      headers: {
        ...corsHeaders(),
        'X-RateLimit-Limit': String(RATE_LIMIT_CAP),
        'X-RateLimit-Remaining': String(Math.max(0, remaining)),
        'X-RateLimit-Reset': String(resetUnix)
      }
    }
  );
}

export async function authenticateApiKey(request: Request): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {ok: false, response: unauthorized('Missing Bearer token')};
  }
  const rawKey = authHeader.slice(7).trim();
  if (!rawKey.startsWith(KEY_PREFIX)) {
    return {ok: false, response: unauthorized('Invalid key prefix')};
  }
  const incomingHash = hashApiKey(rawKey);
  const rows = await db
    .select()
    .from(plan1ApiKeys)
    .where(eq(plan1ApiKeys.keyHash, incomingHash))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {ok: false, response: unauthorized('Key not found')};
  }
  const incomingBuf = Buffer.from(incomingHash, 'hex');
  const storedBuf = Buffer.from(row.keyHash, 'hex');
  if (incomingBuf.length !== storedBuf.length || !timingSafeEqual(incomingBuf, storedBuf)) {
    return {ok: false, response: unauthorized('Hash mismatch')};
  }
  // 폐기 = 즉시 무효. rotate 도 옛 키를 즉시 폐기(grace 없음)라 non-null 이면 항상 거부.
  if (row.revokedAt !== null) {
    return {ok: false, response: unauthorized('Key revoked')};
  }
  if (row.expiresAt !== null && row.expiresAt.getTime() < Date.now()) {
    return {ok: false, response: unauthorized('Key expired')};
  }
  const updateRows = await db.execute(sql`
    UPDATE plan1.api_keys
    SET rate_limit_tokens = LEAST(
      ${RATE_LIMIT_CAP},
      rate_limit_tokens + (EXTRACT(EPOCH FROM (NOW() - rate_limit_last_refill_at)) * ${RATE_LIMIT_REFILL_PER_MIN}::float / 60.0)::int
    ) - 1,
    rate_limit_last_refill_at = NOW()
    WHERE id = ${row.id}
      AND rate_limit_tokens + (EXTRACT(EPOCH FROM (NOW() - rate_limit_last_refill_at)) * ${RATE_LIMIT_REFILL_PER_MIN}::float / 60.0)::int >= 1
    RETURNING rate_limit_tokens
  `);
  const updateResultRows = (updateRows.rows ?? []) as Array<{rate_limit_tokens: number}>;
  if (updateResultRows.length === 0) {
    const resetUnix = Math.floor(Date.now() / 1000) + 60;
    return {ok: false, response: rateLimited(0, resetUnix)};
  }
  const remaining = updateResultRows[0].rate_limit_tokens;
  const resetUnix = Math.floor(Date.now() / 1000) + 60;
  void db
    .update(plan1ApiKeys)
    .set({lastUsedAt: new Date()})
    .where(eq(plan1ApiKeys.id, row.id))
    .catch(() => undefined);
  return {
    ok: true,
    user: {id: row.userId},
    apiKey: {id: row.id, userId: row.userId},
    remaining,
    resetUnix
  };
}

export function buildSuccessHeaders(remaining: number, resetUnix: number): Record<string, string> {
  return {
    ...corsHeaders(),
    'X-RateLimit-Limit': String(RATE_LIMIT_CAP),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(resetUnix),
    'Content-Type': 'application/json'
  };
}

export function buildOptionsResponse(): NextResponse {
  // CORS preflight 표준 204 (openapi spec · session OPTIONS 와 일치 · QA-GATE-20260614).
  return new NextResponse(null, {status: 204, headers: corsHeaders()});
}