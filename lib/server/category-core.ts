/**
 * plan1-mobile A1 — 카테고리 REST 코어 (세션 JWT · IDOR · 이름 unique).
 * web app/actions/categories.ts 와 동작 동일 (web 미변경 · REST 가 단독 사용 · A4 합류).
 *
 * 정책(web 정합):
 *   - 동일 사용자 이름 중복 금지 (DB unique index → 409 category_name_exists)
 *   - 삭제 시 소속 스케줄 있으면 force=true 명시 강제 (없으면 409 category_has_schedules)
 *   - 카테고리 삭제 = 소속 스케줄 cascade DELETE (DB onDelete cascade)
 */

import {randomUUID} from 'node:crypto';
import {and, count, eq} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1Categories, plan1Schedules} from '@/lib/db/schema';
import {ApiError, isUniqueViolation} from '@/lib/server/api-error';
import type {Category} from '@/lib/domain/types';

type CategoryRow = typeof plan1Categories.$inferSelect;

function rowToDomain(row: CategoryRow): Category {
  return {id: row.id, name: row.name, color: row.color, createdAt: row.createdAt.getTime()};
}

export async function listCategoriesCore(userId: string): Promise<Category[]> {
  // SELECT-then-INSERT seed (web 정합 · neon-http read-after-write race 회피).
  let rows = await db.select().from(plan1Categories).where(eq(plan1Categories.userId, userId));
  if (rows.length === 0) {
    await db
      .insert(plan1Categories)
      .values({id: `cat-${randomUUID()}`, userId, name: 'default', color: '#6b7280'})
      .onConflictDoNothing({target: [plan1Categories.userId, plan1Categories.name]});
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
  force?: boolean;
}

export async function deleteCategoryCore(
  userId: string,
  input: DeleteCategoryInput
): Promise<void> {
  // 소속 스케줄 1개 이상이면 force=true 명시 강제 (cascade 삭제 사전 경고 · web 정합).
  if (!input.force) {
    const [{value: scheduleCount}] = await db
      .select({value: count()})
      .from(plan1Schedules)
      .where(and(eq(plan1Schedules.userId, userId), eq(plan1Schedules.categoryId, input.id)));
    if (scheduleCount > 0) {
      throw new ApiError(
        'category_has_schedules',
        409,
        `Category has ${scheduleCount} schedule(s); pass force=true to cascade delete`
      );
    }
  }
  await db
    .delete(plan1Categories)
    .where(and(eq(plan1Categories.id, input.id), eq(plan1Categories.userId, userId)));
}
