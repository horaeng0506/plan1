/**
 * server action wrapper (Stage 5.1 part 2 — discriminated union return).
 *
 * 배경: Next.js 14 production build 는 server action 의 throw `Error.message` 를 redact:
 * "An error occurred in the Server Components render. The specific message is
 *  omitted in production builds to avoid leaking sensitive details."
 * 따라서 message string prefix 패턴은 prod 에서 작동 안 함.
 *
 * 공식 권장 (https://nextjs.org/docs/app/getting-started/error-handling):
 * "For these errors, avoid using try/catch blocks and throw errors. Instead,
 *  model expected errors as return values."
 *
 * Next.js 14 'use server' 모듈은 **`export async function` 형태만** server action
 * 으로 인식 (https://github.com/vercel/next.js/blob/v14.3.0-canary.87/errors/invalid-use-server-value.mdx):
 * "Only async functions are permitted as they are intended to be invoked as
 *  Server Actions from the client."
 * → HOF 로 wrap 한 `export const` 는 invalid-use-server-value 위험. 따라서
 *   server actions 는 일반 `export async function ...(): Promise<ServerActionResult<T>>` 로
 *   선언하고 body 에서 `runAction(async () => {...})` 호출하는 패턴 채택.
 *
 * 패턴:
 *   1. server action body 에서 `throw new ServerActionError(key, params)` (사용자 facing)
 *   2. `runAction(fn)` 이 try/catch — `ServerActionError` 면 ok:false, 다른 Error 도
 *      `error.unknown` 으로 일관 변환 + server-side console.error 로깅 보존
 *   3. store layer 가 `unwrapServerActionResult(result)` 로 client-side throw 로 변환
 *      (Next.js redact 는 server→client RSC payload 만 적용. client-side throw 는 message 보존)
 *   4. useRunMutation 가 `isServerActionError(err)` brand 검사 후 `t(key, params)` 매핑
 */

import {logServerError} from './log';

// next-intl ICU formatter 호환 (string · number 만 round-trip 후 보존)
export type ServerActionParams = Record<string, string | number>;

export type ServerActionResult<T> =
  | {ok: true; data: T}
  | {ok: false; errorKey: string; params: ServerActionParams};

// Symbol.for 글로벌 brand — cross-module instance 충돌(웹팩 chunk split 등) 회피.
// instanceof 대신 isServerActionError() 사용.
const SERVER_ACTION_ERROR_BRAND = Symbol.for('plan1.ServerActionError');

/**
 * server action 안에서 throw. runAction 이 잡아 ok:false return.
 * 다른 Error 도 같은 wrapper 가 'error.unknown' 으로 변환 (catch-all 일관성).
 */
export class ServerActionError extends Error {
  readonly errorKey: string;
  readonly params: ServerActionParams;

  constructor(errorKey: string, params: ServerActionParams = {}) {
    super(`[ServerActionError] ${errorKey}`);
    this.name = 'ServerActionError';
    this.errorKey = errorKey;
    this.params = params;
    // Symbol brand — esbuild/swc transpile · cross-module 환경에서 class field
    // 보다 안전하게 per-instance 명시. logic-critic v2 Critical #2 보강.
    Object.defineProperty(this, SERVER_ACTION_ERROR_BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false
    });
  }
}

export function isServerActionError(err: unknown): err is ServerActionError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as Record<symbol, unknown>)[SERVER_ACTION_ERROR_BRAND] === true
  );
}

/**
 * server action body 에서 호출. 내부 함수의 throw 를 잡아 discriminated union return.
 *
 * 사용:
 *   export async function createCategory(input: ...): Promise<ServerActionResult<Category>> {
 *     return runAction(async () => {
 *       const user = await requireUser();
 *       // ... mutation
 *       return row;  // ok: true 자동
 *     });
 *   }
 *
 * Next.js 'use server' 정합성: export 는 항상 `async function` 형태 유지.
 *
 * catch-all 정책: ServerActionError 는 errorKey 매핑, 다른 모든 Error 는 'error.unknown'
 * 으로 일관 변환 + server-side `console.error(err)` 로깅 보존 (sentry 같은 외부 logger
 * 없이도 Vercel function logs 에 남음).
 */
export async function runAction<T>(
  fn: () => Promise<T>
): Promise<ServerActionResult<T>> {
  try {
    const data = await fn();
    return {ok: true, data};
  } catch (err) {
    if (isServerActionError(err)) {
      return {ok: false, errorKey: err.errorKey, params: err.params};
    }
    // unexpected error — log server-side, return generic 'error.unknown'.
    // 사용자 UX 일관성 우선 (Next.js redact 영문 generic 노출 회피).
    logServerError('[ServerAction] unexpected error:', err);
    return {ok: false, errorKey: 'error.unknown', params: {}};
  }
}

/**
 * store layer 에서 사용. ok:true 면 data 반환, ok:false 면 client-side throw.
 * client-side throw 는 Next.js redact 영향 X — message·brand·params 보존.
 */
export function unwrapServerActionResult<T>(result: ServerActionResult<T>): T {
  if (result.ok) return result.data;
  throw new ServerActionError(result.errorKey, result.params);
}
