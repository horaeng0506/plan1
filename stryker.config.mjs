/**
 * Stryker JS Mutation Testing config — plan1
 *
 * 근거:
 * - wiki/shared/test-case-design-principles.md § 6 Coverage Goal · § 10.3 Stryker
 * - wiki/projects/plan1/risk-matrix.md § 6 분기별 임계값 (분기 1 break 50% · 점진 ↑)
 *
 * 적용 영역 (분기 1 · 2026 Q2):
 * - Critical/High RPN 액션의 도메인 함수만 — cascade · split · validate · ownership · idempotency
 * - 분기 2 (Q3): Tier 1 단위 전체 (break 60%)
 * - 분기 3 (Q4): + Tier 2 통합 일부 (break 70%)
 * - 분기 4 (2027 Q1): break 80% 정착
 *
 * 실행:
 *   npx stryker run                  # 전체 mutation
 *   npx stryker run --files lib/...  # 특정 영역만
 *   monthly schedule full run        # 일 단위는 비용 ↑
 *
 * 임계값 동작:
 *   - break: CI 차단 (PR merge 못 함)
 *   - low:   경고 (Discord webhook)
 *   - high:  excellent (분기 ↑ 신호)
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  mutate: [
    'lib/domain/**/*.ts',
    '!lib/domain/**/*.test.ts',
    '!lib/domain/**/*.pbt.test.ts',
    '!lib/domain/types.ts',
  ],
  ignorePatterns: ['node_modules', '.next', 'tests/qa-gate', 'reports'],
  thresholds: {
    high: 70,
    low: 60,
    break: 50,
  },
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  timeoutMS: 60_000,
  concurrency: 4,
  // PBT 가 1000회 run 시 timeout 증가 가능 — 통합 후 측정해서 조정
  // disableTypeChecks 는 mutation 자체 type 변형 검사 X (Stryker 표준 default)
}
