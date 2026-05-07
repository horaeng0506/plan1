import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

/**
 * 단위 spec — plan1 lib/verify-session.ts (Stage C2 · 2026-05-07)
 *
 * 영역:
 *   - verifySessionJwt: jose jwtVerify mock + payload claim 분기
 *   - JWKS singleton cache: 같은 issuer 재 호출 시 createRemoteJWKSet 1회 호출만
 *   - PORTAL_JWKS_PATH env 분기 (default '/project/api/auth/jwks' vs override)
 *   - logServerWarn 호출 검증 (verify 실패 시 silent X · 진단 logging 의무)
 *
 * 회귀 catch 의무:
 *   - jwtVerify 실패 (expired · signature · iss · aud) → null + logServerWarn 호출
 *   - sub 빈 string → null
 *   - JWKS singleton cache 무력화 회귀 (매 호출 신규 createRemoteJWKSet → portal /jwks DDoS 가능)
 *   - PORTAL_JWKS_PATH env 변경 시 정확한 path 사용 (portal basePath 변경 대비)
 *
 * 근거:
 *   - portal/lib/verify-session.test.ts 패턴 reference (Stage C1)
 *   - dev-process.md § Tier 1 단위 spec 의무 (Pre-Launch Code Quality)
 *   - test-case-design-principles.md § 2 EP/BVA 환원
 *
 * mock 패턴:
 *   - vi.mock('jose') 으로 module-level mock
 *   - vi.mock('./log') 으로 logServerWarn spy
 *   - 매 test 마다 모듈 캐시 reset (singleton cache 영역 catch)
 */

// jose + log mock — Vitest hoisting 처리
vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => 'MOCK_JWKS_KEY')
}));

vi.mock('./log', () => ({
  logServerWarn: vi.fn(),
  logServerError: vi.fn(),
  logClientError: vi.fn()
}));

import {jwtVerify, createRemoteJWKSet} from 'jose';
import {logServerWarn} from './log';

const mockedJwtVerify = vi.mocked(jwtVerify);
const mockedCreateRemoteJWKSet = vi.mocked(createRemoteJWKSet);
const mockedLogServerWarn = vi.mocked(logServerWarn);

const ISSUER_PROD = 'https://cofounder.co.kr';
const ISSUER_DEV = 'http://localhost:3456';

beforeEach(() => {
  // module 캐시 reset — JWKS singleton cache (Map) 도 같이 reset (env-critic Critical #1 정합)
  vi.resetModules();
  vi.clearAllMocks();
  // mockedCreateRemoteJWKSet default return (resetModules 후 fn 자체는 보존되지만 implementation 초기화)
  mockedCreateRemoteJWKSet.mockReturnValue('MOCK_JWKS_KEY' as never);
});

afterEach(() => {
  delete process.env.PORTAL_JWKS_PATH;
});

describe('verifySessionJwt — JWT verify 분기', () => {
  it('valid JWT + 모든 claim 정상 → SessionUser', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {
        sub: 'user-123',
        email: 'qa-bot@cofounder.co.kr',
        name: 'QA Bot',
        image: 'https://cdn.example/avatar.png'
      },
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    const result = await verifySessionJwt('valid.token', ISSUER_PROD);

    expect(result).toEqual({
      id: 'user-123',
      email: 'qa-bot@cofounder.co.kr',
      name: 'QA Bot',
      image: 'https://cdn.example/avatar.png'
    });
    expect(mockedJwtVerify).toHaveBeenCalledWith('valid.token', 'MOCK_JWKS_KEY', {
      issuer: ISSUER_PROD,
      audience: ISSUER_PROD
    });
  });

  it('jwtVerify throw (expired) → null + logServerWarn 호출', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    const expiredErr = new Error('JWT expired');
    mockedJwtVerify.mockRejectedValue(expiredErr);

    const result = await verifySessionJwt('expired.token', ISSUER_PROD);

    expect(result).toBeNull();
    expect(mockedLogServerWarn).toHaveBeenCalledWith(
      '[verify-session] JWT verify failed:',
      'JWT expired'
    );
  });

  it('jwtVerify throw (signature mismatch) → null + warn 호출', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockRejectedValue(new Error('signature verification failed'));

    const result = await verifySessionJwt('bad-sig.token', ISSUER_PROD);

    expect(result).toBeNull();
    expect(mockedLogServerWarn).toHaveBeenCalled();
  });

  it('jwtVerify throw non-Error (string) → null + warn 호출 (raw 값 logging)', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockRejectedValue('string error reason');

    const result = await verifySessionJwt('weird.token', ISSUER_PROD);

    expect(result).toBeNull();
    expect(mockedLogServerWarn).toHaveBeenCalledWith(
      '[verify-session] JWT verify failed:',
      'string error reason'
    );
  });
});

