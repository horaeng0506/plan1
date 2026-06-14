/**
 * plan1-mobile A1 — schedules REST 핸들러 공용 응답/파싱 유틸.
 * tasks API(`{data, error}` envelope + CORS)와 동일 형태. ScheduleError → status 매핑.
 */

import {NextResponse} from 'next/server';
import {sessionCorsHeaders} from '@/lib/api-session-auth';
import {ScheduleError} from '@/lib/server/schedule-core';

function headers(): Record<string, string> {
  return {...sessionCorsHeaders(), 'Content-Type': 'application/json'};
}

export function jsonOk(data: unknown, status = 200): NextResponse {
  return NextResponse.json({data, error: null}, {status, headers: headers()});
}

export function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({data: null, error: {code, message}}, {status, headers: headers()});
}

/** ScheduleError 면 매핑된 status·code, 그 외는 500 internal_error. */
export function handleScheduleError(e: unknown): NextResponse {
  if (e instanceof ScheduleError) {
    return jsonError(e.code, e.message, e.status);
  }
  // 예기치 못한 에러는 메시지 redact (정보 노출 차단) — 서버 로그엔 그대로 전파.
  console.error('[schedules-api] unexpected error:', e);
  return jsonError('internal_error', 'Unexpected server error', 500);
}

/** body JSON 파싱. 실패 시 400 envelope 반환. */
export async function parseJsonBody(
  request: Request
): Promise<{ok: true; body: unknown} | {ok: false; response: NextResponse}> {
  try {
    return {ok: true, body: await request.json()};
  } catch {
    return {
      ok: false,
      response: jsonError('invalid_json', 'Request body must be valid JSON', 400)
    };
  }
}
