/**
 * plan1-mobile A1 — /api/v1/categories (GET list · POST create).
 * GET: 이중 인증(세션 JWT 또는 API 키) — 일정 생성 시 categoryId 조회용(대장 2026-07-02).
 * POST: 세션 JWT 전용(카테고리 생성은 앱·웹). IDOR: 코어가 WHERE user_id 강제. 이름 중복 → 409.
 */

import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateSession, buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {authenticateSessionOrApiKey, type DualAuthResult} from '@/lib/api-dual-auth';
import {createCategoryCore, listCategoriesCore} from '@/lib/server/category-core';
import {handleApiError, jsonError, jsonOk, parseJsonBody} from '@/lib/server/schedule-rest';

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().min(1).max(32)
});

// API 키 경로 응답에 X-RateLimit-* 헤더 부착(세션 경로면 no-op).
function withRateLimit(res: NextResponse, auth: DualAuthResult): NextResponse {
  if (auth.ok && auth.rateLimit) {
    res.headers.set('X-RateLimit-Limit', String(auth.rateLimit.limit));
    res.headers.set('X-RateLimit-Remaining', String(Math.max(0, auth.rateLimit.remaining)));
    res.headers.set('X-RateLimit-Reset', String(auth.rateLimit.resetUnix));
  }
  return res;
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.ok) return auth.response;
  try {
    return withRateLimit(jsonOk(await listCategoriesCore(auth.userId), 200), auth);
  } catch (e) {
    return withRateLimit(handleApiError(e), auth);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = createCategorySchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return jsonError(
      'invalid_input',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      400
    );
  }

  try {
    return jsonOk(await createCategoryCore(auth.user.id, parsed.data), 201);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
