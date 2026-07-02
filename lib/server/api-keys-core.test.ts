import {describe, it, expect, vi} from 'vitest';

// drizzle 연산자·스키마·db 를 no-op 으로 목킹 (검증 로직 + 키 생성 형식만 테스트).
vi.mock('drizzle-orm', () => ({eq: vi.fn(), and: vi.fn(), desc: vi.fn()}));
vi.mock('@/lib/db/schema', () => ({plan1ApiKeys: {}}));
vi.mock('@/lib/api-auth', () => ({hashApiKey: (k: string) => `hash:${k}`}));

vi.mock('@/lib/db', () => ({
  db: {
    // INSERT ... RETURNING — 넣은 값 그대로 반영한 row 1개 반환.
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [
          {
            id: v.id,
            userId: v.userId,
            name: v.name,
            keyHash: v.keyHash,
            keyPrefix: v.keyPrefix,
            createdAt: new Date(0),
            expiresAt: (v.expiresAt as Date | null) ?? null,
            lastUsedAt: null,
            revokedAt: null
          }
        ]
      })
    }),
    // listApiKeysCore(cap 체크 + 목록) — 빈 목록(활성 0).
    select: () => ({from: () => ({where: () => ({limit: async () => [], orderBy: async () => []})})})
  }
}));

import {createApiKeyCore} from '@/lib/server/api-keys-core';

describe('createApiKeyCore', () => {
  it('빈 이름 → api_key_name_invalid(400)', async () => {
    await expect(createApiKeyCore('u1', {name: '   ', expiresInDays: null})).rejects.toMatchObject({
      code: 'api_key_name_invalid',
      status: 400
    });
  });

  it('이름 100자 초과 → api_key_name_invalid', async () => {
    await expect(
      createApiKeyCore('u1', {name: 'x'.repeat(101), expiresInDays: null})
    ).rejects.toMatchObject({code: 'api_key_name_invalid'});
  });

  it('expiresInDays 0 → api_key_expires_invalid', async () => {
    await expect(createApiKeyCore('u1', {name: 'ok', expiresInDays: 0})).rejects.toMatchObject({
      code: 'api_key_expires_invalid'
    });
  });

  it('expiresInDays 3651 → api_key_expires_invalid', async () => {
    await expect(createApiKeyCore('u1', {name: 'ok', expiresInDays: 3651})).rejects.toMatchObject({
      code: 'api_key_expires_invalid'
    });
  });

  it('정상 → rawKey plan1_api_ prefix + keyPrefix=마지막 8자 + name 보존', async () => {
    const r = await createApiKeyCore('u1', {name: '내 키', expiresInDays: 30});
    expect(r.rawKey.startsWith('plan1_api_')).toBe(true);
    expect(r.meta.keyPrefix).toBe(r.rawKey.slice(-8));
    expect(r.meta.name).toBe('내 키');
  });
});
