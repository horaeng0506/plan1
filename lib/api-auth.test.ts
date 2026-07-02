import {describe, it, expect, vi, beforeEach} from 'vitest';

// authenticateApiKey 의 revokedAt 폐기 판정 검증(rate limit·hash 경로는 통과 상태로 고정).
// 회귀 가드: grace(유예) 없음 — revokedAt 이 non-null 이면(과거·현재·미래 무관) 항상 즉시 거부.
// rotate 도 옛 키를 즉시 폐기(revokedAt=now)라 미래 revokedAt 은 생성되지 않지만, 방어적으로 거부 확인.

let mockRow: Record<string, unknown> | null = null;

vi.mock('drizzle-orm', () => ({sql: (..._a: unknown[]) => ({}), eq: vi.fn()}));
vi.mock('@/lib/db/schema', () => ({plan1ApiKeys: {keyHash: 'keyHash', id: 'id'}}));
vi.mock('next/server', () => ({
  NextResponse: {json: (body: unknown, init?: {status?: number}) => ({__body: body, __status: init?.status ?? 200})}
}));
vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({from: () => ({where: () => ({limit: async () => (mockRow ? [mockRow] : [])})})}),
    // 레이트리밋 UPDATE — 토큰 충분(통과).
    execute: async () => ({rows: [{rate_limit_tokens: 59}]}),
    // lastUsedAt UPDATE — void ...catch() 체인.
    update: () => ({set: () => ({where: () => Promise.resolve()})})
  }
}));

import {authenticateApiKey, hashApiKey} from '@/lib/api-auth';

const RAW = 'plan1_api_testrawkey1234567890abcd';

function req(): Request {
  return new Request('https://x/api/v1/schedules', {headers: {authorization: `Bearer ${RAW}`}});
}
function rowWith(revokedAt: Date | null) {
  return {
    id: 'apik-1',
    userId: 'u1',
    keyHash: hashApiKey(RAW),
    keyPrefix: RAW.slice(-8),
    revokedAt,
    expiresAt: null
  };
}

describe('authenticateApiKey — revokedAt 폐기 판정(grace 없음)', () => {
  beforeEach(() => {
    mockRow = null;
  });

  it('revokedAt = null → 통과(ok)', async () => {
    mockRow = rowWith(null);
    const r = await authenticateApiKey(req());
    expect(r.ok).toBe(true);
  });

  it('revokedAt = 과거(폐기) → 거부', async () => {
    mockRow = rowWith(new Date(Date.now() - 1000));
    const r = await authenticateApiKey(req());
    expect(r.ok).toBe(false);
  });

  it('revokedAt = 현재 근사(폐기 직후 사용) → 거부', async () => {
    mockRow = rowWith(new Date(Date.now()));
    const r = await authenticateApiKey(req());
    expect(r.ok).toBe(false);
  });

  it('revokedAt = 미래 → 거부(grace 없음 — non-null 이면 항상 무효)', async () => {
    mockRow = rowWith(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const r = await authenticateApiKey(req());
    expect(r.ok).toBe(false);
  });
});
