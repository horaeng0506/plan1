'use client';

/**
 * plan1 의 cofounder_jwt cookie 자동 갱신 client component.
 *
 * 배경 (PLAN1-JWT-REFRESHER-INTERVAL-20260508):
 *   - `__Secure-better-auth.session_token` TTL = 7일 (Better Auth default · sliding refresh updateAge=1d)
 *   - `cofounder_jwt` TTL = 1시간 (refresh-jwt route.ts COOKIE_MAX_AGE_SECONDS)
 *   - 사이클 6 (PR #72) 의 mount 1회 호출은 사용자가 plan1 페이지 머문 채 1시간 지나면 재호출 trigger 부재
 *   - 결과: cookie 자동 삭제 → server action requireUser() unauthorized → "로그인이 필요합니다" 표시
 *
 * 본 fix (interval + visibility + mutex + abort 조합 · critic Critical 3건 처방):
 *   - mount 1회 호출 + 30분 interval (1h TTL 의 50% 마진 — 백그라운드 throttle 영역 catch)
 *   - `visibilitychange` event listener — 탭 복귀·sleep wake 시 즉시 갱신 (NextAuth refetchOnWindowFocus 패턴)
 *   - mutex (inFlightRef) + throttle (30s) — visibility + interval race condition 차단
 *   - AbortController — unmount 시 in-flight fetch cancel + StrictMode dev double-invoke 자연 처리
 *   - 401 처리 — sessionExpired flag + polling 중단 (Better Auth session 만료 catch)
 *
 * 절대 URL 의무:
 *   - sub-project 의 relative path `/api/...` 는 plan1 own API path 영역
 *   - portal API 호출하려면 PORTAL_ORIGIN 절대 URL 박음 (router proxy chain · cookie 동반 OK)
 *
 * portal cookie-cutter:
 *   - portal/components/JwtCookieRefresher.tsx 동일 패턴 (relative path 만 절대 URL 으로 변경)
 *
 * drift risk (4 곳 동기화 의무):
 *   - REFRESH_INTERVAL_MS (본 파일 + portal/components/JwtCookieRefresher.tsx)
 *   - COOKIE_MAX_AGE_SECONDS (portal/app/api/cofounder/refresh-jwt/route.ts:29)
 *   - jwt expirationTime (portal/lib/auth.ts:66)
 *   → 후속 task qa-pending § F11: NEXT_PUBLIC env 단일 source of truth 박음
 *
 * 근거:
 *   - critic Critical-1·2·3 처방 (race · drift · cleanup)
 *   - critic Major M-1·M-2 처방 (401 polling 중단 · retry 부재)
 *   - NextAuth useSession refetch (https://next-auth.js.org/getting-started/client) refetchOnWindowFocus 표준
 */

import {useEffect, useRef} from 'react';

const PORTAL_ORIGIN =
  process.env.NEXT_PUBLIC_PORTAL_ORIGIN ?? 'https://cofounder.co.kr';

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30min · cookie TTL 1h 의 50% 마진
const MIN_REFRESH_INTERVAL_MS = 30 * 1000; // 30s throttle (race 차단)

export function JwtCookieRefresher() {
  const inFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const sessionExpiredRef = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let onVisible: (() => void) | null = null;

    const cleanup = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (onVisible !== null) {
        document.removeEventListener('visibilitychange', onVisible);
        onVisible = null;
      }
    };

    const refresh = async () => {
      if (sessionExpiredRef.current) return; // 401 후 polling 차단
      const now = Date.now();
      if (inFlightRef.current) return; // 진행 중 요청 mutex
      if (now - lastRefreshAtRef.current < MIN_REFRESH_INTERVAL_MS) return; // throttle
      inFlightRef.current = true;
      lastRefreshAtRef.current = now;
      try {
        const res = await fetch(
          `${PORTAL_ORIGIN}/project/api/cofounder/refresh-jwt`,
          {
            method: 'GET',
            credentials: 'include',
            signal: ac.signal
          }
        );
        if (res.status === 401) {
          // Better Auth session 만료 — polling 중단 (plan1 middleware self-heal redirect 가 page navigate 시 portal 으로 보냄)
          sessionExpiredRef.current = true;
          cleanup();
          return;
        }
        if (!res.ok) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[plan1 jwt-refresh] non-ok response', res.status);
          }
        }
        // body parse 생략 (set-cookie 헤더만 중요 · 응답 본문 사용처 X)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return; // cleanup 정상
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[plan1 jwt-refresh] fetch error', err);
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    refresh(); // mount 1회

    intervalId = setInterval(refresh, REFRESH_INTERVAL_MS);

    onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      ac.abort();
      cleanup();
    };
  }, []);

  return null;
}
