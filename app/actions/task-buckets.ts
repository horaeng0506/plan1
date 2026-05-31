'use server';

/**
 * PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 사용자 정의 할일 카테고리(버킷) CRUD server actions.
 *
 * 보안: 모든 action 진입 시 requireUser() 강제. 모든 query 에 WHERE user_id = session.user.id.
 *
 * 정책:
 *   - 신규 사용자(또는 task 만 있고 버킷 없는 기존 사용자)는 listTaskBuckets 가 lazy + idempotent 시드:
 *     default 2개("당장 할일"=now / "나중 할일"=later) + 기존 task 의 bucketId backfill.
 *   - default 버킷은 name='' + defaultKind 보유 → 표시 시점에 i18n(task.bucketNow/bucketLater) 렌더.
 *     사용자가 이름 편집 시 defaultKind=null + name=입력값 → 이후 DB name 렌더 (다국어 보존 + 편집 양립).
 *   - uniqueIndex(userId, defaultKind) 가 default 버킷 이중 시드 race 를 DB 차원 차단 (NULL distinct).
 *   - 버킷 삭제 시 소속 task 는 FK ON DELETE cascade 로 동반 삭제 (사용자 결정 Q3-3). 최소 1개 유지 가드.
 *   - isCountBased 토글 시 소속 task 의 count 동기 (on→null 부여 / off→null 제거).
 */

import {randomUUID} from 'node:crypto';
import {and, asc, eq, isNull, sql} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1TaskBuckets, plan1Tasks} from '@/lib/db/schema';
import {requireUser} from '@/lib/auth-helpers';
import {ensureBuckets} from '@/lib/task-bucket-seed';
import {ServerActionError, runAction, type ServerActionResult} from '@/lib/server-action';
import type {TaskBucketInfo} from '@/lib/domain/types';

type BucketRow = typeof plan1TaskBuckets.$inferSelect;

function rowToDomain(row: BucketRow): TaskBucketInfo {
  return {
    id: row.id,
    name: row.name,
    isCountBased: row.isCountBased,
    sortOrder: row.sortOrder,
    defaultKind: row.defaultKind,
    createdAt: row.createdAt.getTime()
  };
}

async function selectBuckets(userId: string): Promise<TaskBucketInfo[]> {
  const rows = await db
    .select()
    .from(plan1TaskBuckets)
    .where(eq(plan1TaskBuckets.userId, userId))
    .orderBy(asc(plan1TaskBuckets.sortOrder), asc(plan1TaskBuckets.createdAt));
  return rows.map(rowToDomain);
}

/**
 * lazy seed + backfill. init Promise.all 에서 1회 호출 (categories.ts SELECT-then-INSERT 패턴).
 * - 버킷 0개면 default 2개 시드 (multi-row 단일 INSERT · onConflictDoNothing 으로 race 흡수).
 * - 기존 task 의 bucket(enum) 값을 시드된 default 버킷 id 로 backfill (bucketId IS NULL 인 행만).
 *   idempotent — 두 번째 호출부터 WHERE bucket_id IS NULL 이 0 행 매칭.
 */
export async function listTaskBuckets(): Promise<ServerActionResult<TaskBucketInfo[]>> {
  return runAction(async () => {
    const user = await requireUser();
    // lazy seed + backfill (단일 원천 lib/task-bucket-seed).
    const buckets = await ensureBuckets(user.id);
    return buckets.map(rowToDomain);
  });
}

export async function createTaskBucket(input: {
  name: string;
  isCountBased: boolean;
}): Promise<ServerActionResult<TaskBucketInfo[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const name = input.name.trim();
    if (name === '') throw new ServerActionError('serverError.taskBucketNameEmpty');
    // sortOrder = 현재 max + 1 (목록 끝에 추가).
    const rows = await db
      .select({sortOrder: plan1TaskBuckets.sortOrder})
      .from(plan1TaskBuckets)
      .where(eq(plan1TaskBuckets.userId, user.id));
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sortOrder), -1);
    await db.insert(plan1TaskBuckets).values({
      id: `bkt-${randomUUID()}`,
      userId: user.id,
      name,
      isCountBased: input.isCountBased,
      sortOrder: maxSort + 1,
      defaultKind: null
    });
    return selectBuckets(user.id);
  });
}

