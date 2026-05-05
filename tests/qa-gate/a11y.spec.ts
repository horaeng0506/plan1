import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * plan1 a11y baseline scan (Phase 1 S1 · 2026-04-30).
 *
 * 목적:
 *   - WCAG 2.1 AA 위반 axe-core 자동 catch (전체 위반의 30~57% 영역)
 *   - i18n 회귀 / 신규 컴포넌트의 a11y 회귀 PR 단계 차단
 *   - 자동화 한계 명시: link text 품질·이미지 위 contrast·reading order·landmark 의미 등은 수동 보완 의무
 *
 * 정책:
 *   - 첫 도입 단계 (S1) — soft mode: 위반을 console.log 출력 + violations.length === 0 assertion 보다 baseline 측정
 *   - 다음 단계 (Phase 2) — strict mode: violations.length === 0 강제 게이트화
 *
 * 근거: wiki/shared/qa-strategy-research-20260430.md § Phase 1.5
 *      David Mello "Playwright Accessibility Testing: What axe and Lighthouse Miss"
 *      https://playwright.dev/docs/accessibility-testing
 */

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.describe('plan1 a11y baseline', () => {
  test('main /project/plan1/ 진입 — WCAG 2.1 AA scan', async ({page}) => {
    await page.goto('/project/plan1/');
    // 메인 컨텐츠 렌더 대기 — schedule list 영역 또는 카테고리 버튼이 보일 때까지
    await expect(page.getByRole('button', {name: /카테고리|Categories|Categorías/i}))
      .toBeVisible({timeout: 10_000});

    const result = await new AxeBuilder({page}).withTags(A11Y_TAGS).analyze();

    // baseline 출력 — Phase 2 에서 이 값을 게이트 한도로 박음
    console.log(
      `[a11y-baseline] page=/project/plan1/ violations=${result.violations.length} ` +
        `incomplete=${result.incomplete.length} passes=${result.passes.length}`
    );

    if (result.violations.length > 0) {
      // 위반 상세 — Phase 2 strict mode 전 review 자료
      for (const v of result.violations) {
        console.log(
          `[a11y-violation] id=${v.id} impact=${v.impact} nodes=${v.nodes.length} ` +
            `help="${v.help}" url=${v.helpUrl}`
        );
      }
    }

    // S1 soft mode: critical 위반만 fail — serious/moderate/minor 는 baseline 기록
    // Phase 2 strict mode 에서 serious 도 game on. critical 은 첫날부터 차단 (회복 불가능 a11y 결함)
    const blocking = result.violations.filter((v) => v.impact === 'critical');
    expect(
      blocking,
      `critical WCAG 2.1 AA 위반 ${blocking.length}건 — ` +
        `serious 이하는 baseline 통과 (Phase 2 에서 strict). ` +
        `상세는 [a11y-violation] log 또는 axe-core docs 참조`
    ).toHaveLength(0);
  });

  test('+ 새 스케줄 모달 — WCAG 2.1 AA scan', async ({page}) => {
    await page.goto('/project/plan1/');

    // 카테고리 1개 보장 (mutation-e2e.spec 패턴 복제 — 모달 열기 위한 prerequisite)
    await page.getByRole('button', {name: /카테고리|Categories|Categorías/i}).click();
    const catModal = page.locator('div.max-w-md').first();
    await expect(catModal).toBeVisible({timeout: 5_000});
    const catName = `a11y-cat-${Date.now()}`;
    await catModal.getByRole('textbox').first().fill(catName);
    await catModal.getByRole('button', {name: /^추가$|^Add$/i}).click();
    await expect(catModal.getByText(catName)).toBeVisible({timeout: 5_000});
    await catModal.getByRole('button', {name: /^닫기$|^Close$/i}).click();
    await expect(catModal).toBeHidden({timeout: 3_000});

    // 새 스케줄 모달 열기 — newBtn enabled wait 명시 (PLAN1-MAIN-REGRESSION-FIX · 2026-05-05).
    // 본 spec 는 카테고리 추가 후 + 새 스케줄 button 즉시 click 했지만 button 의 enabled 조건은
    // canOpenNew = loaded && categories.length > 0 (PlanApp.tsx:180). store.init() 의 Promise.all
    // (listSchedules·listCategories·getSettings) 적재 race 또는 catModal 닫는 시점 timing 으로
    // button 14× retry disabled 된 채 click timeout 가능. schedule-add·schedule-edit spec 는 이미
    // toBeEnabled wait 박혀있어 PASS. a11y spec 만 누락 → main run 25354381073 fail.
    const newBtn = page.getByRole('button', {name: /\+ (새 스케줄|New schedule)/i});
    await expect(newBtn).toBeEnabled({timeout: 10_000});
    await newBtn.click();
    await expect(page.getByRole('heading', {name: /새 스케줄|New schedule/i})).toBeVisible({
      timeout: 5_000
    });

    // 모달 영역만 scope 한 axe scan — main page 위반과 분리
    const result = await new AxeBuilder({page})
      .include('div.max-w-md')
      .withTags(A11Y_TAGS)
      .analyze();

    console.log(
      `[a11y-baseline] modal=new-schedule violations=${result.violations.length} ` +
        `incomplete=${result.incomplete.length} passes=${result.passes.length}`
    );
    if (result.violations.length > 0) {
      for (const v of result.violations) {
        console.log(
          `[a11y-violation] id=${v.id} impact=${v.impact} nodes=${v.nodes.length} ` +
            `help="${v.help}"`
        );
      }
    }

    const blocking = result.violations.filter((v) => v.impact === 'critical');
    expect(blocking, `모달 critical 위반 ${blocking.length}건`).toHaveLength(0);
  });
});
