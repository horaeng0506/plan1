import {NextRequest, NextResponse} from 'next/server';
import {ipAddress} from '@vercel/functions';
import createIntlMiddleware from 'next-intl/middleware';
import {routing} from './i18n/routing';

// 병합 proxy (Stage 1 · 2026-04-27 / Stage 8.C 리네임 · 2026-04-28 / PLAN1-AUTH-FLAKE-EXEC · 2026-05-04):
//   - /api/** 로 시작하는 POST: in-memory rate limit (LIMIT=20/min · plan1 은 schedule CRUD 위주라 copymaker1 의 LLM 호출보다 한도 ↑)
//   - server action POST: rate limit 후 통과 (auth 는 requireUser 에서)
//   - 그 외 GET 페이지: cofounder_jwt cookie 부재 시 portal refresh-jwt 로 self-heal redirect (race condition fix)
//   - 그 후 next-intl locale detect (쿠키 NEXT_LOCALE 기반, portal 와 동일 origin 쿠키 공유)
//
// Next.js 16 file convention: middleware.ts (nodejs runtime 고정 · edge 미지원).
// PLAN1-AUTH-FLAKE-VERIFY (2026-05-04): proxy.ts → middleware.ts 환원. proxy.ts file convention 의
// preview build 작동성 의심 (cookie 부재 redirect 미발동) → middleware.ts 정공 사용.

const intlProxy = createIntlMiddleware(routing);

const LIMIT = 20;
const WINDOW_MS = 60_000;
const store = new Map<string, {count: number; resetAt: number}>();

// PLAN1-AUTH-FLAKE-EXEC (2026-05-04): portal refresh-jwt URL.
// env override 가능 (preview/staging 분리). default = production cofounder.co.kr.
const PORTAL_REFRESH_JWT_URL =
  process.env.PORTAL_REFRESH_JWT_URL ?? 'https://cofounder.co.kr/project/api/cofounder/refresh-jwt';

function getClientKey(request: NextRequest): string {
  // ship-gate security High (2026-04-28 · Stage 8.G):
  // cofounder-router 가 신뢰 source (cf-connecting-ip) 를 x-real-ip 로 전파.
  // router 거친 트래픽은 모두 동일한 Worker egress IP 라 Vercel ipAddress() 만 보면 단일 key
  // 에 합산 → DoS. 실 클라이언트 IP 가 router 신뢰 헤더로 들어오면 우선 사용.
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  // router 미경유 직접 접근 (개발·dev URL): Vercel platform IP fallback
  const ip = ipAddress(request);
  if (ip) return ip;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'anonymous';
}

let sweepCounter = 0;
function sweep(now: number): void {
  Array.from(store.entries()).forEach(([k, v]) => {
    if (v.resetAt < now) store.delete(k);
  });
}

function rateLimited(request: NextRequest): boolean {
  const now = Date.now();
  if (++sweepCounter % 100 === 0) sweep(now);
  const key = getClientKey(request);
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    store.set(key, {count: 1, resetAt: now + WINDOW_MS});
    return false;
  }
  if (entry.count >= LIMIT) return true;
  entry.count += 1;
  return false;
}

