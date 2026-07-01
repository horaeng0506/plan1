/**
 * A4-1 characterization / 회귀 가드 — ApiError → ServerActionError 어댑터 + write guard 상수.
 *
 * 목적:
 *   ① 코어 ApiError(code) 가 웹 i18n errorKey 로 정확히 변환되는지 (정상 에러가 error.unknown
 *      으로 뭉개지지 않음 — critic Critical).
 *   ② A4-1 동작 불변: overlap_exceeded·concurrency_conflict·category_name_exists 는 웹에서
 *      error.unknown 으로 보존 (전환 전 웹 동작과 동일).
 *   ③ category_has_schedules 의 params(scheduleCount) 보존.
 *   ④ WEB_GUARDS off / REST_GUARDS on (웹 동작 불변 · REST 기존 동작 보존).
 */
import {describe, it, expect} from 'vitest';
import {ApiError} from '@/lib/server/api-error';
import {rethrowAsServerActionError, callCore} from '@/lib/server/action-error-adapter';
import {isServerActionError, type ServerActionError} from '@/lib/server-action';
import {WEB_GUARDS, REST_GUARDS} from '@/lib/server/schedule-guards';

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected throw but none happened');
}

describe('action-error-adapter — ApiError → ServerActionError', () => {
  it('schedule_not_found → serverError.scheduleNotFound', () => {
    const e = caught(() => rethrowAsServerActionError(new ApiError('schedule_not_found', 404)));
    expect(isServerActionError(e)).toBe(true);
    expect((e as ServerActionError).errorKey).toBe('serverError.scheduleNotFound');
  });

  it('category_not_found → serverError.categoryNotFound', () => {
    const e = caught(() => rethrowAsServerActionError(new ApiError('category_not_found', 404)));
    expect((e as ServerActionError).errorKey).toBe('serverError.categoryNotFound');
  });

  it('insert_between_stale / no_prev → 각 i18n 키', () => {
    const stale = caught(() => rethrowAsServerActionError(new ApiError('insert_between_stale', 409)));
    expect((stale as ServerActionError).errorKey).toBe('serverError.insertBetweenStale');
    const noPrev = caught(() => rethrowAsServerActionError(new ApiError('insert_between_no_prev', 422)));
    expect((noPrev as ServerActionError).errorKey).toBe('serverError.insertBetweenNoPrev');
  });

  it('category_has_schedules → params(scheduleCount) 보존', () => {
    const e = caught(() =>
      rethrowAsServerActionError(new ApiError('category_has_schedules', 409, 'msg', {scheduleCount: 3}))
    );
    expect((e as ServerActionError).errorKey).toBe('serverError.categoryHasSchedules');
    expect((e as ServerActionError).params).toEqual({scheduleCount: 3});
  });

  // A4-1 동작 불변 — 웹에서 발생 안 함(guard off) 또는 기존 generic 보존.
  it.each(['overlap_exceeded', 'concurrency_conflict', 'category_name_exists'])(
    '%s → error.unknown (A4-1 동작 불변)',
    code => {
      const e = caught(() => rethrowAsServerActionError(new ApiError(code, 409)));
      expect((e as ServerActionError).errorKey).toBe('error.unknown');
    }
  );

  it('매핑 없는 code → error.unknown (안전 fallback)', () => {
    const e = caught(() => rethrowAsServerActionError(new ApiError('totally_unknown', 500)));
    expect((e as ServerActionError).errorKey).toBe('error.unknown');
  });

  it('non-ApiError 는 원본 그대로 re-throw (runAction catch-all 로)', () => {
    const orig = new Error('boom');
    const e = caught(() => rethrowAsServerActionError(orig));
    expect(e).toBe(orig);
    expect(isServerActionError(e)).toBe(false);
  });
});

describe('callCore', () => {
  it('성공 시 결과 반환', async () => {
    await expect(callCore(async () => 42)).resolves.toBe(42);
  });

  it('ApiError 면 ServerActionError 로 변환해 throw', async () => {
    let thrown: unknown;
    try {
      await callCore(async () => {
        throw new ApiError('schedule_not_found', 404);
      });
    } catch (e) {
      thrown = e;
    }
    expect(isServerActionError(thrown)).toBe(true);
    expect((thrown as ServerActionError).errorKey).toBe('serverError.scheduleNotFound');
  });
});

describe('A4 write guards (동작 분기 고정)', () => {
  it('WEB_GUARDS — overlap·concurrency off · same-type on (S5 규칙 다 동일)', () => {
    expect(WEB_GUARDS).toEqual({
      enforceOverlap: false,
      enforceConcurrency: false,
      enforceSameTypeOverlap: true
    });
  });

  it('REST_GUARDS — 셋 다 on (REST 기존 동작 보존 + same-type)', () => {
    expect(REST_GUARDS).toEqual({
      enforceOverlap: true,
      enforceConcurrency: true,
      enforceSameTypeOverlap: true
    });
  });
});
