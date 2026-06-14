/**
 * plan1-mobile A1 — 설정 REST 코어 (세션 JWT · 1:1 user row).
 * web app/actions/settings.ts 와 동작 동일 (web 미변경 · A4 합류).
 *
 * 정책(web 정합):
 *   - PK = userId (한 사용자 1행). 첫 접근 시 default upsert (onConflictDoNothing · race-safe).
 *   - patch 가능 필드 = theme · focusViewMin (zoomPxPerHour 는 UI 변경 폐기 · column 보존만).
 */

import {eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1Settings} from '@/lib/db/schema';
import type {AppSettings} from '@/lib/domain/types';

// web DEFAULT_SETTINGS 정합 — S12 column drop 까지 INSERT 호환 필드 보존.
const DEFAULT_SETTINGS = {
  theme: 'system' as const,
  weekViewSpan: 1 as const,
  weeklyPanelHidden: false,
  focusViewMin: 720 as number,
  zoomPxPerHour: 90 as number,
  pinnedActiveId: null as string | null
};

function rowToDomain(row: typeof plan1Settings.$inferSelect): AppSettings {
  return {
    theme: row.theme,
    focusViewMin: row.focusViewMin ?? 720,
    zoomPxPerHour: row.zoomPxPerHour ?? 90
  };
}

export async function getSettingsCore(userId: string): Promise<AppSettings> {
  // race-safe upsert: 동시 호출 PK 충돌 무시.
  await db
    .insert(plan1Settings)
    .values({userId, ...DEFAULT_SETTINGS})
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(plan1Settings)
    .where(eq(plan1Settings.userId, userId))
    .limit(1);
  if (!rows[0]) throw new Error('settings upsert failed (unexpected)');
  return rowToDomain(rows[0]);
}

export type SettingsPatch = Partial<Pick<AppSettings, 'theme' | 'focusViewMin'>>;

export async function updateSettingsCore(
  userId: string,
  patch: SettingsPatch
): Promise<AppSettings> {
  await getSettingsCore(userId); // 행 없으면 default 먼저 upsert.

  const dbPatch: Partial<typeof plan1Settings.$inferInsert> = {updatedAt: new Date()};
  if (patch.theme !== undefined) dbPatch.theme = patch.theme;
  if (patch.focusViewMin !== undefined) dbPatch.focusViewMin = patch.focusViewMin;
  // zoomPxPerHour patch 폐기 (web 정합 · 사용자 변경 영역 X).

  const [updated] = await db
    .update(plan1Settings)
    .set(dbPatch)
    .where(eq(plan1Settings.userId, userId))
    .returning();
  return rowToDomain(updated);
}
