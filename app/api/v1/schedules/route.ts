/**
 * plan1-mobile A1 — /api/v1/schedules (GET list · POST create).
 * 세션 JWT 인증(cofounder_jwt). IDOR: 코어가 WHERE user_id 강제. CORS + zod.
 */

import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateSession, buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {createScheduleCore, listSchedulesCore} from '@/lib/server/schedule-core';
import {handleScheduleError, jsonError, jsonOk, parseJsonBody} from '@/lib/server/schedule-rest';

const timerType = z.enum(['countup', 'timer1', 'countdown']);

const createScheduleSchema = z.object({
  title: z.string().min(1).max(500),
  categoryId: z.string().min(1).max(100),
  startAt: z.number().int(),
  durationMin: z.number().int().min(0).max(10080),
  timerType,
  chainedToPrev: z.boolean().optional()
});

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;
  try {
    const schedules = await listSchedulesCore(auth.user.id);
    return jsonOk(schedules, 200);
  } catch (e) {
    return handleScheduleError(e);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = createScheduleSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return jsonError(
      'invalid_input',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      400
    );
  }

  try {
    const schedules = await createScheduleCore(auth.user.id, parsed.data);
    return jsonOk(schedules, 201);
  } catch (e) {
    return handleScheduleError(e);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
