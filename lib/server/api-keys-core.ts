/**
 * plan1 — API 키 관리 공용 코어 (userId 파라미터 · ApiError throw).
 *
 * 웹 server action(app/actions/api-keys.ts · 세션 쿠키)과 모바일 REST(app/api/v1/api-keys · 세션 JWT)
 * 둘 다 이 코어를 호출한다 (category-core·schedule-core 와 동일 패턴 · 대장 2026-07-02).
 * 키 생성 형식·해시는 여기 단일 원천 — 두 경로가 드리프트하지 않게.
 *
 * 보안:
 *   - plain key = 발급 시점 1회만 반환 (DB 는 SHA-256 hash 만 저장)
 *   - hash = hashApiKey (lib/api-auth · authenticateApiKey 와 동일 함수)
 *   - keyPrefix = 마지막 8 char (UI 목록 표시용)
 *   - IDOR 차단 = 모든 query WHERE eq(plan1ApiKeys.userId, userId) 강제
 *   - 관리(발급/폐기)는 세션 인증 경로에서만 호출 — api-key 로 새 키 발급 불가(권한 상승 차단)
 */

import {randomBytes, randomUUID} from 'node:crypto';
import {and, desc, eq, isNull} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1ApiKeys} from '@/lib/db/schema';
import {hashApiKey} from '@/lib/api-auth';
import {ApiError, isUniqueViolation} from '@/lib/server/api-error';

const KEY_PREFIX = 'plan1_api_';
/** 사용자당 활성(미폐기) API 키 상한 — 무한 발급(키 farming)으로 공유 DB 비대·prefix 충돌 차단. */
const MAX_ACTIVE_KEYS = 50;

export interface ApiKeyMeta {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface ApiKeyCreated {
  meta: ApiKeyMeta;
  rawKey: string;
}

function rowToApiKeyMeta(row: typeof plan1ApiKeys.$inferSelect): ApiKeyMeta {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.getTime() : null,
    revokedAt: row.revokedAt ? row.revokedAt.getTime() : null
  };
}

function generateRawKey(): string {
  const random = randomBytes(30).toString('base64url').slice(0, 40);
  return `${KEY_PREFIX}${random}`;
}

export async function listApiKeysCore(userId: string): Promise<ApiKeyMeta[]> {
  const rows = await db
    .select()
    .from(plan1ApiKeys)
    .where(eq(plan1ApiKeys.userId, userId))
    .orderBy(desc(plan1ApiKeys.createdAt));
  return rows.map(rowToApiKeyMeta);
}

export async function createApiKeyCore(
  userId: string,
  input: {name: string; expiresInDays: number | null}
): Promise<ApiKeyCreated> {
  const trimmed = input.name.trim();
  if (trimmed === '' || trimmed.length > 100) {
    throw new ApiError('api_key_name_invalid', 400, 'API key name must be 1-100 chars');
  }
  if (input.expiresInDays !== null && (input.expiresInDays < 1 || input.expiresInDays > 3650)) {
    throw new ApiError('api_key_expires_invalid', 400, 'expiresInDays must be 1-3650');
  }
  // 활성 키 개수 상한 — 무한 발급(farming) abuse + prefix(8char) 충돌 차단. 기존 목록 재사용.
  const activeCount = (await listApiKeysCore(userId)).filter(k => k.revokedAt === null).length;
  if (activeCount >= MAX_ACTIVE_KEYS) {
    throw new ApiError(
      'api_key_limit_reached',
      400,
      `Too many active API keys (max ${MAX_ACTIVE_KEYS}). Revoke unused keys first.`
    );
  }
  const expiresAt =
    input.expiresInDays === null
      ? null
      : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  // INSERT ... RETURNING — 단일 statement(neon-http read-after-write 레이스 회피).
  // keyPrefix(마지막 8자)는 (userId, keyPrefix) UNIQUE — 극히 드문 충돌 시 새 키로 1회 재시도.
  for (let attempt = 0; attempt < 2; attempt++) {
    const rawKey = generateRawKey();
    const keyPrefix = rawKey.slice(-8);
    const id = `apik-${randomUUID()}`;
    try {
      const inserted = await db
        .insert(plan1ApiKeys)
        .values({id, userId, name: trimmed, keyHash: hashApiKey(rawKey), keyPrefix, expiresAt})
        .returning();
      const created = inserted[0];
      if (!created) throw new ApiError('api_key_create_failed', 500, 'API key create failed');
      // 감사 로그 — 자격증명 발급 추적. ⚡ rawKey·keyHash 절대 로깅 금지.
      console.info(`[api-keys] create user=${userId} keyId=${id} prefix=${keyPrefix}`);
      return {meta: rowToApiKeyMeta(created), rawKey};
    } catch (e) {
      if (attempt === 0 && isUniqueViolation(e)) continue; // keyPrefix 충돌 → 재생성
      throw e;
    }
  }
  throw new ApiError('api_key_create_failed', 500, 'API key create failed');
}

export async function revokeApiKeyCore(userId: string, id: string): Promise<ApiKeyMeta[]> {
  // 멱등 — 없거나 이미 폐기여도 에러 없이 현재 목록 반환. IDOR: WHERE userId 강제.
  // revokedAt IS NULL 조건 — 재폐기 시 최초 폐기 시각 보존(감사). 결과는 멱등(현재 목록).
  await db
    .update(plan1ApiKeys)
    .set({revokedAt: new Date()})
    .where(
      and(eq(plan1ApiKeys.id, id), eq(plan1ApiKeys.userId, userId), isNull(plan1ApiKeys.revokedAt))
    );
  console.info(`[api-keys] revoke user=${userId} keyId=${id}`);
  return listApiKeysCore(userId);
}
