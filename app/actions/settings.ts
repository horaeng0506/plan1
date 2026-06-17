'use server';

/**
 * 사용자 설정 (1:1) — theme · focusViewMin.
 *
 * A4-1 (2026-06-17): 로직을 `lib/server/settings-core` 단일 코어로 통합.
 *   - PK = userId (한 사용자 1행). 첫 접근 시 default upsert (race-safe onConflictDoNothing).
 *   - patch 가능 필드 = theme · focusViewMin (zoomPxPerHour 는 UI 변경 폐기 · column 보존만).
 *   - settings 는 도메인 에러 없음(단순 upsert) → 어댑터는 방어적으로만 적용.
 */

import {requireUser} from '@/lib/auth-helpers';
import {runAction, type ServerActionResult} from '@/lib/server-action';
import {callCore} from '@/lib/server/action-error-adapter';
import {getSettingsCore, updateSettingsCore} from '@/lib/server/settings-core';
import type {AppSettings} from '@/lib/domain/types';

export async function getSettings(): Promise<ServerActionResult<AppSettings>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => getSettingsCore(user.id));
  });
}

export async function updateSettings(
  patch: Partial<AppSettings>
): Promise<ServerActionResult<AppSettings>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => updateSettingsCore(user.id, patch));
  });
}