// PLAN1-AUTH-FLAKE-EXEC (2026-05-04): public URL 재구성.
// router (cofounder-router/src/index.js:143-144) 가 x-forwarded-host / x-forwarded-proto 를 set.
// request.nextUrl.host 는 Vercel internal host 라 그대로 return 에 넣으면 portal 이 화이트리스트
// 검증에서 reject (cofounder.co.kr 아님). 사용자 실제 요청 URL 재구성 후 return param 사용.
function getPublicRequestUrl(request: NextRequest): string {
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`;
}

// PLAN1-AUTH-FLAKE-EXEC (2026-05-04): cofounder_jwt cookie 부재 시 self-heal redirect.
//
// 흐름:
//   1. plan1 GET 페이지 요청 (e.g. /project/plan1/dashboard)
//   2. cofounder_jwt cookie 부재 검사
//   3. 부재면 portal /api/cofounder/refresh-jwt?return=<원래 URL> 로 302 redirect
//   4. portal 이 Better Auth session 검증 → 통과면 cookie set + 302 back to return
//                                          → 미통과면 302 to /project/sign-in?return=...
//   5. 사용자 plan1 재진입 시 cookie 존재 → 정상 동작
//
// 무한 루프 가드:
//   - referer 헤더가 portal refresh-jwt 면 redirect 안 함 (portal 발급 실패한 직후 케이스)
//   - 그 경우 plan1 page 그대로 렌더 → server action / route handler 가 unauthorized 처리
//
// 적용 범위:
//   - GET 페이지 (HTML) 만 대상. /api/** · POST · server action 은 unaffected (UI 가 401 graceful 처리)
//   - 첫 entry-point 만 redirect 발생. cookie 발급 후 navigation 은 자연스럽게 통과.
function authRedirectIfMissingJwt(request: NextRequest): NextResponse | null {
  if (request.method !== 'GET') return null;
  const {pathname} = request.nextUrl;
  if (pathname.startsWith('/api/')) return null;

  const jwt = request.cookies.get('cofounder_jwt');
  if (jwt) return null;

  // 무한 루프 가드: portal refresh-jwt 에서 redirect 받아 돌아온 직후면 더 이상 redirect 안 함.
  // 이 경우 portal session 도 없거나 cookie 발급 실패 — plan1 그대로 렌더하면 server action 단계에서
  // ServerActionError('serverError.unauthorized') throw → 클라이언트가 sign-in CTA UI 표시.
  const referer = request.headers.get('referer') ?? '';
  const fromPortalRefresh = referer.includes('/project/api/cofounder/refresh-jwt');
  if (fromPortalRefresh) return null;

  const refreshUrl = new URL(PORTAL_REFRESH_JWT_URL);
  refreshUrl.searchParams.set('return', getPublicRequestUrl(request));
  return NextResponse.redirect(refreshUrl, {status: 302});
}

export function middleware(request: NextRequest) {
  const {pathname} = request.nextUrl;
  // PLAN1-AUTH-FLAKE-VERIFY 디버그 (2026-05-04): middleware fire 확인용.
  // 검증 후 제거 예정.
  const debugHeaders = new Headers();
  debugHeaders.set('x-mw-fired', '1');
  debugHeaders.set('x-mw-pathname', pathname);
  debugHeaders.set(
    'x-mw-cookie-jwt',
    request.cookies.get('cofounder_jwt') ? 'present' : 'missing'
  );
  debugHeaders.set('x-mw-method', request.method);
  // /api/** 경로: next-intl 우회 + POST 만 rate limit. GET 은 그대로 통과.
  // Stage 8 follow-up (2026-04-28): GET /api/health 가 intlProxy 통과 시 _not-found
  // 매칭 → 404. localePrefix:'never' 라도 next-intl middleware 가 GET 라우팅에 개입.
  // /api/** 는 명시적으로 next-intl 우회.
  if (pathname.startsWith('/api/')) {
    if (request.method === 'POST' && rateLimited(request)) {
      const r = new NextResponse('rate_limited', {status: 429});
      debugHeaders.forEach((v, k) => r.headers.set(k, v));
      return r;
    }
    const r = NextResponse.next();
    debugHeaders.forEach((v, k) => r.headers.set(k, v));
    return r;
  }
  // security-auditor MEDIUM: server action POST 도 rate limit. Next.js 14+ 는 server
  // action 호출을 `Next-Action` header 가진 POST 로 보냄 (페이지 경로에 직접 POST).
  const isServerActionPost =
    request.method === 'POST' && request.headers.get('next-action') !== null;
  if (isServerActionPost) {
    if (rateLimited(request)) {
      const r = new NextResponse('rate_limited', {status: 429});
      debugHeaders.forEach((v, k) => r.headers.set(k, v));
      return r;
    }
    // server action POST 는 next-intl 라우팅 통과 필요 없음 (이미 locale prefixed
    // path 로 들어오면 server action handler 가 처리). 인증은 requireUser 가 처리.
    const r = NextResponse.next();
    debugHeaders.forEach((v, k) => r.headers.set(k, v));
    return r;
  }

  // PLAN1-AUTH-FLAKE-EXEC (2026-05-04): GET 페이지 인증 self-heal.
  const authRedirect = authRedirectIfMissingJwt(request);
  if (authRedirect) {
    debugHeaders.forEach((v, k) => authRedirect.headers.set(k, v));
    return authRedirect;
  }

  const intlResponse = intlProxy(request);
  debugHeaders.forEach((v, k) => intlResponse.headers.set(k, v));
  return intlResponse;
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)']
};
