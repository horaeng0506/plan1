import {test, expect, Page} from '@playwright/test';

/**
 * plan1 mutation E2E gate — A4 스케줄 편집 (RPN 48 Medium)
 *
 * 시나리오 (PICT model `edit-schedule.txt` happy path):
 *   - schedule 1개 추가 (내일 · 30분)
 *   - 카드 클릭 → 편집 모달 → durationMin 30 → 60
 *   - 저장 → 모달 닫힘 → SLA (warm < 3000ms)
 *   - 카드 표시 확인 + cleanup 삭제
 *
 * 4/29 사고 회귀 catch:
 *   - cross-region RTT (5초 latency) → updateSchedule mutation SLA 초과 시 fail
 *   - cascade 발동 회귀 → durationMin 변경 시 다른 chained schedule 영향 (PBT 단위 검증 + E2E SLA 측정)
 *
 * 차이 (mutation-e2e.spec.ts schedule-add 와):
 *   - schedule-add: 새 schedule 생성 mutation (createSchedule)
 *   - schedule-edit: 기존 schedule update mutation (updateSchedule) — 4/29 사고 같은 cascade·sequential await loop 가능 영역
 *
 * SLA:
 *   - warm  : < 3000ms
 *   - cold  : < 5000ms
 *
 * 측정 출력 형식 (parseable):
 *   [qa-gate] schedule_edit_ms=NNN cold=true|false
 */

const SLA_WARM_MS = 3000;
const SLA_COLD_MS = 5000;

function dialogOf(page: Page, headingName: string | RegExp) {
  const heading = page.getByRole('heading', {name: headingName});
  const dialog = page.locator('div.max-w-md').filter({has: heading}).first();
  return {heading, dialog};
}

