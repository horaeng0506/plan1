import {describe, it, expect, vi, beforeEach} from 'vitest';

vi.mock('@/lib/api-auth', () => ({authenticateApiKey: vi.fn(), RATE_LIMIT_CAP: 60}));
vi.mock('@/lib/api-session-auth', () => ({authenticateSession: vi.fn()}));

import {authenticateApiKey} from '@/lib/api-auth';
import {authenticateSession} from '@/lib/api-session-auth';
import {authenticateSessionOrApiKey} from '@/lib/api-dual-auth';

const mockApiKey = vi.mocked(authenticateApiKey);
const mockSession = vi.mocked(authenticateSession);

function req(authHeader?: string): Request {
  return new Request('https://x.test/api/v1/schedules', {
    headers: authHeader ? {authorization: authHeader} : {}
  });
}

describe('authenticateSessionOrApiKey — dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('plan1_api_ prefix → API 키 경로, userId 매핑', async () => {
    mockApiKey.mockResolvedValue({
      ok: true,
      user: {id: 'u1'},
      apiKey: {id: 'k1', userId: 'u1'},
      remaining: 59,
      resetUnix: 0
    });
    const r = await authenticateSessionOrApiKey(req('Bearer plan1_api_abc123'));
    expect(mockApiKey).toHaveBeenCalledOnce();
    expect(mockSession).not.toHaveBeenCalled();
    expect(r).toEqual({
      ok: true,
      userId: 'u1',
      via: 'apiKey',
      apiKeyId: 'k1',
      rateLimit: {limit: 60, remaining: 59, resetUnix: 0}
    });
  });

  it('일반 JWT(비-prefix) → 세션 경로, userId 매핑', async () => {
    mockSession.mockResolvedValue({ok: true, user: {id: 'u2'} as never});
    const r = await authenticateSessionOrApiKey(req('Bearer eyJhbGciOi.jwt.token'));
    expect(mockSession).toHaveBeenCalledOnce();
    expect(mockApiKey).not.toHaveBeenCalled();
    expect(r).toEqual({ok: true, userId: 'u2', via: 'session'});
  });

  it('Authorization 헤더 없음 → 세션 경로(실패 응답 그대로 전파)', async () => {
    const fail = {ok: false as const, response: new Response('unauth') as never};
    mockSession.mockResolvedValue(fail);
    const r = await authenticateSessionOrApiKey(req());
    expect(mockSession).toHaveBeenCalledOnce();
    expect(mockApiKey).not.toHaveBeenCalled();
    expect(r).toBe(fail);
  });

  it('API 키 인증 실패(revoked·rate limit 등) → 실패 응답 그대로 전파', async () => {
    const fail = {ok: false as const, response: new Response('revoked') as never};
    mockApiKey.mockResolvedValue(fail);
    const r = await authenticateSessionOrApiKey(req('Bearer plan1_api_revoked'));
    expect(mockApiKey).toHaveBeenCalledOnce();
    expect(r).toBe(fail);
  });

  it('Bearer 아닌 Authorization → 세션 경로(plan1_api_ prefix 아님)', async () => {
    mockSession.mockResolvedValue({ok: false as const, response: new Response('x') as never});
    await authenticateSessionOrApiKey(req('Basic plan1_api_notbearer'));
    expect(mockSession).toHaveBeenCalledOnce();
    expect(mockApiKey).not.toHaveBeenCalled();
  });
});
