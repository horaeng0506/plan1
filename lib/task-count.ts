import type {TaskBucketKindType} from './domain/types';

/**
 * PLAN1-TASKS-BUCKET-KIND-20260602 — 횟수차감형(kind='count') 버킷의 count 정규화.
 *   count 버킷: ≥1 (default 1) / 일회성·무제한: null.
 *
 * 'use server' 밖(sync export) — server action(tasks.ts)과 REST API(route.ts)가 공유.
 * REST 경로가 count 정규화를 건너뛰면 count 버킷 task 가 count=null 동기 깨짐 → 변환 차단
 * (logic-critic Major). 단일 원천으로 차단.
 */
export function normalizeCount(
  kind: TaskBucketKindType,
  requested: number | null | undefined
): number | null {
  if (kind !== 'count') return null;
  const n = requested ?? 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}
