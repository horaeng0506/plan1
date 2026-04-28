/**
 * IDOR 가드 헬퍼 (Stage 8.G follow-up · 2026-04-28).
 *
 * server action 안에서 외래 ID(categoryId 등) 를 받을 때 user 소유 검증.
 * 미통과 시 `ServerActionError` throw → runAction 가 ok:false 변환.
 *
 * security-auditor HIGH (IDOR): plan1Schedules.categoryId FK 는 plan1Categories.id 만
 * 참조 → 다른 user 의 category id 를 patch 로 받으면 cross-tenant 데이터 오염.
 *
 * 별도 module 로 추출한 이유 (Stage 8.G test 보강):
 *   - server action 파일(schedules.ts)에 inline 시 'use server' directive 와 vitest mock
 *     상호작용 복잡 → 단위 test 어려움
 *   - 향후 다른 외래 ID 가드 (workingHours·settings 의 cross-id 검증) 도 같은 패턴으로 합류 가능
 */

import {and, eq} from 'drizzle-orm';
import {db as defaultDb} from './db';
import {plan1Categories} from './db/schema';
import {ServerActionError} from './server-action';

// db client 인터페이스 — 실제 db 와 test mock 모두 만족
type DbLike = typeof defaultDb;

export async function assertCategoryOwnership(
  userId: string,
  categoryId: string,
  dbClient: DbLike = defaultDb
): Promise<void> {
  const rows = await dbClient
    .select({id: plan1Categories.id})
    .from(plan1Categories)
    .where(and(eq(plan1Categories.id, categoryId), eq(plan1Categories.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new ServerActionError('serverError.categoryNotFound');
}
