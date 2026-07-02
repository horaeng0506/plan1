import {readFileSync} from 'node:fs';
import {describe, it, expect} from 'vitest';

/**
 * ⚡ 권한 상승 차단 회귀 가드 (env-critic Major · 2026-07-02).
 *
 * api-keys 관리 엔드포인트는 **세션 JWT 전용**이어야 한다. dual-auth
 * (authenticateSessionOrApiKey)를 여기 적용하면 api-key 로 새 키를 발급/폐기할 수 있어
 * 권한 상승/무한 키 farming 이 된다. schedules 의 dual-auth 패턴이 실수로 복붙되는 것을
 * 정적으로 차단한다 (권한 상승 차단은 "verifySessionJwt 가 api-key 문자열을 거부한다"는
 * 암묵 동작에 의존하므로, 이 소스 레벨 가드가 그 불변식을 명시적으로 지킨다).
 */
describe('api-keys 엔드포인트 세션 전용 불변식', () => {
  const files = ['app/api/v1/api-keys/route.ts', 'app/api/v1/api-keys/[id]/route.ts'];
  for (const f of files) {
    it(`${f} 는 dual-auth 를 import 하지 않고 authenticateSession 만 쓴다`, () => {
      const src = readFileSync(f, 'utf8');
      // dual-auth 모듈 import 금지 + dispatch 호출 금지(설명 주석의 심볼 언급은 허용 —
      //   import path / 호출 `(` 패턴만 검사). 세션 인증 호출은 존재해야 함.
      expect(src).not.toContain('api-dual-auth');
      expect(src).not.toMatch(/authenticateSessionOrApiKey\s*\(/);
      expect(src).toMatch(/authenticateSession\s*\(/);
    });
  }
});
