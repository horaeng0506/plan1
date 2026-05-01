import {test, expect, Page} from '@playwright/test';

/**
 * plan1 mutation E2E gate — A7 카테고리 삭제 (RPN 32 Medium)
 *
 * 시나리오 (PICT model `category-delete.txt` happy path · no_schedule case):
 *   - 카테고리 모달 진입
 *   - 카테고리 1개 추가
 *   - 같은 카테고리 삭제 버튼 1차 클릭 (armed → "confirm rm (0)" 라벨 변경)
 *   - 2차 클릭 → 실제 삭제 mutation → SLA (warm < 3000ms)
 *   - 카테고리 list 에서 사라진 것 확인
 *
 * 4/29 사고 catch 차이:
 *   - schedule-add: createSchedule mutation
 *   - schedule-edit: updateSchedule mutation
 *   - category-delete: deleteCategory mutation — 다른 server action 경로 (cascade · cleanOrphans 호출 가능)
 *
 * SLA:
 *   - warm  : < 3000ms
 *   - cold  : < 5000ms
 *
 * 측정 출력 형식:
 *   [qa-gate] category_delete_ms=NNN cold=true|false
 *
 * cleanup:
 *   - 삭제 자체가 cleanup (사용 schedule 0건 case 라 orphan 없음)
 */

const SLA_WARM_MS = 3000;
const SLA_COLD_MS = 5000;

function dialogOf(page: Page, headingName: string | RegExp) {
  const heading = page.getByRole('heading', {name: headingName});
  const dialog = page.locator('div.max-w-md').filter({has: heading}).first();
  return {heading, dialog};
}

test.describe('plan1 mutation E2E — A7 카테고리 삭제', () => {
  test('카테고리 추가 → 삭제 (no_schedule case) → 응답 SLA', async ({page}) => {
    const catName = `cat-del-${Date.now()}`;

    // 0. 진입
    await page.goto('/project/plan1/');

    // 1. 카테고리 모달 진입
    await page.getByRole('button', {name: '카테고리'}).click();
    const cat = dialogOf(page, /categories|카테고리/i);
    await expect(cat.dialog).toBeVisible({timeout: 5_000});

    // 2. 카테고리 추가 (이번 spec 의 삭제 대상 사전 생성)
    await cat.dialog.getByRole('textbox').first().fill(catName);
    await cat.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(cat.dialog.getByText(catName)).toBeVisible({timeout: SLA_COLD_MS});

    // 3. 삭제 버튼 1차 클릭 (armed)
    //    catName 이 포함된 li 행 안의 button (name=/rm/) 찾기
    //    i18n category.removeButton = "rm"
    const row = cat.dialog.locator('li').filter({hasText: catName});
    await expect(row).toBeVisible({timeout: 3_000});
    await row.getByRole('button', {name: 'rm', exact: true}).click();

    // 4. armed 상태 — 라벨이 "confirm rm (0)" 으로 변경 (사용 schedule 0건)
    //    i18n category.confirmRemoveLabel = "confirm rm ({count})"
    const confirmBtn = row.getByRole('button', {name: /^confirm rm/});
    await expect(confirmBtn).toBeVisible({timeout: 3_000});

    // 5. 측정: 2차 클릭 → mutation 응답 → list 에서 사라짐
    const startMs = Date.now();
    await confirmBtn.click();
    await expect(cat.dialog.getByText(catName)).toHaveCount(0, {
      timeout: SLA_COLD_MS + 2_000,
    });
    const elapsedMs = Date.now() - startMs;

    const isCold = elapsedMs > SLA_WARM_MS;
    const threshold = isCold ? SLA_COLD_MS : SLA_WARM_MS;
    console.log(
      `[qa-gate] category_delete_ms=${elapsedMs} cold=${isCold} threshold=${threshold}`
    );

    // 6. SLA 게이트 (4/29 사고 catch 한도 보존)
    expect(
      elapsedMs,
      `deleteCategory mutation 응답 ${elapsedMs}ms — ${
        isCold ? 'cold' : 'warm'
      } SLA ${threshold}ms 초과. cascade · cleanOrphans 영역 진단 필요.`
    ).toBeLessThan(threshold);

    // 7. 모달 닫기 (cleanup 자체 — 다른 spec 영향 없게)
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});
  });
});
