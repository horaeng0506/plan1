'use server';

/**
 * 카테고리 CRUD server actions.
 *
 * 보안: 모든 action 진입 시 requireUser() 강제. 모든 query 에 WHERE user_id = session.user.id.
 * 정책 (PRD Stage 5):
 *   - 동일 사용자 안에서 카테고리 이름 중복 금지 (DB UNIQUE INDEX 로 enforce)
 *   - 카테고리 삭제 시 그 카테고리 소속 스케줄 동반 삭제 (DB cascade — Stage 21·critic 결정 2)
 *   - 사용자 실수 방지는 클라이언트 confirm 모달 책임 (Stage 3f)
 */

import {randomUUID} from 'node:crypto';
import {and, count, eq} from 'drizzle-orm';
import {revalidatePath} from 'next/cache';
import {db} from '@/lib/db';
import {plan1Categories, plan1Schedules} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import type {Category} from '@/lib/domain/types';

function rowToDomain(row: typeof plan1Categories.$inferSelect): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt.getTime()
  };
}

export async function listCategories(): Promise<Category[]> {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(plan1Categories)
    .where(eq(plan1Categories.userId, user.id));
  return rows.map(rowToDomain);
}

export async function createCategory(input: {name: string; color: string}): Promise<Category> {
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
  revalidatePath('/');
  return rowToDomain(row);
}

export async function updateCategory(input: {
  id: string;
  name?: string;
  color?: string;
}): Promise<Category> {
  const user = await requireUser();
  const patch: Partial<typeof plan1Categories.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.color !== undefined) patch.color = input.color;
  const [row] = await db
    .update(plan1Categories)
    .set(patch)
    .where(and(eq(plan1Categories.id, input.id), eq(plan1Categories.userId, user.id)))
    .returning();
  if (!row) throw new Error('Category not found or not owned');
  revalidatePath('/');
  return rowToDomain(row);
}

export async function deleteCategory(input: {id: string; force?: boolean}): Promise<void> {
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
      throw new Error(
        `Category has ${scheduleCount} schedules. Re-call with force=true to cascade delete.`
      );
    }
  }
  await db
    .delete(plan1Categories)
    .where(and(eq(plan1Categories.id, input.id), eq(plan1Categories.userId, user.id)));
  revalidatePath('/');
}
