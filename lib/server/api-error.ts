/**
 * plan1-mobile A1 — REST API 공용 도메인 에러.
 * 핸들러가 code·status 로 매핑하는 단일 에러 타입. ScheduleError·category/settings 코어가 공유.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** 사용자 facing 메시지에 끼울 구조화 파라미터 (예: category_has_schedules 의 scheduleCount).
   *  A4 웹 전환 시 ServerActionError 의 i18n params 로 보존된다. */
  readonly params?: Record<string, string | number>;
  constructor(
    code: string,
    status: number,
    message?: string,
    params?: Record<string, string | number>
  ) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

/** Postgres unique_violation (예: 카테고리 이름 중복). */
export function isUniqueViolation(err: unknown): boolean {
  if (err == null) return false;
  if ((err as {code?: unknown}).code === '23505') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key value|unique constraint/i.test(msg);
}
