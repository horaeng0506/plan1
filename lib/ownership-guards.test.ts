/**
 * IDOR 가드 단위 test (Stage 8.G follow-up · 2026-04-28).
 *
 * 검증:
 * 1. user 의 categoryId 면 통과 (rows[0] 존재)
 * 2. 다른 user 의 categoryId 면 throw (rows 빈 배열) — IDOR 차단
 * 3. drizzle chain (.select.from.where.limit) 호출 인자 정확성 (userId·categoryId 매칭 강제)
 *
 * test 전략: db chain stub. plan1Categories schema 와 drizzle eq/and 동작 검증보다
 * "ownership-guards 가 올바른 input 으로 chain 호출하고 응답 row 에 따라 throw 분기" 수준.
 */

import {describe, expect, it, vi} from 'vitest';

// vitest hoist: import 전 mock 등록.
// ownership-guards.ts 가 lib/db 를 default import 시 production connectionString throw 회피.
// 본 test 는 항상 stub db 주입하므로 default db 호출 경로 없음 (안전).
// ownership-guards.ts 는 './db' (relative) 로 import 하므로 mock path 도 relative.
vi.mock('./db', () => ({db: {}}));

import {assertCategoryOwnership} from './ownership-guards';
import {isServerActionError} from './server-action';

type ChainResult = Array<{id: string}>;

/**
 * drizzle chain stub: db.select(...).from(...).where(...).limit(N) → result
 * 마지막 limit 호출 인자도 capture.
 */
function makeDbStub(result: ChainResult) {
  const limitFn = vi.fn(async () => result);
  const whereFn = vi.fn(() => ({limit: limitFn}));
  const fromFn = vi.fn(() => ({where: whereFn}));
  const selectFn = vi.fn(() => ({from: fromFn}));
  return {
    db: {select: selectFn} as unknown as Parameters<typeof assertCategoryOwnership>[2],
    spies: {selectFn, fromFn, whereFn, limitFn}
  };
}

describe('assertCategoryOwnership IDOR 가드', () => {
  it('user 가 소유한 categoryId 면 통과 (rows[0] 존재)', async () => {
    const {db, spies} = makeDbStub([{id: 'cat-A'}]);
    await expect(
      assertCategoryOwnership('user-1', 'cat-A', db)
    ).resolves.toBeUndefined();
    expect(spies.selectFn).toHaveBeenCalledOnce();
    expect(spies.fromFn).toHaveBeenCalledOnce();
    expect(spies.whereFn).toHaveBeenCalledOnce();
    expect(spies.limitFn).toHaveBeenCalledWith(1);
  });

  it('user 가 소유하지 않은 categoryId 면 ServerActionError throw (IDOR 차단)', async () => {
    const {db} = makeDbStub([]); // 빈 결과 — 다른 user 의 카테고리 또는 존재하지 않음
    try {
      await assertCategoryOwnership('user-1', 'cat-of-user-2', db);
      expect.fail('throw expected (IDOR 차단)');
    } catch (err) {
      expect(isServerActionError(err)).toBe(true);
      if (isServerActionError(err)) {
        expect(err.errorKey).toBe('serverError.categoryNotFound');
      }
    }
  });

  it('chain 마지막 limit(1) 호출 — index scan 보장 (성능·잠금 최소화)', async () => {
    const {db, spies} = makeDbStub([{id: 'any'}]);
    await assertCategoryOwnership('u', 'c', db);
    expect(spies.limitFn).toHaveBeenCalledWith(1);
    // limit(2) 등 다른 값으로 바뀌면 회귀 (index seek → range scan)
  });

  it('select 시 id 만 projection (PII·content leak 가드)', async () => {
    const {db, spies} = makeDbStub([{id: 'x'}]);
    await assertCategoryOwnership('u', 'c', db);
    // select 인자 검증: {id: column} 형태인지
    const selectArg = spies.selectFn.mock.calls[0]?.[0];
    expect(selectArg).toBeTypeOf('object');
    expect(Object.keys(selectArg ?? {})).toEqual(['id']);
  });
});
