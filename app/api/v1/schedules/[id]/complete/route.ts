/**
 * plan1-mobile A1 — /api/v1/schedules/{id}/complete (POST).
 * 스케줄 완료 처리 (actualDurationMin 기록 + cascade delta 전파 + completedAt).
 */

import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateSession, buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {completeScheduleCore} from '@/lib/server/schedule-core';
import {handleScheduleError, jsonError, jsonOk, parseJsonBody} from '@/lib/server/schedule-rest';

const completeSchema = z.object({
  completeAtMs: z.number().int()
});

export async function POST(
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

  const parsed = completeSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return jsonError(
      'invalid_input',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      400
    );
  }

  try {
    const schedules = await completeScheduleCore(auth.user.id, {
      id,
      completeAtMs: parsed.data.completeAtMs
    });
    return jsonOk(schedules, 200);
  } catch (e) {
    return handleScheduleError(e);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