test.describe('plan1 mutation E2E — A4 스케줄 편집', () => {
  test('schedule 편집 (durationMin 30→60) → 응답 SLA + cleanup', async ({page}) => {
    const title = `qa-edit-${Date.now()}`;
    const catName = `cat-edit-${Date.now()}`;

    // 0. 진입
    await page.goto('/project/plan1/');

    // 1. 카테고리 보장
    await page.getByRole('button', {name: '카테고리'}).click();
    const cat = dialogOf(page, /categories|카테고리/i);
    await expect(cat.dialog).toBeVisible({timeout: 5_000});
    await cat.dialog.getByRole('textbox').first().fill(catName);
    await cat.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(cat.dialog.getByText(catName)).toBeVisible({timeout: SLA_COLD_MS});
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});

    // 2. + 새 스케줄 (편집 대상 사전 생성)
    const newBtn = page.getByRole('button', {name: '+ 새 스케줄'});
    await expect(newBtn).toBeEnabled({timeout: 10_000});
    await newBtn.click();

    const sched = dialogOf(page, '새 스케줄');
    await expect(sched.heading).toBeVisible({timeout: 5_000});
    await sched.dialog.getByRole('textbox').first().fill(title);
    const tomorrow = new Date(Date.now() + 86_400_000);
    const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await sched.dialog.locator('input[type="date"]').fill(tomorrowIso);
    await sched.dialog.locator('input[type="number"]').fill('30');
    await sched.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(sched.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    // WeeklyCalendar (firstDay=1 + weekView1) 1주 시야 의존. today.getDay() === 0 (일요일)
    // 이면 tomorrow=Mon=다음 주 → toolbar `next` 클릭. main run 25279350177 line 69 fail 회귀 catch.
    if (new Date().getDay() === 0) {
      // WeeklyCalendar 와 DailyTimeline 둘 다 FullCalendar — `.fc-next-button` 2개 매칭.
      // PlanApp.tsx 의 layout 순서 (Weekly 위 / Daily 아래) 따라 first() = WeeklyCalendar.
      await page.locator('.fc-next-button').first().click();
    }
    await expect(page.getByText(title).first()).toBeVisible({timeout: 5_000});

    // 3. 카드 클릭 → 편집 모달 열림
    await page.getByText(title).first().click();
    const edit = dialogOf(page, '스케줄 편집');
    await expect(edit.heading).toBeVisible({timeout: 5_000});

    // 4. durationMin 30 → 60 변경
    //    NewScheduleModal 의 input[type="number"] 가 durationMin 단일 필드 (i18n 'durationMin' 라벨)
    await edit.dialog.locator('input[type="number"]').fill('60');

    // 5. 측정: 저장 click → 모달 닫힘
    //    편집 모드에서 버튼 라벨이 '저장' (i18n: t.modal.save = "저장" · 신규 모드 'add' 와 구분)
    const startMs = Date.now();
    await edit.dialog.getByRole('button', {name: '저장', exact: true}).click();
    await expect(edit.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    const elapsedMs = Date.now() - startMs;

    const isCold = elapsedMs > SLA_WARM_MS;
    const threshold = isCold ? SLA_COLD_MS : SLA_WARM_MS;
    console.log(
      `[qa-gate] schedule_edit_ms=${elapsedMs} cold=${isCold} threshold=${threshold}`
    );

    // 6. SLA 게이트 (4/29 사고 catch 한도 보존 — `dev-process.md` § mutation E2E 가드)
    expect(
      elapsedMs,
      `updateSchedule mutation 응답 ${elapsedMs}ms — ${
        isCold ? 'cold' : 'warm'
      } SLA ${threshold}ms 초과. 4/29 cross-region latency 패턴 회귀 가능성. cascade·sequential await loop 영역 진단 필요.`
    ).toBeLessThan(threshold);

    // 7. 카드 표시 확인 (편집 후 schedule 여전히 존재)
    await expect(page.getByText(title).first()).toBeVisible({timeout: 5_000});

    // 8. cleanup — schedule 삭제 (orphan row 누적 차단)
    await page.getByText(title).first().click();
    const cleanup = dialogOf(page, '스케줄 편집');
    await expect(cleanup.heading).toBeVisible({timeout: 5_000});
    await cleanup.dialog.getByRole('button', {name: '삭제', exact: true}).click();
    await cleanup.dialog
      .getByRole('button', {name: '삭제 확인', exact: true})
      .click();
    await expect(cleanup.heading).toBeHidden({timeout: SLA_COLD_MS});
    await expect(page.getByText(title)).toHaveCount(0, {timeout: 3_000});
  });

  /**
   * 14:00 fall-back 회귀 catch — 수정 시 startAt 보존 (PLAN1-SCHEDULE-OPT-A · 2026-05-04).
   *
   * 사고: prod 사용자 schedule 수정 시도 → 수정 시도해도 14:00 으로 회귀.
   * root cause: updateSchedule 도 splitByWorkingHours 거침 (createSchedule 동일 chain).
   *
   * 옵션 A 적용 후 검증: hour=7 schedule 등록 → 같은 schedule 수정 (제목만 변경) → hour 그대로 7
   */
  test('14:00 fall-back 회귀 catch — update 시 startAt 보존 (제목 변경만)', async ({page}) => {
    const title = `qa-edit-tz-${Date.now()}`;
    const newTitle = `${title}-edited`;
    const catName = `cat-edit-tz-${Date.now()}`;
    const expectedHour = 7;

    await page.goto('/project/plan1/');

    await page.getByRole('button', {name: '카테고리'}).click();
    const cat = dialogOf(page, /categories|카테고리/i);
    await expect(cat.dialog).toBeVisible({timeout: 5_000});
    await cat.dialog.getByRole('textbox').first().fill(catName);
    await cat.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(cat.dialog.getByText(catName)).toBeVisible({timeout: SLA_COLD_MS});
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});

    await page.getByRole('button', {name: '+ 새 스케줄'}).click();
    const sched = dialogOf(page, '새 스케줄');
    await expect(sched.heading).toBeVisible({timeout: 5_000});
    await sched.dialog.getByRole('textbox').first().fill(title);
    const tomorrow = new Date(Date.now() + 86_400_000);
    const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await sched.dialog.locator('input[type="date"]').fill(tomorrowIso);
    await sched.dialog.locator('select').nth(1).selectOption(String(expectedHour));
    await sched.dialog.locator('input[type="number"]').fill('30');
    await sched.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(sched.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});

    if (new Date().getDay() === 0) await page.locator('.fc-next-button').first().click();
    await expect(page.getByText(title).first()).toBeVisible({timeout: 5_000});

    // 카드 클릭 → 편집 모달 → title 만 수정 (startAt 패치 없음)
    await page.getByText(title).first().click();
    const edit = dialogOf(page, '스케줄 편집');
    await expect(edit.heading).toBeVisible({timeout: 5_000});
    const titleInput = edit.dialog.getByRole('textbox').first();
    await titleInput.fill(newTitle);
    await edit.dialog.getByRole('button', {name: '저장', exact: true}).click();
    await expect(edit.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});

    // round-trip: 새 제목 카드 클릭 → hour select 가 여전히 7 (14:00 회귀 catch)
    await expect(page.getByText(newTitle).first()).toBeVisible({timeout: 5_000});
    await page.getByText(newTitle).first().click();
    const reopen = dialogOf(page, '스케줄 편집');
    await expect(reopen.heading).toBeVisible({timeout: 5_000});
    const hourSelect = reopen.dialog.locator('select').nth(1);
    const actualHour = await hourSelect.inputValue();
    expect(
      Number(actualHour),
      `update (제목 만 변경) 시 hour=${expectedHour} 보존 확인 → round-trip hour=${actualHour}. ` +
        `14:00 fall-back 회귀 catch (PLAN1-SCHEDULE-OPT-A). ` +
        `옵션 A 미적용 시 update 흐름의 splitByWorkingHours 가 fall-back 야기.`
    ).toBe(expectedHour);

    // cleanup
    await reopen.dialog.getByRole('button', {name: '삭제', exact: true}).click();
    await reopen.dialog
      .getByRole('button', {name: '삭제 확인', exact: true})
      .click();
    await expect(reopen.heading).toBeHidden({timeout: SLA_COLD_MS});
    await expect(page.getByText(newTitle)).toHaveCount(0, {timeout: 3_000});
  });
});
