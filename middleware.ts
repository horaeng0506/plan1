import {NextRequest, NextResponse} from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import {routing} from './i18n/routing';

// 병합 middleware (Stage 1 · 2026-04-27):
//   - /api/** 로 시작하는 POST: in-memory rate limit (LIMIT=20/min · plan1 은 schedule CRUD 위주라 copymaker1 의 LLM 호출보다 한도 ↑)
//   - 그 외 페이지 경로: next-intl locale detect (쿠키 NEXT_LOCALE 기반, portal 와 동일 origin 쿠키 공유)
//
// copymaker1/middleware.ts 패턴 복제 + plan1-specific LIMIT 조정.

const intlMiddleware = createIntlMiddleware(routing);

const LIMIT = 20;
const WINDOW_MS = 60_000;
const store = new Map<string, {count: number; resetAt: number}>();

function getClientKey(request: NextRequest): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
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

export function middleware(request: NextRequest) {
  const {pathname} = request.nextUrl;
  if (pathname.startsWith('/api/') && request.method === 'POST') {
    if (rateLimited(request)) {
      return new NextResponse('rate_limited', {status: 429});
    }
    return NextResponse.next();
  }
  return intlMiddleware(request);
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)']
};
