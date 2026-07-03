import {test, expect, Page} from '@playwright/test';

/**
 * plan1 mutation E2E gate — A7 카테고리 소프트 삭제 (사용 중 카테고리 · one_schedule)
 *
 * 대장 2026-07-03 소프트 삭제 전환. 옛 armed(2단계 confirm)+cascade DELETE 폐기.
 * 새 불변식: 사용 중 카테고리 삭제 = 목록에서만 사라지고 **소속 스케줄은 보존**(그 카테고리 색 유지).
 *
 * 흐름 (CategoryManager.handleRemove · 선코드 실측):
 *   - rm 버튼 1차 클릭 → removeCategory(id, false) → 소프트 삭제(deleted_at 마킹) → 목록에서 사라짐
 *   - 스케줄은 그대로 유지 (하드삭제/cascade 없음)
 *
 * 시나리오:
 *   1. 카테고리 추가 (catName)
 *   2. schedule 1개 추가 (이 카테고리 사용)
 *   3. 카테고리 모달 → catName rm 1차 클릭 → 목록에서 사라짐 (SLA warm < 3000ms)
 *   4. 모달 닫고 스케줄이 **여전히 보임** 검증 (소프트 삭제 보존 불변식)
 *   5. cleanup: 스케줄 카드 클릭 → 편집 모달 → 삭제
 *
 * SLA 측정 출력 형식:
 *   [qa-gate] category_soft_delete_ms=NNN cold=true|false
 */

const SLA_WARM_MS = 3000;
const SLA_COLD_MS = 5000;

function dialogOf(page: Page, headingName: string | RegExp) {
  const heading = page.getByRole('heading', {name: headingName});
  const dialog = page.locator('div.max-w-md').filter({has: heading}).first();
  return {heading, dialog};
}

test.describe('plan1 mutation E2E — A7 카테고리 소프트 삭제 (스케줄 보존)', () => {
  test('카테고리 + schedule 1개 → 카테고리 삭제 → 스케줄 보존 + SLA', async ({page}) => {
    const catName = `cat-soft-${Date.now()}`;
    const schedTitle = `qa-soft-${Date.now()}`;

    // 0. 진입
    // QA-GATE-BASEPATH-CLOCK-20260614: schedule 생성 모달 추가 버튼은 useNow hydration(nowReady)
    // 의존 — 고정 clock + fastForward 로 nowReady 안정화 (cascade-bump·instant-complete 통과 패턴).
    const fixedTime = new Date();
    fixedTime.setUTCHours(12, 0, 0, 0);
    await page.clock.install({time: fixedTime});
    await page.goto('/project/plan1/');
    await page.clock.fastForward(2000);

    // 1. 카테고리 추가
    await page.getByRole('button', {name: '카테고리'}).click();
    const cat = dialogOf(page, /categories|카테고리/i);
    await expect(cat.dialog).toBeVisible({timeout: 5_000});
    await cat.dialog.getByRole('textbox').first().fill(catName);
    await cat.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(cat.dialog.getByText(catName)).toBeVisible({timeout: SLA_COLD_MS});
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});

    // 2. 새 schedule 1개 추가 (이 카테고리 사용)
    const newBtn = page.getByRole('button', {name: '+ 새 스케줄'});
    await expect(newBtn).toBeEnabled({timeout: 10_000});
    await newBtn.click();

    const sched = dialogOf(page, '새 스케줄');
    await expect(sched.heading).toBeVisible({timeout: 5_000});
    await sched.dialog.getByRole('textbox').first().fill(schedTitle);
    const catSelect = sched.dialog.locator('select').first();
    await catSelect.selectOption({label: catName});
    await sched.dialog.locator('input[type="number"]').fill('30');
    await sched.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(sched.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    await expect(page.getByText(schedTitle).first()).toBeVisible({timeout: 5_000});

    // 3. 카테고리 모달 다시 열기 → catName rm 1차 클릭 (소프트 삭제)
    await page.getByRole('button', {name: '카테고리'}).click();
    await expect(cat.dialog).toBeVisible({timeout: 5_000});
    const row = cat.dialog.locator('li').filter({hasText: catName});
    await expect(row).toBeVisible({timeout: 3_000});
    const rmBtn = row.getByRole('button', {name: 'rm', exact: true});
    await expect(rmBtn).toBeVisible({timeout: 3_000});

    // 4. 측정: 1차 click → 소프트 삭제 mutation → 목록에서 사라짐
    const startMs = Date.now();
    await rmBtn.click();
    await expect(cat.dialog.getByText(catName)).toHaveCount(0, {
      timeout: SLA_COLD_MS + 2_000,
    });
    const elapsedMs = Date.now() - startMs;

    const isCold = elapsedMs > SLA_WARM_MS;
    const threshold = isCold ? SLA_COLD_MS : SLA_WARM_MS;
    console.log(
      `[qa-gate] category_soft_delete_ms=${elapsedMs} cold=${isCold} threshold=${threshold}`
    );

    // 5. SLA 게이트 (4/29 사고 catch 한도 보존)
    expect(
      elapsedMs,
      `removeCategory(soft) 응답 ${elapsedMs}ms — ${
        isCold ? 'cold' : 'warm'
      } SLA ${threshold}ms 초과.`
    ).toBeLessThan(threshold);

    // 6. 모달 닫기 → 스케줄 보존 불변식: schedule 이 여전히 보임 (cascade 삭제 안 됨)
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});
    await expect(page.getByText(schedTitle).first()).toBeVisible({timeout: 5_000});

    // 7. cleanup — 스케줄 삭제 (카테고리 삭제됐어도 편집 picker 는 현재 카테고리 노출)
    await page.getByText(schedTitle).first().click();
    const edit = dialogOf(page, '스케줄 편집');
    await expect(edit.heading).toBeVisible({timeout: 5_000});
    await edit.dialog.getByRole('button', {name: '삭제', exact: true}).click();
    await expect(edit.heading).toBeHidden({timeout: SLA_COLD_MS});
    await expect(page.getByText(schedTitle)).toHaveCount(0, {timeout: 3_000});
  });
});
