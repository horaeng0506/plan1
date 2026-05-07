'use client';

/**
 * plan1 의 cofounder_jwt cookie 자동 갱신 client component (PLAN1-JWT-REFRESHER-20260508).
 *
 * 배경 (Stage F0 진단 · 2026-05-08):
 *   - `__Secure-better-auth.session_token` TTL = 7일 (Better Auth)
 *   - `cofounder_jwt` TTL = 1시간 (refresh-jwt)
 *   - portal `JwtCookieRefresher` 가 portal home (`/project`) 만 mount
 *   - sub-project 진입 시 cookie 자동 갱신 trigger 부재 → 1h 후 만료 → middleware self-heal redirect chain
 *   - 사용자 영역 깜빡임 (결함 A "잠깐 보임 → 다시 로그인 필요") + 지속시간 짧음 (결함 B)
 *
 * 동작:
 *   - plan1 layout mount 시 1회 fetch portal /api/cofounder/refresh-jwt (절대 URL)
 *   - 401 (no_session) silent — 미인증 사용자는 정상
 *   - 200 응답이면 Set-Cookie 헤더가 cofounder_jwt 자동 등록 (Better Auth session 살아있는 경우)
 *
 * portal cookie-cutter:
 *   - portal/components/JwtCookieRefresher.tsx 동일 패턴 (relative path 만 절대 URL 으로 변경)
 *   - sub-project 는 portal API 절대 URL 사용 의무 (router proxy chain · same root domain · cookie 동반 OK)
 *
 * 정직성 규칙 정합:
 *   - 본 fix 가 결함 B (TTL mismatch) 직접 해결
 *   - 결함 A (Google OAuth chain 깜빡임) 는 재현 안 됨 영역 — fix 후 사용자 검증 의무
 *
 * 근거:
 *   - portal/components/JwtCookieRefresher.tsx (cookie-cutter source)
 *   - wiki/shared/problem-resolution-log.md [2026-05-07] § F5 잔여 결함
 *   - tech-researcher § C.1 NextAuth useSession refetch 패턴 + § C.2 Clerk satellite 자동 sync
 */

import {useEffect, useRef} from 'react';

const PORTAL_ORIGIN =
  process.env.NEXT_PUBLIC_PORTAL_ORIGIN ?? 'https://cofounder.co.kr';

type RefreshResponse =
  | {ok: true; expiresInSeconds: number; user: {id: string; email: string}}
  | {ok: false; reason: string};

export function JwtCookieRefresher() {
  // React 18 StrictMode dev double-invoke 회피
  const triggered = useRef(false);

  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;

    // 절대 URL 의무 — sub-project 의 relative path `/api/...` 는 plan1 own API path 영역
    // portal API 호출하려면 PORTAL_ORIGIN 절대 URL 박음 (router proxy chain · cookie 동반)
    fetch(`${PORTAL_ORIGIN}/project/api/cofounder/refresh-jwt`, {
      method: 'GET',
      credentials: 'include'
    })
      .then(async res => {
        // 401 (no_session) 는 미인증 사용자 — middleware self-heal redirect 가 portal 으로 보냄
        if (res.status === 401) return null;
        if (!res.ok) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[plan1 jwt-refresh] non-ok response', res.status);
          }
          return null;
        }
        const json: RefreshResponse = await res.json();
        return json;
      })
      .catch(err => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[plan1 jwt-refresh] fetch error', err);
        }
      });
  }, []);

  return null;
}
