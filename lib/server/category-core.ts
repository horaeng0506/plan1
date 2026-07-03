/**
 * plan1-mobile A1 — 카테고리 REST 코어 (세션 JWT · IDOR · 이름 unique).
 * web app/actions/categories.ts 와 동작 동일 (단일 코어 · REST + web 공용).
 *
 * 정책(대장 2026-07-03 소프트 삭제 전환):
 *   - 활성(deleted_at IS NULL) 이름만 중복 금지 (DB 부분 unique index → 409 category_name_exists)
 *   - 삭제 = 소프트 삭제(deleted_at 마킹). 소속 스케줄 보존(그 카테고리 색·이름 계속 렌더).
 *   - 마지막 활성 카테고리는 삭제 불가 (선택 대상 최소 1개 유지 · 409 category_last_active).
 *   - 삭제된 이름은 재사용 가능(같은 이름 재생성 = 새 id 별개).
 *   - 목록은 삭제분 포함 반환(deletedAt 필드) → 클라가 색 렌더엔 쓰고 목록/선택엔 활성만 표시.
 */

import {randomUUID} from 'node:crypto';
import {and, eq, isNull, sql} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1Categories} from '@/lib/db/schema';
import {ApiError, isUniqueViolation} from '@/lib/server/api-error';
import type {Category} from '@/lib/domain/types';

type CategoryRow = typeof plan1Categories.$inferSelect;

function rowToDomain(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt.getTime(),
    deletedAt: row.deletedAt ? row.deletedAt.getTime() : null
  };
}

export async function listCategoriesCore(userId: string): Promise<Category[]> {
  // SELECT-then-INSERT seed (web 정합 · neon-http read-after-write race 회피).
  let rows = await db.select().from(plan1Categories).where(eq(plan1Categories.userId, userId));
  if (rows.length === 0) {
    await db
      .insert(plan1Categories)
      .values({id: `cat-${randomUUID()}`, userId, name: 'default', color: '#6b7280'})
      // 부분 unique index 정합: targetWhere 로 predicate 일치 (없으면 ON CONFLICT 매칭 실패).
      .onConflictDoNothing({
        target: [plan1Categories.userId, plan1Categories.name],
        where: isNull(plan1Categories.deletedAt)
      });
    rows = await db.select().from(plan1Categories).where(eq(plan1Categories.userId, userId));
  }
  return rows.map(rowToDomain);
}

export interface CreateCategoryInput {
  name: string;
  color: string;
}

export async function createCategoryCore(
  userId: string,
  input: CreateCategoryInput
): Promise<Category> {
  try {
    const [row] = await db
      .insert(plan1Categories)
      .values({id: `cat-${randomUUID()}`, userId, name: input.name.trim(), color: input.color})
      .returning();
    return rowToDomain(row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ApiError('category_name_exists', 409, 'Category name already exists');
    }
    throw e;
  }
}

export interface UpdateCategoryInput {
  id: string;
  name?: string;
  color?: string;
}

export async function updateCategoryCore(
  userId: string,
  input: UpdateCategoryInput
): Promise<Category> {
  const patch: Partial<typeof plan1Categories.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.color !== undefined) patch.color = input.color;
  try {
    const [row] = await db
      .update(plan1Categories)
      .set(patch)
      .where(and(eq(plan1Categories.id, input.id), eq(plan1Categories.userId, userId)))
      .returning();
    if (!row) throw new ApiError('category_not_found', 404, 'Category not found or not owned');
    return rowToDomain(row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ApiError('category_name_exists', 409, 'Category name already exists');
    }
    throw e;
  }
}

export interface DeleteCategoryInput {
  id: string;
  /** 소프트 삭제 전환(대장 2026-07-03) 이후 무시 — REST route 하위호환 위해 필드만 유지. */
  force?: boolean;
}

export async function deleteCategoryCore(
  userId: string,
  input: DeleteCategoryInput
): Promise<void> {
  // 소프트 삭제(대장 2026-07-03): 하드삭제/cascade 대신 deleted_at 마킹. 스케줄은 보존.
  // 마지막 활성 가드를 단일 조건부 UPDATE 에 흡수 — 3 RTT → 1 RTT + race 창 축소.
  // WHERE 안 상관 서브쿼리로 "활성 2개 이상일 때만" 삭제 (같은 statement snapshot 평가).
  // 잔여 race: neon-http(비 interactive tx)에서 서로 다른 row 동시 삭제가 각자 count=2 스냅샷을
  // 보면 둘 다 통과 가능(활성 0). 단일 클라 double-click 은 CategoryManager busy 락으로 봉쇄,
  // 멀티 디바이스 동시 삭제는 극저확률 + 비파괴(카테고리 재추가로 복구) 라 수용. 활성 0 도달 시
  // listCategoriesCore 재시드는 rows 전무일 때만이라 자동 복구 안 됨(사용자 추가로 복구).
  const updated = await db
    .update(plan1Categories)
    .set({deletedAt: new Date()})
    .where(
      and(
        eq(plan1Categories.id, input.id),
        eq(plan1Categories.userId, userId),
        isNull(plan1Categories.deletedAt),
        sql`(SELECT count(*) FROM ${plan1Categories} WHERE ${plan1Categories.userId} = ${userId} AND ${plan1Categories.deletedAt} IS NULL) > 1`
      )
    )
    .returning({id: plan1Categories.id});
  if (updated.length > 0) return; // 삭제 성공

  // 0행 → 원인 판별: 미존재/미소유 vs 이미 삭제(idempotent) vs 마지막 활성.
  const [target] = await db
    .select()
    .from(plan1Categories)
    .where(and(eq(plan1Categories.id, input.id), eq(plan1Categories.userId, userId)));
  if (!target) throw new ApiError('category_not_found', 404, 'Category not found or not owned');
  if (target.deletedAt) return; // 이미 삭제 — idempotent
  throw new ApiError('category_last_active', 409, 'Cannot delete the last active category');
}
