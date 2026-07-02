/**
 * plan1 — /api/v1/api-keys/{id} (DELETE revoke). 세션 JWT 전용.
 * 멱등 — 없거나 이미 폐기여도 200 + 현재 목록. IDOR: 코어가 WHERE user_id 강제.
 */

import {NextResponse} from 'next/server';
import {authenticateSession, buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {revokeApiKeyCore} from '@/lib/server/api-keys-core';
import {handleApiError, jsonOk} from '@/lib/server/schedule-rest';

export async function DELETE(
  request: Request,
  context: {params: Promise<{id: string}>}
): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;
  const {id} = await context.params;
  try {
    return jsonOk(await revokeApiKeyCore(auth.user.id, id), 200);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