/**
 * 버킷 편집. 이름 입력 시 defaultKind=null 전환 (default → 사용자 정의). isCountBased 토글 시 task.count 동기.
 */
export async function updateTaskBucket(input: {
  id: string;
  name: string;
  isCountBased: boolean;
}): Promise<ServerActionResult<TaskBucketInfo[]>> {
  return runAction(async () => {
    const user = await requireUser();
    const existingRows = await db
      .select()
      .from(plan1TaskBuckets)
      .where(and(eq(plan1TaskBuckets.id, input.id), eq(plan1TaskBuckets.userId, user.id)))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) throw new ServerActionError('serverError.taskBucketNotFound');

    const trimmed = input.name.trim();
    const patch: Partial<typeof plan1TaskBuckets.$inferInsert> = {
      isCountBased: input.isCountBased
    };
    // 이름 입력(비어있지 않음) → DB name + defaultKind 해제. 빈 입력 → default 표식 유지 (i18n 렌더 보존).
    if (trimmed !== '') {
      patch.name = trimmed;
      patch.defaultKind = null;
    }

    await db
      .update(plan1TaskBuckets)
      .set(patch)
      .where(and(eq(plan1TaskBuckets.id, input.id), eq(plan1TaskBuckets.userId, user.id)));

    // isCountBased 토글 → 소속 task count 동기.
    if (input.isCountBased !== existing.isCountBased) {
      if (input.isCountBased) {
        // off → on: count 없는 task 에 기본 1 부여.
        await db
          .update(plan1Tasks)
          .set({count: 1})
          .where(
            and(
              eq(plan1Tasks.userId, user.id),
              eq(plan1Tasks.bucketId, input.id),
              isNull(plan1Tasks.count)
            )
          );
      } else {
        // on → off: count 제거.
        await db
          .update(plan1Tasks)
          .set({count: null})
          .where(and(eq(plan1Tasks.userId, user.id), eq(plan1Tasks.bucketId, input.id)));
      }
    }

    return selectBuckets(user.id);
  });
}

/**
 * 버킷 삭제. 최소 1개 유지 가드 + 소속 task FK cascade 삭제.
 * 조건부 DELETE — 다른 버킷이 1개 이상일 때만 (동시 삭제 race 차단).
 */
export async function deleteTaskBucket(input: {
  id: string;
}): Promise<ServerActionResult<TaskBucketInfo[]>> {
  return runAction(async () => {
    const user = await requireUser();
    // 조건부 DELETE: 같은 사용자의 다른 버킷이 존재할 때만 삭제 (마지막 1개 보호 · race 안전).
    const deleted = await db
      .delete(plan1TaskBuckets)
      .where(
        and(
          eq(plan1TaskBuckets.id, input.id),
          eq(plan1TaskBuckets.userId, user.id),
          sql`(SELECT count(*) FROM ${plan1TaskBuckets} b WHERE b.user_id = ${user.id} AND b.id <> ${input.id}) > 0`
        )
      )
      .returning({id: plan1TaskBuckets.id});
    if (deleted.length === 0) {
      // 삭제 0건 = 마지막 버킷이거나 이미 없음. 존재 여부로 분기.
      const stillExists = await db
        .select({id: plan1TaskBuckets.id})
        .from(plan1TaskBuckets)
        .where(and(eq(plan1TaskBuckets.id, input.id), eq(plan1TaskBuckets.userId, user.id)))
        .limit(1);
      if (stillExists[0]) throw new ServerActionError('serverError.taskBucketLastProtected');
    }
    return selectBuckets(user.id);
  });
}
