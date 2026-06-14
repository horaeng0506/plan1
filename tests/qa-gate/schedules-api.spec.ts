import {test, expect} from '@playwright/test';

/**
 * plan1-mobile A1 — /api/v1/schedules 세션 JWT REST API mutation E2E spec.
 *
 * 인증: portal Better Auth 세션 JWT (cofounder_jwt) — task API 의 api-key 와 별개 경로.
 *
 * 본 spec 의 runnable 영역 (preview/qa 환경에서 검증):
 *   - 세션 JWT 없음/invalid → 401
 *   - CORS preflight (OPTIONS) → 204 + Allow-Origin/Methods/Headers
 *   - OpenAPI spec 에 schedules paths + sessionAuth scheme 노출
 *
 * 본 spec 의 prod-like skip 영역 (S+5 수동 검수 / Phase B 모바일 클라 연동 시):
 *   - 인증된 CRUD 체인 (create→list→update(cascade)→complete→delete)
 *   - N-schedule cascade mutation (PICT model `tests/qa-gate/models/schedules-api.txt`)
 *   - 409 동시성 충돌 (두 stale writer)
 *  → 이유: 실제 cofounder_jwt 세션 + 멀티 세션 동시 write 가 필요. cascade·overlap·낙관적
 *    동시성(D1) 코어 자체는 단위(lib/server/concurrency-guard.test.ts·lib/domain/overlap.test.ts)
 *    + dev Neon 실측(guard ok/stale 경로)으로 검증 완료. api-key-auth.spec.ts 와 동일 패턴.
 */

test.describe('schedules API — 세션 JWT 인증 chain', () => {
  test('GET — 세션 JWT 없으면 401', async ({request}) => {
    const resp = await request.get('/api/v1/schedules');
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error?.code).toBe('unauthorized');
  });

  test('GET — invalid Bearer 토큰이면 401', async ({request}) => {
    const resp = await request.get('/api/v1/schedules', {
      headers: {Authorization: 'Bearer not-a-real-jwt.payload.sig'}
    });
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body.error?.code).toBe('unauthorized');
  });

  test('POST — 세션 JWT 없으면 401 (body 파싱 전 인증 차단)', async ({request}) => {
    const resp = await request.post('/api/v1/schedules', {
      data: {title: 'x', categoryId: 'c', startAt: 0, durationMin: 30, timerType: 'countup'}
    });
    expect(resp.status()).toBe(401);
  });

  test('CORS preflight — OPTIONS → 204 + Allow-Origin/Methods/Headers', async ({request}) => {
    const resp = await request.fetch('/api/v1/schedules', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type'
      }
    });
    expect(resp.status()).toBe(204);
    expect(resp.headers()['access-control-allow-origin']).toBe('*');
    expect(resp.headers()['access-control-allow-methods']).toMatch(/GET.*POST.*PATCH.*DELETE/);
    expect(resp.headers()['access-control-allow-headers']).toMatch(/Authorization/i);
  });

  test('OpenAPI spec — schedules paths + sessionAuth scheme 노출', async ({request}) => {
    const resp = await request.get('/api/v1/openapi.json');
    expect(resp.status()).toBe(200);
    const spec = await resp.json();
    expect(spec.paths?.['/api/v1/schedules']?.get).toBeDefined();
    expect(spec.paths?.['/api/v1/schedules']?.post).toBeDefined();
    expect(spec.paths?.['/api/v1/schedules/{id}']?.patch).toBeDefined();
    expect(spec.paths?.['/api/v1/schedules/{id}']?.delete).toBeDefined();
    expect(spec.paths?.['/api/v1/schedules/{id}/complete']?.post).toBeDefined();
    expect(spec.paths?.['/api/v1/schedules/insert-between']?.post).toBeDefined();
    expect(spec.components?.securitySchemes?.sessionAuth).toBeDefined();
    expect(spec.components?.schemas?.Schedule).toBeDefined();
  });

  test('@mutation 인증된 CRUD + cascade 체인 (prod-like)', async () => {
    test.skip(
      true,
      'prod-like — 실제 cofounder_jwt 세션 필요 (qa-bot 세션 쿠키 + router 도메인). ' +
        'cascade/overlap/낙관적동시성 코어는 unit + dev Neon 실측으로 검증. Phase B 모바일 클라 연동 시 활성.'
    );
  });

  test('@mutation 409 동시성 충돌 — 두 stale writer (prod-like)', async () => {
    test.skip(
      true,
      'prod-like — 멀티 세션 동시 write 필요. D1 guard(낙관적 동시성)는 lib/server/' +
        'concurrency-guard.test.ts + dev Neon batch 실측(ok/stale 경로)으로 검증 완료.'
    );
  });
});
