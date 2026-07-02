'use server';

/**
 * API 키 관리 server actions (웹 · 세션 쿠키).
 *
 * A4 패턴 (2026-07-02): 로직을 `lib/server/api-keys-core` 단일 코어로 통합.
 *   - 모바일 REST(app/api/v1/api-keys · 세션 JWT)도 같은 코어 사용 — 키 생성 형식·해시 단일 원천.
 *   - 코어 ApiError(snake_case code) → ServerActionError(i18n key) 변환은 callCore 어댑터.
 *   - ⚡ 동작 불변: 기존 i18n 키(apiKeyNameInvalid·apiKeyExpiresInvalid·apiKeyNotFound 등) 그대로.
 *
 * rotate 는 웹 전용(모바일은 revoke+create 로 대체). 새 key 발급 후 옛 key 즉시 폐기.
 */

import {and, eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1ApiKeys} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {runAction, type ServerActionResult} from '@/lib/server-action';
import {callCore} from '@/lib/server/action-error-adapter';
import {ApiError} from '@/lib/server/api-error';
import {
  listApiKeysCore,
  createApiKeyCore,
  revokeApiKeyCore,
  type ApiKeyMeta,
  type ApiKeyCreated
} from '@/lib/server/api-keys-core';

export type {ApiKeyMeta, ApiKeyCreated} from '@/lib/server/api-keys-core';

export async function listApiKeys(): Promise<ServerActionResult<ApiKeyMeta[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => listApiKeysCore(user.id));
  });
}

export async function createApiKey(input: {
  name: string;
  expiresInDays: number | null;
}): Promise<ServerActionResult<ApiKeyCreated>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => createApiKeyCore(user.id, input));
  });
}

export async function revokeApiKey(id: string): Promise<ServerActionResult<ApiKeyMeta[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => revokeApiKeyCore(user.id, id));
  });
}

export async function rotateApiKey(input: {
  oldId: string;
  name: string;
  expiresInDays: number | null;
}): Promise<ServerActionResult<ApiKeyCreated>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(async () => {
      const oldRows = await db
        .select()
        .from(plan1ApiKeys)
        .where(and(eq(plan1ApiKeys.id, input.oldId), eq(plan1ApiKeys.userId, user.id)))
        .limit(1);
      const oldRow = oldRows[0];
      if (!oldRow) throw new ApiError('api_key_not_found', 404, 'API key not found');
      if (oldRow.revokedAt !== null) {
        throw new ApiError('api_key_already_revoked', 409, 'API key already revoked');
      }
      // ⚡ 새 키 먼저 생성 → 성공 후 옛 키 즉시 폐기. neon-http 는 트랜잭션이 없어
      //   순서를 반전해야 생성 실패 시 옛 키가 살아있다("옛 키만 죽고 새 키 없음" 방지).
      //   grace(유예) 없음 — 폐기 = 즉시 무효(revokeApiKeyCore 가 revokedAt=now 로 set).
      const created = await createApiKeyCore(user.id, {
        name: input.name,
        expiresInDays: input.expiresInDays
      });
      await revokeApiKeyCore(user.id, input.oldId);
      return created;
    });
  });
}
