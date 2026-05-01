import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Vitest config — plan1
 *
 * 근거:
 * - wiki/shared/testing-strategy.md § 4.3 Next.js + Vitest 4.x default
 * - wiki/shared/test-case-design-principles.md § 4 Property-Based Testing (fast-check)
 *
 * 분리:
 * - unit (lib/**\/*.test.ts): default 빠른 단위
 * - pbt (lib/**\/*.pbt.test.ts): fast-check 1000 runs · timeout 늘림
 * - tests/qa-gate/**: Playwright (별도 runner — 본 config 에서 제외)
 *
 * Stryker mutation testing 이 본 config 를 호출하므로 testRunner 분리 의무 X
 * (Stryker 가 자체적으로 mutate 영역 + 해당하는 .test.ts/.pbt.test.ts 매칭).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'lib/**/*.pbt.test.ts'],
    exclude: [
      'node_modules',
      '.next',
      'tests/qa-gate/**',
      'tests/e2e/**',
      'reports/**',
    ],
    // PBT 1000 runs 안전 마진 — fast-check property 가 평균 100ms/run
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // pool: default (forks) — vitest 4 권장
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      exclude: [
        '**/*.test.ts',
        '**/*.pbt.test.ts',
        '**/types.ts',
        'tests/qa-gate/**',
        '.next/**',
      ],
      // line/branch coverage 는 결과 지표 (목표 X) — testing-strategy.md § 7.1
      // 진짜 품질은 Stryker mutation score (test-case-design-principles.md § 6)
    },
  },
})
