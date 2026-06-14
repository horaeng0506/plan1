import {test, expect} from '@playwright/test';

/**
 * plan1-mobile A1 — /api/v1/categories · /api/v1/settings 세션 JWT REST API spec.
 * runnable: 401(미인증) · CORS preflight · OpenAPI 노출. 인증 CRUD 는 Phase B 클라 연동 시 활성.
 */

test.describe('categories / settings API — 세션 JWT 인증', () => {
  test('GET /categories — 미인증 401', async ({request}) => {
    const resp = await request.get('/project/plan1/api/v1/categories');
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error?.code).toBe('unauthorized');
  });

  test('GET /settings — 미인증 401', async ({request}) => {
    const resp = await request.get('/project/plan1/api/v1/settings');
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error?.code).toBe('unauthorized');
  });

  test('CORS preflight — /categories OPTIONS 204', async ({request}) => {
    const resp = await request.fetch('/project/plan1/api/v1/categories', {
      method: 'OPTIONS',
      headers: {Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST'}
    });
    expect(resp.status()).toBe(204);
    expect(resp.headers()['access-control-allow-origin']).toBe('*');
  });

  test('OpenAPI — categories/settings paths + 스키마 노출', async ({request}) => {
    const spec = await (await request.get('/project/plan1/api/v1/openapi.json')).json();
    expect(spec.paths?.['/api/v1/categories']?.get).toBeDefined();
    expect(spec.paths?.['/api/v1/categories']?.post).toBeDefined();
    expect(spec.paths?.['/api/v1/categories/{id}']?.patch).toBeDefined();
    expect(spec.paths?.['/api/v1/categories/{id}']?.delete).toBeDefined();
    expect(spec.paths?.['/api/v1/settings']?.get).toBeDefined();
    expect(spec.paths?.['/api/v1/settings']?.patch).toBeDefined();
    expect(spec.components?.schemas?.Category).toBeDefined();
    expect(spec.components?.schemas?.AppSettings).toBeDefined();
  });

  test('@mutation 인증된 categories/settings CRUD (prod-like)', async () => {
    test.skip(
      true,
      'prod-like — 실제 cofounder_jwt 세션 필요. 코어는 web actions 정합 미러 + unit. Phase B 클라 연동 시 활성.'
    );
  });
});
