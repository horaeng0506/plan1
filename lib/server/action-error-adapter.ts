/**
 * A4 — REST 코어의 ApiError(code) 를 웹 server action 의 ServerActionError(i18n key) 로 변환.
 *
 * 웹 server action 이 schedule-core/category-core 를 호출하면 코어는 `ApiError`(snake_case code)
 * 를 throw 한다. 그런데 `runAction` 의 catch-all 은 `isServerActionError` brand 만 errorKey 로
 * 매핑하고 나머지는 전부 `error.unknown` 으로 redact 한다 → 코어 도메인 에러(일정 없음 등)가
 * 그대로 통과하면 사용자에게 "알 수 없는 오류"로 뭉개진다 (logic/env critic Critical).
 * 이 어댑터가 ApiError 를 i18n ServerActionError 로 바꿔 정상 에러 메시지를 보존한다.
 *
 * A4-1 동작 불변: overlap_exceeded·concurrency_conflict 는 웹이 guard off 라 발생하지 않고,
 *   category_name_exists 는 웹 기존 action 이 미처리(error.unknown) 였으므로 그 동작을 보존한다.
 *   세 code 는 A4-2 에서 전용 i18n 키 + 클라 핸들링을 갖춘 뒤 개선한다.
 */
import {ApiError} from '@/lib/server/api-error';
import {ServerActionError} from '@/lib/server-action';

const API_ERROR_KEY: Record<string, string> = {
  category_not_found: 'serverError.categoryNotFound',
  schedule_not_found: 'serverError.scheduleNotFound',
  insert_between_stale: 'serverError.insertBetweenStale',
  insert_between_no_prev: 'serverError.insertBetweenNoPrev',
  category_has_schedules: 'serverError.categoryHasSchedules',
  // A4-1 동작 불변 — 웹 경로 미발생(guard off) 또는 기존 generic 보존. A4-2 개선 예정.
  overlap_exceeded: 'error.unknown',
  // S5 (PLAN1-SAME-TYPE-OVERLAP-20260701) — 웹도 same-type guard on → 전용 메시지로 안내.
  same_type_overlap: 'serverError.sameTypeOverlap',
  concurrency_conflict: 'error.unknown',
  category_name_exists: 'error.unknown',
  // API 키 관리 코어(api-keys-core) — 웹 기존 server action 의 i18n 키 그대로 보존.
  api_key_name_invalid: 'serverError.apiKeyNameInvalid',
  api_key_expires_invalid: 'serverError.apiKeyExpiresInvalid',
  api_key_create_failed: 'serverError.apiKeyCreateFailed',
  api_key_not_found: 'serverError.apiKeyNotFound',
  api_key_already_revoked: 'serverError.apiKeyAlreadyRevoked',
  api_key_limit_reached: 'serverError.apiKeyLimitReached'
};

/**
 * ApiError 면 i18n ServerActionError 로 변환해 throw. 그 외(non-ApiError)는 그대로 re-throw
 * (runAction 이 error.unknown 으로 처리 + 서버 로깅 보존). never — catch 블록에서 호출.
 */
export function rethrowAsServerActionError(err: unknown): never {
  if (err instanceof ApiError) {
    const key = API_ERROR_KEY[err.code] ?? 'error.unknown';
    throw new ServerActionError(key, err.params ?? {});
  }
  throw err;
}

/** 코어 호출을 try/catch 로 감싸 ApiError → ServerActionError 변환 후 결과 반환. */
export async function callCore<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    rethrowAsServerActionError(err);
  }
}
