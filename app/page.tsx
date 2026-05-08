import {PlanApp} from '@/components/PlanApp';
import {SignInPrompt} from '@/components/SignInPrompt';
import {getCurrentSessionUser} from '@/lib/auth-helpers';

/**
 * plan1 root page — server component 인증 검증 (PLAN1-AUTH-GATE-SSR-20260508).
 *
 * 결함 (영상 catch · 사용자 보고 결함 A):
 *   - 미인증 상태에서 plan1 navigate → PlanApp client component 가 SSR 시점에 schedule UI 렌더
 *   - 그 후 client hydration → store.init() server action → unauthorized → SignInPrompt 분기
 *   - 사용자 영역: schedule UI 1초 보임 → "로그인이 필요합니다" 전환 (깜빡임)
 *
 * 정공 fix (대장 to-be 그림 정합):
 *   - server component 단계에서 cookie 검증 → 미인증 시 SignInPrompt 만 렌더
 *   - PlanApp import 자체 차단 → schedule UI 클라이언트 bundle 도 download X (사용자 영역 즉시 SignInPrompt 만)
 *
 * 정직성 규칙 정합:
 *   - 본 fix 가 결함 A (잠깐 보임) 직접 해결 — store.init() 분기 영역 우회
 *   - PR #72 (JwtCookieRefresher) 와 별 영역 — fix 둘 다 박음
 */
export default async function Home() {
  const user = await getCurrentSessionUser();
  if (!user) {
    // 미인증 → SignInPrompt 만 (PlanApp import 차단 → schedule UI 안 보임)
    return <SignInPrompt />;
  }
  return <PlanApp />;
}
