/**
 * plan1 — /api/v1/api-keys (GET list · POST create). 세션 JWT 전용(앱·웹 본인 · 대장 2026-07-02).
 * ⚡ 세션 전용 불변식 — dual-auth(authenticateSessionOrApiKey) 사용 금지. api-key 로 새 키를
 *   발급하면 권한 상승/무한 farming 이 되므로 authenticateSession(JWT) 만 허용한다.
 *   (회귀 가드: api-keys.session-only.guard.test.ts 가 dual-auth import 를 차단)
 * IDOR: 코어가 WHERE user_id 강제. plain key(rawKey)는 POST 응답에 1회만 노출.
 */

import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateSession, buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {createApiKeyCore, listApiKeysCore} from '@/lib/server/api-keys-core';
import {handleApiError, jsonError, jsonOk, parseJsonBody} from '@/lib/server/schedule-rest';

// 타입/형태만 검증 — 길이·trim·expires 범위는 코어(api-keys-core)가 단일 원천으로 검사.
const createApiKeySchema = z.object({
  name: z.string(),
  expiresInDays: z.number().int().nullable().optional()
});

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;
  try {
    return jsonOk(await listApiKeysCore(auth.user.id), 200);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = createApiKeySchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return jsonError(
      'invalid_input',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      400
    );
  }

  try {
    const created = await createApiKeyCore(auth.user.id, {
      name: parsed.data.name,
      expiresInDays: parsed.data.expiresInDays ?? null
    });
    return jsonOk(created, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
