/**
 * plan1-mobile A1 — /api/v1/schedules/insert-between (POST).
 * 새 스케줄을 충돌 스케줄 시작 위치에 "사이 삽입" (TOCTOU 가드 · cascade 밀기).
 * web insertScheduleBetween 정합. id 컬렉션 연산이라 collection 루트에 둠.
 */

import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateSession, buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {insertScheduleBetweenCore} from '@/lib/server/schedule-core';
import {handleApiError, jsonError, jsonOk, parseJsonBody} from '@/lib/server/schedule-rest';

const timerType = z.enum(['countup', 'timer1', 'countdown']);

const insertBetweenSchema = z.object({
  title: z.string().min(1).max(500),
  categoryId: z.string().min(1).max(100),
  durationMin: z.number().int().min(0).max(10080),
  timerType,
  conflictId: z.string().min(1).max(100),
  expectedConflictStart: z.number().int()
});

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = insertBetweenSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return jsonError(
      'invalid_input',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      400
    );
  }

  try {
    const schedules = await insertScheduleBetweenCore(auth.user.id, parsed.data);
    return jsonOk(schedules, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
