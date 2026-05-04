'use server';

/**
 * 사용자 설정 (1:1) — theme · weekViewSpan · weeklyPanelHidden · focusViewMin · pinnedActiveId.
 *
 * PLAN1-WH-FOCUS-20260504:
 *   - defaultWorkingHours 폐기 (working hours 기능 자체 제거)
 *   - focusViewMin 신규 (집중 보기 모드 · null = 전체 보기)
 *
 * 정책:
 *   - PK = user_id (한 사용자 = 1행). 첫 호출 시 default 로 upsert.
 *   - pinnedActiveId FK set null — 스케줄 삭제 시 자동 해제 (DB enforce, Stage 20)
 *
 * Stage 5.1 part 2: 사용자 facing error 는 ServerActionError throw → runAction 변환.
 * `getSettings` 가 같은 모듈의 `updateSettings` 에서도 호출되므로 internal helper
 * `getSettingsImpl` 분리. 'use server' 모듈의 unexported async function 은 server
 * action 으로 노출 안 됨 (Next.js 14 동작) → 안전.
 */

import {and, eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1Schedules, plan1Settings} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {ServerActionError, runAction, type ServerActionResult} from '@/lib/server-action';
import type {AppSettings} from '@/lib/domain/types';

const DEFAULT_SETTINGS = {
  theme: 'system' as const,
  weekViewSpan: 1 as const,
  weeklyPanelHidden: false,
  focusViewMin: null as number | null,
  pinnedActiveId: null as string | null
};

function rowToDomain(row: typeof plan1Settings.$inferSelect): AppSettings {
  return {
    theme: row.theme,
    weekViewSpan: row.weekViewSpan,
    weeklyPanelHidden: row.weeklyPanelHidden,
    focusViewMin: row.focusViewMin,
    pinnedActiveId: row.pinnedActiveId
  };
}

// internal — 같은 모듈 안에서 다른 server action 이 직접 호출 (wrap 우회).
// 'use server' 모듈의 unexported async function 은 RSC endpoint 로 노출 안 됨.
async function getSettingsImpl(): Promise<AppSettings> {
  const user = await requireUser();
  // race-safe upsert: 동시 호출 2건이 INSERT 충돌해도 PK conflict 무시 (logic-critic Minor)
  await db
    .insert(plan1Settings)
    .values({userId: user.id, ...DEFAULT_SETTINGS})
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(plan1Settings)
    .where(eq(plan1Settings.userId, user.id))
    .limit(1);
  if (!rows[0]) throw new Error('settings upsert failed (unexpected)');
  return rowToDomain(rows[0]);
}

export async function getSettings(): Promise<ServerActionResult<AppSettings>> {
  return runAction(getSettingsImpl);
}

export async function updateSettings(
  patch: Partial<AppSettings>
): Promise<ServerActionResult<AppSettings>> {
  return runAction(async () => {
    const user = await requireUser();
    // security HIGH IDOR fix: pinnedActiveId 가 다른 user 의 schedule 이면 차단
    if (patch.pinnedActiveId !== undefined && patch.pinnedActiveId !== null) {
      const [s] = await db
        .select({id: plan1Schedules.id})
        .from(plan1Schedules)
        .where(
          and(eq(plan1Schedules.id, patch.pinnedActiveId), eq(plan1Schedules.userId, user.id))
        )
        .limit(1);
      if (!s) throw new ServerActionError('serverError.scheduleNotFound');
    }
    // settings 행이 없으면 default 먼저 upsert (internal helper 사용 — wrap 우회)
    await getSettingsImpl();

    const dbPatch: Partial<typeof plan1Settings.$inferInsert> = {updatedAt: new Date()};
    if (patch.theme !== undefined) dbPatch.theme = patch.theme;
    if (patch.weekViewSpan !== undefined) dbPatch.weekViewSpan = patch.weekViewSpan;
    if (patch.weeklyPanelHidden !== undefined) dbPatch.weeklyPanelHidden = patch.weeklyPanelHidden;
    if (patch.focusViewMin !== undefined) dbPatch.focusViewMin = patch.focusViewMin;
    if (patch.pinnedActiveId !== undefined) dbPatch.pinnedActiveId = patch.pinnedActiveId;

    const [updated] = await db
      .update(plan1Settings)
      .set(dbPatch)
      .where(eq(plan1Settings.userId, user.id))
      .returning();
    return rowToDomain(updated);
  });
}
