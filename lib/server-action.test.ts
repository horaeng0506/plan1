/**
 * runAction wrapper · ServerActionError brand · unwrap 단위 test (Stage 8.G follow-up · 2026-04-28).
 *
 * 검증:
 * 1. runAction happy path → {ok:true, data}
 * 2. ServerActionError throw → {ok:false, errorKey, params} (브랜드 매칭)
 * 3. 일반 Error throw → {ok:false, errorKey:'error.unknown', params:{}} (catch-all)
 * 4. cross-module brand: 다른 module 의 import 와 동일 Symbol.for 매칭
 * 5. unwrapServerActionResult: ok→data, fail→client-side throw
 *
 * note: logServerError 가 console 출력하므로 vitest spy 로 silent 처리.
 */

import {describe, expect, it, vi, beforeEach} from 'vitest';
import {
  ServerActionError,
  isServerActionError,
  runAction,
  unwrapServerActionResult
} from './server-action';

describe('ServerActionError brand', () => {
  it('isServerActionError 가 ServerActionError 인스턴스를 매칭한다', () => {
    const err = new ServerActionError('error.test', {key: 'value'});
    expect(isServerActionError(err)).toBe(true);
  });

  it('isServerActionError 가 일반 Error 를 거부한다', () => {
    expect(isServerActionError(new Error('plain'))).toBe(false);
    expect(isServerActionError(new TypeError('type'))).toBe(false);
  });

  it('isServerActionError 가 null/undefined/primitive 를 거부한다', () => {
    expect(isServerActionError(null)).toBe(false);
    expect(isServerActionError(undefined)).toBe(false);
    expect(isServerActionError('string')).toBe(false);
    expect(isServerActionError(42)).toBe(false);
    expect(isServerActionError({})).toBe(false);
  });

  it('Symbol.for("plan1.ServerActionError") 동일 brand 를 cross-module 매칭한다', () => {
    // 별도 module 에서 같은 Symbol.for() 를 사용해 만든 obj 시뮬레이션
    const fakeBrand = Symbol.for('plan1.ServerActionError');
    const fake: object = {[fakeBrand]: true};
    expect(isServerActionError(fake)).toBe(true);
  });
});

describe('runAction wrapper', () => {
  beforeEach(() => {
    // server-action.ts 가 import 한 logServerError 의 console.error 를 silent 화
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('happy path → {ok:true, data}', async () => {
    const result = await runAction(async () => 'hello');
    expect(result).toEqual({ok: true, data: 'hello'});
  });

  it('ServerActionError throw → {ok:false, errorKey, params}', async () => {
    const result = await runAction(async () => {
      throw new ServerActionError('error.somethingFailed', {item: 'foo', count: 3});
    });
    expect(result).toEqual({
      ok: false,
      errorKey: 'error.somethingFailed',
      params: {item: 'foo', count: 3}
    });
  });

  it('일반 Error throw → catch-all error.unknown', async () => {
    const result = await runAction(async () => {
      throw new Error('database boom');
    });
    expect(result).toEqual({ok: false, errorKey: 'error.unknown', params: {}});
  });

  it('TypeError 같은 다른 Error subclass 도 catch-all', async () => {
    const result = await runAction(async () => {
      throw new TypeError('bad type');
    });
    expect(result).toEqual({ok: false, errorKey: 'error.unknown', params: {}});
  });

  it('non-Error throw (string) 도 catch-all', async () => {
    const result = await runAction(async () => {
      throw 'string error';
    });
    expect(result).toEqual({ok: false, errorKey: 'error.unknown', params: {}});
  });

  it('errorKey 만 있고 params 미지정 시 빈 객체로 정규화', async () => {
    const result = await runAction(async () => {
      throw new ServerActionError('error.empty');
    });
    expect(result).toEqual({ok: false, errorKey: 'error.empty', params: {}});
  });
});

describe('unwrapServerActionResult', () => {
  it('ok:true → data 반환', () => {
    expect(unwrapServerActionResult({ok: true, data: 42})).toBe(42);
  });

  it('ok:false → ServerActionError throw (brand 보존)', () => {
    const result = {
      ok: false as const,
      errorKey: 'error.test',
      params: {x: 'y'}
    };
    try {
      unwrapServerActionResult(result);
      expect.fail('throw expected');
    } catch (err) {
      expect(isServerActionError(err)).toBe(true);
      if (isServerActionError(err)) {
        expect(err.errorKey).toBe('error.test');
        expect(err.params).toEqual({x: 'y'});
      }
    }
  });
});
