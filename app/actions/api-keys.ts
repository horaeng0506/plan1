'use server';

import {randomBytes, randomUUID} from 'node:crypto';
import {and, desc, eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1ApiKeys} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {hashApiKey} from '@/lib/api-auth';
import {ServerActionError, runAction, type ServerActionResult} from '@/lib/server-action';

/**
 * PLAN1-TASKS-FEATURE-20260509 — API key 발급 · list · revoke · rotate (Stage S6).
 *
 * 보안 정책:
 *   - plain key = 발급 시점 1회만 client 반환 (DB 영영 hash 만)
 *   - hash = SHA-256 (lib/api-auth hashApiKey 재활용)
 *   - prefix = 마지막 8 char (UI list 표시 영영 · Q22 정합)
 *   - rotate = 옛 key revokedAt = NOW() + 24h grace · 새 key 발급
 *   - revoke = 즉시 revokedAt = NOW()
 *   - IDOR 차단 = 모든 query WHERE eq(plan1ApiKeys.userId, user.id) 강제
 *
 * 형식: `plan1_api_<40-char-base62>` — randomBytes(30).toString('base64url').slice(0, 40)
 */

const KEY_PREFIX = 'plan1_api_';
const ROTATE_GRACE_MS = 24 * 60 * 60 * 1000;

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

export async function listApiKeys(): Promise<ServerActionResult<ApiKeyMeta[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(plan1ApiKeys)
      .where(eq(plan1ApiKeys.userId, user.id))
      .orderBy(desc(plan1ApiKeys.createdAt));
    return rows.map(rowToApiKeyMeta);
  });
}

export async function createApiKey(input: {
  name: string;
  expiresInDays: number | null;
}): Promise<ServerActionResult<ApiKeyCreated>> {
  return runAction(async () => {
    const user = await requireUser();
    const trimmed = input.name.trim();
    if (trimmed === '' || trimmed.length > 100) {
      throw new ServerActionError('serverError.apiKeyNameInvalid');
    }
    if (input.expiresInDays !== null && (input.expiresInDays < 1 || input.expiresInDays > 3650)) {
      throw new ServerActionError('serverError.apiKeyExpiresInvalid');
    }
    const rawKey = generateRawKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(-8);
    const id = `apik-${randomUUID()}`;
    const expiresAt =
      input.expiresInDays === null
        ? null
        : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    await db.insert(plan1ApiKeys).values({
      id,
      userId: user.id,
      name: trimmed,
      keyHash,
      keyPrefix,
      expiresAt
    });
    const rows = await db
      .select()
      .from(plan1ApiKeys)
      .where(eq(plan1ApiKeys.id, id))
      .limit(1);
    const created = rows[0];
    if (!created) throw new ServerActionError('serverError.apiKeyCreateFailed');
    return {meta: rowToApiKeyMeta(created), rawKey};
  });
}

export async function revokeApiKey(id: string): Promise<ServerActionResult<ApiKeyMeta[]>> {
  return runAction(async () => {
    const user = await requireUser();
    await db
      .update(plan1ApiKeys)
      .set({revokedAt: new Date()})
      .where(and(eq(plan1ApiKeys.id, id), eq(plan1ApiKeys.userId, user.id)));
    const rows = await db
      .select()
      .from(plan1ApiKeys)
      .where(eq(plan1ApiKeys.userId, user.id))
      .orderBy(desc(plan1ApiKeys.createdAt));
    return rows.map(rowToApiKeyMeta);
  });
}

export async function rotateApiKey(input: {
  oldId: string;
  name: string;
  expiresInDays: number | null;
}): Promise<ServerActionResult<ApiKeyCreated>> {
  return runAction(async () => {
    const user = await requireUser();
    const oldRows = await db
      .select()
      .from(plan1ApiKeys)
      .where(and(eq(plan1ApiKeys.id, input.oldId), eq(plan1ApiKeys.userId, user.id)))
      .limit(1);
    const oldRow = oldRows[0];
    if (!oldRow) throw new ServerActionError('serverError.apiKeyNotFound');
    if (oldRow.revokedAt !== null && oldRow.revokedAt.getTime() <= Date.now()) {
      throw new ServerActionError('serverError.apiKeyAlreadyRevoked');
    }
    await db
      .update(plan1ApiKeys)
      .set({revokedAt: new Date(Date.now() + ROTATE_GRACE_MS)})
      .where(and(eq(plan1ApiKeys.id, input.oldId), eq(plan1ApiKeys.userId, user.id)));
    const created = await createApiKey({name: input.name, expiresInDays: input.expiresInDays});
    if (!created.ok) throw new ServerActionError(created.errorKey, created.params);
    return created.data;
  });
}