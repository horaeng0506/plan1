/**
 * plan1-mobile A1 — /api/v1/schedules/{id} (PATCH update · DELETE).
 * 세션 JWT 인증. id 는 경로 파라미터, 변경 필드는 body. IDOR: 코어가 WHERE user_id 강제.
 */

import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateSession, buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {deleteScheduleCore, updateScheduleCore} from '@/lib/server/schedule-core';
import {handleApiError, jsonError, jsonOk, parseJsonBody} from '@/lib/server/schedule-rest';

const timerType = z.enum(['countup', 'timer1', 'countdown']);

const updateScheduleSchema = z
  .object({
    startAt: z.number().int().optional(),
    durationMin: z.number().int().min(0).max(10080).optional(),
    title: z.string().min(1).max(500).optional(),
    categoryId: z.string().min(1).max(100).optional(),
    timerType: timerType.optional(),
    chainedToPrev: z.boolean().optional()
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

  const parsed = updateScheduleSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return jsonError(
      'invalid_input',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      400
    );
  }

  try {
    const schedules = await updateScheduleCore(auth.user.id, {id, ...parsed.data});
    return jsonOk(schedules, 200);
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

  try {
    await deleteScheduleCore(auth.user.id, id);
    return jsonOk({id, deleted: true}, 200);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
