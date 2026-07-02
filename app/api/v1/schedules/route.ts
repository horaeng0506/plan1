/**
 * plan1-mobile A1 — /api/v1/schedules (GET list · POST create).
 * 이중 인증: 세션 JWT(앱·웹 본인) 또는 API 키(plan1_api_*, 외부 클라이언트) — 대장 2026-07-02.
 * 각 사용자가 자기 API 키로 자기 일정을 추가·조회. IDOR: 코어가 WHERE user_id 강제. CORS + zod.
 */

import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateSessionOrApiKey, type DualAuthResult} from '@/lib/api-dual-auth';
import {buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {createScheduleCore, listSchedulesCore} from '@/lib/server/schedule-core';
import {handleApiError, jsonError, jsonOk, parseJsonBody} from '@/lib/server/schedule-rest';

const timerType = z.enum(['countup', 'timer1', 'countdown']);

const createScheduleSchema = z.object({
  title: z.string().min(1).max(500),
  categoryId: z.string().min(1).max(100),
  startAt: z.number().int(),
  durationMin: z.number().int().min(0).max(10080),
  timerType,
  chainedToPrev: z.boolean().optional()
});

// API 키 경로 응답에 X-RateLimit-* 헤더 부착(tasks API 계약 정합). 세션 경로면 rateLimit 없어 no-op.
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
    const schedules = await listSchedulesCore(auth.userId);
    return withRateLimit(jsonOk(schedules, 200), auth);
  } catch (e) {
    return withRateLimit(handleApiError(e), auth);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.ok) return auth.response;

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return withRateLimit(parsedBody.response, auth);

  const parsed = createScheduleSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return withRateLimit(
      jsonError(
        'invalid_input',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
        400
      ),
      auth
    );
  }

  try {
    const schedules = await createScheduleCore(auth.userId, parsed.data);
    // 감사 추적 — 외부 API 키가 일정을 쓸 수 있게 표면을 넓혔으므로 write 경로를 기록.
    console.info(
      `[v1-schedules] create via=${auth.via}${auth.apiKeyId ? ` key=${auth.apiKeyId}` : ''} user=${auth.userId}`
    );
    return withRateLimit(jsonOk(schedules, 201), auth);
  } catch (e) {
    return withRateLimit(handleApiError(e), auth);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
