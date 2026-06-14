/**
 * plan1-mobile A1 — REST API 공용 도메인 에러.
 * 핸들러가 code·status 로 매핑하는 단일 에러 타입. ScheduleError·category/settings 코어가 공유.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** Postgres unique_violation (예: 카테고리 이름 중복). */
export function isUniqueViolation(err: unknown): boolean {
  if (err == null) return false;
  if ((err as {code?: unknown}).code === '23505') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key value|unique constraint/i.test(msg);
}
