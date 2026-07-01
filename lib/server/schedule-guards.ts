/**
 * A4 write 경로 guard 토글 (웹/REST 동작 분기).
 *
 * db 의존 없는 순수 상수 — schedule-core(db import) 와 분리해 단위 test 가 db 없이 import 가능.
 *   - REST(모바일 앱): 둘 다 on — 서버측 overlap 검증 + 낙관적 동시성(D1).
 *   - 웹(A4-1): 둘 다 off — server action 기존 동작 불변(클라가 overlap 차단 · D1 미적용).
 *     A4-2 에서 lock-out 사전 실측 + 클라 409 핸들링 + i18n 갖춘 뒤 웹도 on 전환 예정.
 */
export interface WriteGuards {
  enforceOverlap: boolean;
  enforceConcurrency: boolean;
  // S5 (PLAN1-SAME-TYPE-OVERLAP-20260701) — 같은 종류(chainedToPrev) 겹침 금지.
  // 대장 2026-07-01 "규칙 다 동일" → 웹·REST 둘 다 on. delta 스코프라 과거 누적 lock-out 없음.
  // enforceOverlap(MAX_OVERLAP) 과 독립 — 웹은 enforceOverlap off 지만 same-type 은 on.
  enforceSameTypeOverlap: boolean;
}

/** REST 기본 — 기존 동작 보존 + same-type 검증. */
export const REST_GUARDS: WriteGuards = {
  enforceOverlap: true,
  enforceConcurrency: true,
  enforceSameTypeOverlap: true
};

/** A4-1 웹 — overlap·concurrency guard 미적용(기존 유지) + same-type 검증만 on (S5 · 규칙 다 동일). */
export const WEB_GUARDS: WriteGuards = {
  enforceOverlap: false,
  enforceConcurrency: false,
  enforceSameTypeOverlap: true
};
