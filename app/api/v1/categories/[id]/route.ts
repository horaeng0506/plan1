/**
 * plan1-mobile A1 — /api/v1/categories/{id} (PATCH update · DELETE).
 * 세션 JWT 인증. IDOR: 코어가 WHERE user_id 강제.
 * DELETE: 소속 스케줄 있으면 ?force=true 필요 (없으면 409 · cascade 사전 경고).
 */

import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateSession, buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {deleteCategoryCore, updateCategoryCore} from '@/lib/server/category-core';
import {handleApiError, jsonError, jsonOk, parseJsonBody} from '@/lib/server/schedule-rest';

const updateCategorySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    color: z.string().min(1).max(32).optional()
  })
  .refine(v => Object.keys(v).length > 0, {message: 'at least one field required'});

export async function PATCH(
  request: Request,
  context: {params: Promise<{id: string}>}
): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;

  const {id} = await context.params;
  if (!id || typeof id !== 'string') {
    return jsonError('invalid_id', 'Path parameter id required', 400);
  }

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = updateCategorySchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return jsonError(
      'invalid_input',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      400
    );
  }

  try {
    return jsonOk(await updateCategoryCore(auth.user.id, {id, ...parsed.data}), 200);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(
  request: Request,
  context: {params: Promise<{id: string}>}
): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;

  const {id} = await context.params;
  if (!id || typeof id !== 'string') {
    return jsonError('invalid_id', 'Path parameter id required', 400);
  }

  const force = new URL(request.url).searchParams.get('force') === 'true';

  try {
    await deleteCategoryCore(auth.user.id, {id, force});
    return jsonOk({id, deleted: true}, 200);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
