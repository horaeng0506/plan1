'use server';

/**
 * 카테고리 CRUD server actions.
 *
 * A4-1 (2026-06-17): 로직을 `lib/server/category-core` 단일 코어로 통합.
 *   - listCategoriesCore 의 SELECT-then-INSERT seed (neon-http read-after-write race 회피) 포함.
 *   - 코어 ApiError → ServerActionError 변환은 callCore 어댑터.
 *   - ⚡ 동작 불변: create/update 의 이름 중복(category_name_exists)은 웹 기존 action 이 미처리
 *     (DB 에러 → error.unknown) 였으므로, 어댑터가 category_name_exists → error.unknown 으로
 *     보존한다. 전용 에러 메시지 개선은 A4-2.
 *
 * 보안: 코어 모든 query 에 WHERE user_id. 삭제 시 소속 스케줄 있으면 force=true 강제(409).
 */

import {requireUser} from '@/lib/auth-helpers';
import {runAction, type ServerActionResult} from '@/lib/server-action';
import {callCore} from '@/lib/server/action-error-adapter';
import {
  listCategoriesCore,
  createCategoryCore,
  updateCategoryCore,
  deleteCategoryCore
} from '@/lib/server/category-core';
import type {Category} from '@/lib/domain/types';

export async function listCategories(): Promise<ServerActionResult<Category[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => listCategoriesCore(user.id));
  });
}

export async function createCategory(
  input: {name: string; color: string}
): Promise<ServerActionResult<Category>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => createCategoryCore(user.id, input));
  });
}

export async function updateCategory(
  input: {id: string; name?: string; color?: string}
): Promise<ServerActionResult<Category>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => updateCategoryCore(user.id, input));
  });
}

export async function deleteCategory(
  input: {id: string; force?: boolean}
): Promise<ServerActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => deleteCategoryCore(user.id, input));
  });
}
