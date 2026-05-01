import {test, expect, Page} from '@playwright/test';

/**
 * plan1 mutation E2E gate — A11 working hours 설정 (RPN 40 Medium)
 *
 * 시나리오 (PICT model `working-hours.txt` happy path · single mode · all_within case):
 *   - "업무시간" 버튼 클릭 → WorkingHoursEditor 모달
 *   - single mode · future unique date (1년 후 + random offset)
 *   - startTime / endTime 변경
 *   - 저장 click → setWorkingHours mutation → SLA (warm < 3000ms)
 *   - 모달 닫힘 확인
 *
 * 4/29 사고 catch 차이:
 *   - createSchedule / updateSchedule / deleteCategory 와 다른 server action 경로
 *   - working-hours mutation 은 split 재계산 발동 가능 (다른 schedule 영향)
 *
 * SLA:
 *   - warm  : < 3000ms
 *   - cold  : < 5000ms
 *
 * 측정 출력 형식:
 *   [qa-gate] working_hours_ms=NNN cold=true|false
 *
 * cleanup 정직성:
 *   - 매 spec 마다 unique future date (1년 후 + random) 사용 → orphan 1 row 누적 (PR 1 run 당 1 row)
 *   - 영향 작음 (working_hours 테이블만 · prod DB 다른 테이블 무관)
 *   - 정공 cleanup 은 default 복원이지만 default 모름 — 보류 (옵션 A 채택)
 */

const SLA_WARM_MS = 3000;
const SLA_COLD_MS = 5000;

function dialogOf(page: Page, headingName: string | RegExp) {
  const heading = page.getByRole('heading', {name: headingName});
  const dialog = page.locator('div.max-w-md').filter({has: heading}).first();
  return {heading, dialog};
}

test.describe('plan1 mutation E2E — A11 working hours', () => {
  test('working hours 설정 (single · future unique date) → 응답 SLA', async ({page}) => {
    // 0. 진입
    await page.goto('/project/plan1/');

    // 1. "업무시간" 버튼 클릭 → WorkingHoursEditor
    //    i18n nav.workingHours = "업무시간"
    await page.getByRole('button', {name: '업무시간', exact: true}).click();
    const wh = dialogOf(page, /working hours/i);
    await expect(wh.dialog).toBeVisible({timeout: 5_000});

    // 2. single mode default · future unique date 설정
    //    1년 후 + random 30 days offset → orphan 누적 영향 최소
    const futureDays = 365 + Math.floor(Math.random() * 30);
    const futureMs = Date.now() + futureDays * 86_400_000;
    const futureDate = new Date(futureMs);
    const futureIso = `${futureDate.getFullYear()}-${String(
      futureDate.getMonth() + 1
    ).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
    await wh.dialog.locator('input[type="date"]').fill(futureIso);

    // 3. startTime / endTime 변경 (10:00 → 18:00 — qa-bot default 와 다른 값으로 mutation 보장)
    const timeInputs = wh.dialog.locator('input[type="time"]');
    await timeInputs.nth(0).fill('10:00');
    await timeInputs.nth(1).fill('18:00');

    // 4. 측정: 저장 click → 모달 닫힘
    //    i18n common.save = "저장"
    const startMs = Date.now();
    await wh.dialog.getByRole('button', {name: '저장', exact: true}).click();
    await expect(wh.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    const elapsedMs = Date.now() - startMs;

    const isCold = elapsedMs > SLA_WARM_MS;
    const threshold = isCold ? SLA_COLD_MS : SLA_WARM_MS;
    console.log(
      `[qa-gate] working_hours_ms=${elapsedMs} cold=${isCold} threshold=${threshold} date=${futureIso}`
    );

    // 5. SLA 게이트 (4/29 사고 catch 한도 보존)
    expect(
      elapsedMs,
      `setWorkingHours mutation 응답 ${elapsedMs}ms — ${
        isCold ? 'cold' : 'warm'
      } SLA ${threshold}ms 초과. split 재계산 · sequential await loop 영역 진단 필요.`
    ).toBeLessThan(threshold);
  });
});
