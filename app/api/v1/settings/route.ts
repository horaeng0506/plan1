/**
 * plan1-mobile A1 — /api/v1/settings (GET · PATCH).
 * 세션 JWT 인증. 1:1 user row (첫 접근 시 default upsert). patch = theme · focusViewMin.
 */

import {NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticateSession, buildSessionOptionsResponse} from '@/lib/api-session-auth';
import {getSettingsCore, updateSettingsCore} from '@/lib/server/settings-core';
import {handleApiError, jsonError, jsonOk, parseJsonBody} from '@/lib/server/schedule-rest';

const updateSettingsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    // 집중 보기 (분). web 옵션 [4·6·8·10·12·16·20·24h] = 240~1440. 범위만 강제.
    focusViewMin: z.number().int().min(60).max(1440).optional()
  })
  .refine(v => Object.keys(v).length > 0, {message: 'at least one field required'});

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;
  try {
    return jsonOk(await getSettingsCore(auth.user.id), 200);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await authenticateSession(request);
  if (!auth.ok) return auth.response;

  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = updateSettingsSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return jsonError(
      'invalid_input',
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      400
    );
  }

  try {
    return jsonOk(await updateSettingsCore(auth.user.id, parsed.data), 200);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return buildSessionOptionsResponse();
}
