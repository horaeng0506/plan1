'use server';

/**
 * 카테고리 CRUD server actions.
 *
 * 보안: 모든 action 진입 시 requireUser() 강제. 모든 query 에 WHERE user_id = session.user.id.
 * 정책 (PRD Stage 5):
 *   - 동일 사용자 안에서 카테고리 이름 중복 금지 (DB UNIQUE INDEX 로 enforce)
 *   - 카테고리 삭제 시 그 카테고리 소속 스케줄 동반 삭제 (DB cascade — Stage 21·critic 결정 2)
 *   - 사용자 실수 방지는 클라이언트 confirm 모달 책임 (Stage 3f)
 *
 * Stage 5.1 part 2: 사용자 facing error 는 ServerActionError throw → runAction 이
 * discriminated union return 으로 변환 (Next.js prod redact 회피). Next.js 14 'use server'
 * 정합성 위해 export 는 `async function` 형태 유지 (HOF wrap 금지).
 */

import {randomUUID} from 'node:crypto';
import {and, count, eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1Categories, plan1Schedules} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {ServerActionError, runAction, type ServerActionResult} from '@/lib/server-action';
import type {Category} from '@/lib/domain/types';

function rowToDomain(row: typeof plan1Categories.$inferSelect): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt.getTime()
  };
}

export async function listCategories(): Promise<ServerActionResult<Category[]>> {
  return runAction(async () => {
    const user = await requireUser();
    // Track 1 fix (2026-04-29 · env-critic 채택): SELECT-then-INSERT 패턴.
    // 1) 매 호출 INSERT 부하 제거 (이미 시드된 user 는 INSERT 안 침)
    // 2) Neon HTTP driver per-query connection 의 read-after-write race 회피
    //    (INSERT 후 SELECT 가 별도 connection 이면 commit visibility 약함 → 빈 array 가능)
    // 3) onConflictDoNothing target 을 (user_id, name) UNIQUE INDEX 로 명시 — id PK 등
    //    의도 외 충돌 흡수 차단
    let rows = await db
      .select()
      .from(plan1Categories)
      .where(eq(plan1Categories.userId, user.id));
    if (rows.length === 0) {
      await db
        .insert(plan1Categories)
        .values({
          id: `cat-${randomUUID()}`,
          userId: user.id,
          name: 'default',
          color: '#6b7280'
        })
        .onConflictDoNothing({
          target: [plan1Categories.userId, plan1Categories.name]
        });
      rows = await db
        .select()
        .from(plan1Categories)
        .where(eq(plan1Categories.userId, user.id));
    }
    return rows.map(rowToDomain);
  });
}

export async function createCategory(
  input: {name: string; color: string}
): Promise<ServerActionResult<Category>> {
  return runAction(async () => {
    const user = await requireUser();
    const id = `cat-${randomUUID()}`;
    const [row] = await db
      .insert(plan1Categories)
      .values({
        id,
        userId: user.id,
        name: input.name.trim(),
        color: input.color
      })
      .returning();
    return rowToDomain(row);
  });
}

export async function updateCategory(
  input: {id: string; name?: string; color?: string}
): Promise<ServerActionResult<Category>> {
  return runAction(async () => {
    const user = await requireUser();
    const patch: Partial<typeof plan1Categories.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.color !== undefined) patch.color = input.color;
    const [row] = await db
      .update(plan1Categories)
      .set(patch)
      .where(and(eq(plan1Categories.id, input.id), eq(plan1Categories.userId, user.id)))
      .returning();
    if (!row) throw new ServerActionError('serverError.categoryNotFound');
    return rowToDomain(row);
  });
}

export async function deleteCategory(
  input: {id: string; force?: boolean}
): Promise<ServerActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    // cascade DELETE: schedules.category_id -> categories.id ON DELETE CASCADE
    // logic-critic Major: server-side 가드 — schedule 1개 이상이면 force=true 명시 강제.
    // 클라이언트 confirm 모달이 force=true 로 재호출 책임 (Stage 3f).
    if (!input.force) {
      const [{value: scheduleCount}] = await db
        .select({value: count()})
        .from(plan1Schedules)
        .where(
          and(eq(plan1Schedules.userId, user.id), eq(plan1Schedules.categoryId, input.id))
        );
      if (scheduleCount > 0) {
        throw new ServerActionError('serverError.categoryHasSchedules', {scheduleCount});
      }
    }
    await db
      .delete(plan1Categories)
      .where(and(eq(plan1Categories.id, input.id), eq(plan1Categories.userId, user.id)));
  });
}
