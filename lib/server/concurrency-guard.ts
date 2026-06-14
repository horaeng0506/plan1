/**
 * plan1-mobile A1 — 낙관적 동시성 제어 (Decision D1 · Option A).
 *
 * 문제: 스케줄 mutation 은 `loadUserState → 도메인(cascade/insert-between) → 전체 UPSERT`
 *   read-modify-write 라 cross-session lost-update 가 남는다. 웹·앱이 동시에 편집하면
 *   나중에 쓰는 쪽의 스테일 스냅샷 UPSERT 가 먼저 커밋된 신선한 결과를 통째로 덮어쓴다.
 *
 * 해법 (Option A · neon-http 유지): write 직전 스냅샷을 검증하는 guard statement 를
 *   db.batch(원자적 implicit tx · all-or-nothing) 의 첫 항목으로 넣는다. guard 는
 *   "사용자의 현재 스케줄 집합 == 스냅샷 집합" (id + updatedAt + 카디널리티) 일 때만 통과.
 *   불일치 시 sentinel 텍스트를 int 로 캐스팅 → 런타임 에러 → batch 전체 롤백 → 호출자가
 *   409 로 변환 → 클라가 refetch 후 재시도.
 *
 * 왜 whole-set 인가: 다른 세션이 (1) 같은 row 수정 (2) row 삭제 (3) row 추가 셋 다
 *   잡아야 한다. (3) 은 우리가 모르는 신규 row 라 cascade 결과가 overlap 불변식을 깰 수 있어
 *   카디널리티 비교가 필요하다. 동일 계정 동시 편집은 드물어 false-conflict 재시도 비용은 작다.
 *
 * 왜 1/0(division_by_zero) 인가: stale 일 때만 런타임 에러가 나야 한다. `'sentinel'::int`
 *   (텍스트→int 캐스트)는 파라미터 바인딩 시점에 코어션돼 CASE 조건과 무관하게 즉시 실패한다
 *   (dev Neon 실측 2026-06-14 — OK 경로도 에러). 대신 `1 / (CASE WHEN ok THEN 1 ELSE 0 END)`
 *   는 divisor 가 count(*) 서브쿼리(비상수) 기반 CASE 라 plan-time 폴딩되지 않고 런타임 평가 →
 *   stale 일 때만 0 으로 나눠 SQLSTATE 22012(division_by_zero)를 던진다. 본 batch 의 유일한
 *   나눗셈이라 22012 = 동시성 충돌로 단정 가능 (오탐 없음).
 *
 * 근거: wiki/projects/plan1-mobile/overview.md "A1 설계 노트" GAP 2 · context7 neon-http
 *   batch/transaction 공식 문서(2026-06-14 · interactive tx 미지원이라 advisory lock 불가)
 *   · dev Neon 실측(2026-06-14 · param-cast 코어션 vs 1/0 런타임 차이 확인).
 */

import {sql, type SQL} from 'drizzle-orm';
import {plan1Schedules} from '@/lib/db/schema';

/** stale 감지 시 던져지는 Postgres SQLSTATE (division_by_zero). 호출자가 409 판정에 사용. */
export const CONCURRENCY_SQLSTATE = '22012';

export interface SnapshotRow {
  id: string;
  /** loadUserState 시점의 updatedAt (ms epoch). 도메인 Schedule.updatedAt 그대로. */
  updatedAt: number;
}

/**
 * 스냅샷 검증 guard SQL 을 만든다. db.batch 의 첫 항목으로 `db.execute(...)` 에 감싸 넣는다.
 *
 * 통과 조건 (둘 다 만족):
 *   - 현재 사용자 스케줄 총 개수 === 스냅샷 개수 (신규 추가 row 차단)
 *   - 현재 사용자 스케줄 중 (id, updatedAt) 이 스냅샷과 정확히 일치하는 개수 === 스냅샷 개수
 *     (수정·삭제된 row 차단)
 *
 * 두 조건 + 스냅샷 id 유일성 → 현재 집합 == 스냅샷 집합 (정확 일치).
 */
export function buildConcurrencyGuardSql(userId: string, snapshot: SnapshotRow[]): SQL {
  const n = snapshot.length;

  const total = sql`(SELECT count(*) FROM ${plan1Schedules} WHERE ${plan1Schedules.userId} = ${userId})`;

  if (n === 0) {
    // 스냅샷이 비었으면 현재도 0건이어야 한다 (그 사이 다른 세션이 추가하지 않았는지).
    return sql`SELECT 1 / (CASE WHEN ${total} = 0 THEN 1 ELSE 0 END)`;
  }

  // (id, updated_at) row-value IN ((id1, ts1), (id2, ts2), ...) — Date 는 drizzle 이
  // timestamptz 파라미터로 바인딩 (앱 전역 eq(updatedAt, Date) 직렬화와 동일 → 정확 비교).
  const tuples = sql.join(
    snapshot.map(s => sql`(${s.id}, ${new Date(s.updatedAt)})`),
    sql`, `
  );
  const matched = sql`(SELECT count(*) FROM ${plan1Schedules} WHERE ${plan1Schedules.userId} = ${userId} AND (${plan1Schedules.id}, ${plan1Schedules.updatedAt}) IN (${tuples}))`;

  return sql`SELECT 1 / (CASE WHEN ${total} = ${n} AND ${matched} = ${n} THEN 1 ELSE 0 END)`;
}

/**
 * batch 실행 중 던져진 에러가 동시성 guard 의 stale 감지인지 판정.
 * NeonDbError 는 pg 에러 필드(`code` = SQLSTATE)를 노출 → 22012(division_by_zero) 우선 판정.
 * 드라이버 차이를 대비해 메시지의 'division by zero' 문자열도 보조 검사.
 */
export function isConcurrencyConflict(err: unknown): boolean {
  if (err == null) return false;
  const code = (err as {code?: unknown}).code;
  if (code === CONCURRENCY_SQLSTATE) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes('division by zero');
}
