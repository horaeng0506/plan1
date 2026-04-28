import {NextRequest, NextResponse} from 'next/server';
import {ipAddress} from '@vercel/functions';
import createIntlMiddleware from 'next-intl/middleware';
import {routing} from './i18n/routing';

// 병합 proxy (Stage 1 · 2026-04-27 / Stage 8.C 리네임 · 2026-04-28):
//   - /api/** 로 시작하는 POST: in-memory rate limit (LIMIT=20/min · plan1 은 schedule CRUD 위주라 copymaker1 의 LLM 호출보다 한도 ↑)
//   - 그 외 페이지 경로: next-intl locale detect (쿠키 NEXT_LOCALE 기반, portal 와 동일 origin 쿠키 공유)
//
// Next.js 16 부터 file convention `middleware.ts` → `proxy.ts` 리네임 (nodejs runtime 고정 · edge 미지원).
// copymaker1/middleware.ts 패턴 복제 + plan1-specific LIMIT 조정.

const intlProxy = createIntlMiddleware(routing);

const LIMIT = 20;
const WINDOW_MS = 60_000;
const store = new Map<string, {count: number; resetAt: number}>();

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

export function proxy(request: NextRequest) {
  const {pathname} = request.nextUrl;
  // /api/** 경로: next-intl 우회 + POST 만 rate limit. GET 은 그대로 통과.
  // Stage 8 follow-up (2026-04-28): GET /api/health 가 intlProxy 통과 시 _not-found
  // 매칭 → 404. localePrefix:'never' 라도 next-intl middleware 가 GET 라우팅에 개입.
  // /api/** 는 명시적으로 next-intl 우회.
  if (pathname.startsWith('/api/')) {
    if (request.method === 'POST' && rateLimited(request)) {
      return new NextResponse('rate_limited', {status: 429});
    }
    return NextResponse.next();
  }
  // security-auditor MEDIUM: server action POST 도 rate limit. Next.js 14+ 는 server
  // action 호출을 `Next-Action` header 가진 POST 로 보냄 (페이지 경로에 직접 POST).
  const isServerActionPost =
    request.method === 'POST' && request.headers.get('next-action') !== null;
  if (isServerActionPost) {
    if (rateLimited(request)) {
      return new NextResponse('rate_limited', {status: 429});
    }
    // server action POST 는 next-intl 라우팅 통과 필요 없음 (이미 locale prefixed
    // path 로 들어오면 server action handler 가 처리)
    return NextResponse.next();
  }
  return intlProxy(request);
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)']
};
