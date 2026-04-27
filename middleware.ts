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
  // security-auditor MEDIUM: Vercel platform 이 주입하는 request.ip 우선 (트러스티드 source).
  // x-forwarded-for·cf-connecting-ip 같은 사용자 위조 가능 헤더는 fallback 만.
  if (request.ip) return request.ip;
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
  // security-auditor MEDIUM: server action POST 도 rate limit. Next.js 14 는 server
  // action 호출을 `Next-Action` header 가진 POST 로 보냄 (페이지 경로에 직접 POST).
  // /api/** 만 보호하면 server action 무한 호출 가능 (JWT 검증 + DB write 부담).
  const isServerActionPost =
    request.method === 'POST' && request.headers.get('next-action') !== null;
  const isApiPost = pathname.startsWith('/api/') && request.method === 'POST';
  if (isApiPost || isServerActionPost) {
    if (rateLimited(request)) {
      return new NextResponse('rate_limited', {status: 429});
    }
    if (isApiPost) return NextResponse.next();
    // server action POST 는 next-intl 라우팅 통과 필요 없음 (이미 locale prefixed
    // path 로 들어오면 server action handler 가 처리)
    return NextResponse.next();
  }
  return intlMiddleware(request);
}

export const config = {
  matcher: ['/((?!_next|_vercel|.*\\..*).*)']
};
