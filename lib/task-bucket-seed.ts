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
  const buckets = await selectBuckets(userId);
  // warm path (사용자당 첫 시드 이후 매 로드): SELECT 1회만. backfill/INSERT 안 함 (latency 가드).
  if (buckets.length > 0) return buckets;

  // 첫 시드 (사용자당 1회) — default 2개 INSERT + 기존 'now'/'later' task bucketId backfill.
  // seed 와 backfill 이 같은 코드 배포로 함께 들어오므로, 첫 listTaskBuckets 호출 시점에만 1회 수행.
  // 이후 호출은 위 warm path 로 단락 (PLAN1-TASKS-BUCKET-CUSTOM-20260531 latency fix).
  //
  // ⚡ neon-http read-after-write race 가드 (categories.ts 주석 정합):
  //   INSERT 후 별도 SELECT 는 per-query connection 의 commit visibility 약함 → 빈 배열 가능
  //   (실측: 첫 로드 taskBuckets 비어 TaskModal submit disabled). `.returning()` 으로 같은
  //   statement 에서 시드된 행 직접 획득 → race-free. 충돌(동시 seed) 시 returning 0 → SELECT fallback.
  const inserted = await db
    .insert(plan1TaskBuckets)
    .values([
      {id: `bkt-${randomUUID()}`, userId, name: '', kind: 'one-time', isCountBased: false, sortOrder: 0, defaultKind: 'now'},
      {id: `bkt-${randomUUID()}`, userId, name: '', kind: 'one-time', isCountBased: false, sortOrder: 1, defaultKind: 'later'}
    ])
    .onConflictDoNothing()
    .returning();
  const seeded =
    inserted.length >= 2
      ? inserted.slice().sort((a, b) => a.sortOrder - b.sortOrder)
      : await selectBuckets(userId);

  const nowBucket = seeded.find(b => b.defaultKind === 'now');
  const laterBucket = seeded.find(b => b.defaultKind === 'later');
  const backfills: Array<Promise<unknown>> = [];
  if (nowBucket) {
    backfills.push(
      db
        .update(plan1Tasks)
        .set({bucketId: nowBucket.id})
        .where(and(eq(plan1Tasks.userId, userId), isNull(plan1Tasks.bucketId), eq(plan1Tasks.bucket, 'now')))
    );
  }
  if (laterBucket) {
    backfills.push(
      db
        .update(plan1Tasks)
        .set({bucketId: laterBucket.id})
        .where(and(eq(plan1Tasks.userId, userId), isNull(plan1Tasks.bucketId), eq(plan1Tasks.bucket, 'later')))
    );
  }
  if (backfills.length > 0) await Promise.all(backfills);

  return seeded;
}

/**
 * 'now' default 버킷 id 보장 (REST API task 생성 시 bucketId 채움용).
 */
export async function ensureNowBucketId(userId: string): Promise<string> {
  const buckets = await ensureBuckets(userId);
  const nowBucket = buckets.find(b => b.defaultKind === 'now') ?? buckets[0];
  return nowBucket.id;
}