describe('verifySessionJwt — payload claim 분기', () => {
  it('sub 빈 string → null (id 검증 fail)', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {sub: '', email: 'foo@bar'},
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    expect(await verifySessionJwt('empty-sub.token', ISSUER_PROD)).toBeNull();
  });

  it('sub undefined → null', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {email: 'foo@bar'},
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    expect(await verifySessionJwt('no-sub.token', ISSUER_PROD)).toBeNull();
  });

  it('email/name/image non-string → undefined 박힘', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {
        sub: 'user-1',
        email: 12345 as unknown as string,
        name: null as unknown as string,
        image: {} as unknown as string
      },
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    const result = await verifySessionJwt('mixed-claim.token', ISSUER_PROD);
    expect(result).toEqual({id: 'user-1', email: undefined, name: undefined, image: undefined});
  });

  it('sub number → String() 변환', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {sub: 999 as unknown as string},
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    const result = await verifySessionJwt('numeric-sub.token', ISSUER_PROD);
    expect(result).toEqual({id: '999', email: undefined, name: undefined, image: undefined});
  });
});

describe('JWKS singleton cache — env-critic Critical #1 회귀 catch', () => {
  it('같은 issuer 재 호출 → createRemoteJWKSet 1회만 호출 (cache hit)', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {sub: 'u1'},
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    await verifySessionJwt('t1', ISSUER_PROD);
    await verifySessionJwt('t2', ISSUER_PROD);
    await verifySessionJwt('t3', ISSUER_PROD);

    expect(mockedCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
  });

  it('다른 issuer → createRemoteJWKSet 신규 호출 (issuer 별 인스턴스)', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {sub: 'u1'},
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    await verifySessionJwt('t1', ISSUER_PROD);
    await verifySessionJwt('t2', ISSUER_DEV);

    expect(mockedCreateRemoteJWKSet).toHaveBeenCalledTimes(2);
  });

  it('createRemoteJWKSet 호출 시 cooldown · cacheMaxAge 옵션 전달 (DDoS 방어)', async () => {
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {sub: 'u1'},
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    await verifySessionJwt('t1', ISSUER_PROD);

    expect(mockedCreateRemoteJWKSet).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000
      })
    );
  });
});

describe('PORTAL_JWKS_PATH env 분기 (ship-gate code-review High)', () => {
  it('PORTAL_JWKS_PATH 미설정 → default `/project/api/auth/jwks` path 사용', async () => {
    delete process.env.PORTAL_JWKS_PATH;
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {sub: 'u1'},
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    await verifySessionJwt('t1', ISSUER_PROD);

    const callUrl = mockedCreateRemoteJWKSet.mock.calls[0]?.[0] as URL;
    expect(callUrl.toString()).toBe(`${ISSUER_PROD}/project/api/auth/jwks`);
  });

  it('PORTAL_JWKS_PATH override → 그 path 사용', async () => {
    process.env.PORTAL_JWKS_PATH = '/custom/jwks';
    const {verifySessionJwt} = await import('./verify-session');
    mockedJwtVerify.mockResolvedValue({
      payload: {sub: 'u1'},
      protectedHeader: {alg: 'EdDSA'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);

    await verifySessionJwt('t1', ISSUER_PROD);

    const callUrl = mockedCreateRemoteJWKSet.mock.calls[0]?.[0] as URL;
    expect(callUrl.toString()).toBe(`${ISSUER_PROD}/custom/jwks`);
  });
});
