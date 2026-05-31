/**
 * PLAN1-TASKS-BUCKET-CUSTOM-20260531 — default 버킷 lazy seed + 기존 task bucketId backfill.
 *
 * 단일 원천 — server action(task-buckets.ts listTaskBuckets)과 REST API(api/v1/tasks)가 공유.
 * idempotent: 두 번째 호출부터 seed/ backfill 모두 0 행 (이미 존재).
 *   - uniqueIndex(userId, defaultKind) 가 동시 seed race 를 DB 차원에서 흡수 (onConflictDoNothing).
 */

import {randomUUID} from 'node:crypto';
import {and, asc, eq, isNull} from 'drizzle-orm';
import {db} from '@/lib/db';
import {plan1TaskBuckets, plan1Tasks} from '@/lib/db/schema';

type BucketRow = typeof plan1TaskBuckets.$inferSelect;

async function selectBuckets(userId: string): Promise<BucketRow[]> {
  return db
    .select()
    .from(plan1TaskBuckets)
    .where(eq(plan1TaskBuckets.userId, userId))
    .orderBy(asc(plan1TaskBuckets.sortOrder), asc(plan1TaskBuckets.createdAt));
}

/**
 * 사용자의 버킷 목록을 보장 — 없으면 default 2개 시드 + 기존 task bucketId backfill 후 반환.
 */
export async function ensureBuckets(userId: string): Promise<BucketRow[]> {
  let buckets = await selectBuckets(userId);

  if (buckets.length === 0) {
    await db
      .insert(plan1TaskBuckets)
      .values([
        {id: `bkt-${randomUUID()}`, userId, name: '', isCountBased: false, sortOrder: 0, defaultKind: 'now'},
        {id: `bkt-${randomUUID()}`, userId, name: '', isCountBased: false, sortOrder: 1, defaultKind: 'later'}
      ])
      .onConflictDoNothing();
    buckets = await selectBuckets(userId);
  }

  const nowBucket = buckets.find(b => b.defaultKind === 'now');
  const laterBucket = buckets.find(b => b.defaultKind === 'later');
  if (nowBucket) {
    await db
      .update(plan1Tasks)
      .set({bucketId: nowBucket.id})
      .where(
        and(eq(plan1Tasks.userId, userId), isNull(plan1Tasks.bucketId), eq(plan1Tasks.bucket, 'now'))
      );
  }
  if (laterBucket) {
    await db
      .update(plan1Tasks)
      .set({bucketId: laterBucket.id})
      .where(
        and(eq(plan1Tasks.userId, userId), isNull(plan1Tasks.bucketId), eq(plan1Tasks.bucket, 'later'))
      );
  }

  return buckets;
}

/**
 * 'now' default 버킷 id 보장 (REST API task 생성 시 bucketId 채움용).
 */
export async function ensureNowBucketId(userId: string): Promise<string> {
  const buckets = await ensureBuckets(userId);
  const nowBucket = buckets.find(b => b.defaultKind === 'now') ?? buckets[0];
  return nowBucket.id;
}
