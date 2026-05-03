import {test, expect, Page} from '@playwright/test';

/**
 * plan1 mutation E2E gate — A7 카테고리 삭제 armed case (one_schedule)
 *
 * PICT model `category-delete.txt` 의 one_schedule case
 *   (no_schedule case 는 별도 spec `category-delete.spec.ts` 에 박힘 · 1차 즉시 삭제)
 *
 * 흐름 (CategoryManager.handleRemove count > 0 분기 · 선코드 실측):
 *   - count > 0 첫 클릭 → setConfirmId(id) → 라벨 "confirm rm ({count})" 표시 (armed)
 *   - 같은 카테고리 다시 클릭 → removeCategory(id, force=true) 호출
 *   - server action: ON DELETE CASCADE 로 schedule 도 함께 삭제 (DB-level cascade · plan1_schedules.category_id → plan1_categories.id)
 *
 * 시나리오:
 *   1. 카테고리 추가 (catName)
 *   2. schedule 1개 추가 (이 카테고리 사용)
 *   3. 카테고리 모달 열기 → catName 의 rm 버튼 1차 클릭 (armed · 라벨 변경)
 *   4. armed 라벨 "confirm rm (1)" visible 검증
 *   5. 측정: 같은 버튼 재클릭 → DB cascade 삭제 → 카테고리 list 에서 사라짐 (SLA warm < 3000ms)
 *   6. cleanup 불요 (schedule 도 cascade 로 함께 삭제됨 — 모달 닫기만)
 *
 * 4/29 catch 차이 (category-delete.spec.ts no_schedule 와):
 *   - no_schedule: deleteCategory(id, false) — schedule 0건 path
 *   - **one_schedule: deleteCategory(id, true) — DB cascade DELETE path** (다른 server action 분기)
 *
 * SLA 측정 출력 형식:
 *   [qa-gate] category_delete_armed_ms=NNN cold=true|false
 */

const SLA_WARM_MS = 3000;
const SLA_COLD_MS = 5000;

function dialogOf(page: Page, headingName: string | RegExp) {
  const heading = page.getByRole('heading', {name: headingName});
  const dialog = page.locator('div.max-w-md').filter({has: heading}).first();
  return {heading, dialog};
}

test.describe('plan1 mutation E2E — A7 카테고리 삭제 armed case', () => {
  test('카테고리 + schedule 1개 → armed 클릭 → confirm 클릭 → SLA + cascade', async ({page}) => {
    const catName = `cat-armed-${Date.now()}`;
    const schedTitle = `qa-armed-${Date.now()}`;

    // 0. 진입
    await page.goto('/project/plan1/');

    // 1. 카테고리 추가
    await page.getByRole('button', {name: '카테고리'}).click();
    const cat = dialogOf(page, /categories|카테고리/i);
    await expect(cat.dialog).toBeVisible({timeout: 5_000});
    await cat.dialog.getByRole('textbox').first().fill(catName);
    await cat.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(cat.dialog.getByText(catName)).toBeVisible({timeout: SLA_COLD_MS});
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});

    // 2. 새 schedule 1개 추가 (이 카테고리 사용 — count=1 만들기)
    const newBtn = page.getByRole('button', {name: '+ 새 스케줄'});
    await expect(newBtn).toBeEnabled({timeout: 10_000});
    await newBtn.click();

    const sched = dialogOf(page, '새 스케줄');
    await expect(sched.heading).toBeVisible({timeout: 5_000});
    await sched.dialog.getByRole('textbox').first().fill(schedTitle);
    // 카테고리 select 에서 catName 선택 — 직전에 추가한 카테고리는 select 의 마지막 option
    //   schedule.fieldCategory select 의 last option 이 방금 추가 catName (또는 __NEW__).
    //   안전: select 안에서 catName 으로 옵션 매칭
    const catSelect = sched.dialog.locator('select').first();
    await catSelect.selectOption({label: catName});
    // 내일 날짜로 isFuture 통과
    const tomorrow = new Date(Date.now() + 86_400_000);
    const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await sched.dialog.locator('input[type="date"]').fill(tomorrowIso);
    await sched.dialog.locator('input[type="number"]').fill('30');
    await sched.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(sched.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    // WeeklyCalendar (firstDay=1 + weekView1) 1주 시야 의존. today.getDay() === 0 (일요일)
    // 이면 tomorrow=Mon=다음 주 → toolbar `next` 클릭. main run 25279350177 line 77 fail 회귀 catch.
    if (new Date().getDay() === 0) {
      // WeeklyCalendar 와 DailyTimeline 둘 다 FullCalendar — `.fc-next-button` 2개 매칭.
      // PlanApp.tsx 의 layout 순서 (Weekly 위 / Daily 아래) 따라 first() = WeeklyCalendar.
      await page.locator('.fc-next-button').first().click();
    }
    await expect(page.getByText(schedTitle).first()).toBeVisible({timeout: 5_000});

    // 3. 카테고리 모달 다시 열기
    await page.getByRole('button', {name: '카테고리'}).click();
    await expect(cat.dialog).toBeVisible({timeout: 5_000});

    // 4. armed 1차 클릭 (count > 0 분기 · 라벨 "confirm rm (1)" 변경)
    const row = cat.dialog.locator('li').filter({hasText: catName});
    await expect(row).toBeVisible({timeout: 3_000});
    await row.getByRole('button', {name: 'rm', exact: true}).click();

    // 5. armed 라벨 검증 — i18n category.confirmRemoveLabel = "confirm rm ({count})"
    const confirmBtn = row.getByRole('button', {name: /^confirm rm/});
    await expect(confirmBtn).toBeVisible({timeout: 3_000});

    // 6. 측정: 재클릭 → cascade DB DELETE → 카테고리 list 에서 사라짐
    const startMs = Date.now();
    await confirmBtn.click();
    await expect(cat.dialog.getByText(catName)).toHaveCount(0, {
      timeout: SLA_COLD_MS + 2_000,
    });
    const elapsedMs = Date.now() - startMs;

    const isCold = elapsedMs > SLA_WARM_MS;
    const threshold = isCold ? SLA_COLD_MS : SLA_WARM_MS;
    console.log(
      `[qa-gate] category_delete_armed_ms=${elapsedMs} cold=${isCold} threshold=${threshold}`
    );

    // 7. SLA 게이트 (4/29 사고 catch 한도 보존)
    expect(
      elapsedMs,
      `deleteCategory(force=true) cascade DELETE 응답 ${elapsedMs}ms — ${
        isCold ? 'cold' : 'warm'
      } SLA ${threshold}ms 초과. cascade · cleanOrphans 영역 진단 필요.`
    ).toBeLessThan(threshold);

    // 8. 모달 닫기 (cleanup 자체 — schedule 도 DB cascade 로 함께 삭제됨)
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});
  });
});
