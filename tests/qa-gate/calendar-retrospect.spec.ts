import {test, expect} from '@playwright/test';

/**
 * PLAN1-CALENDAR-RETROSPECT-20260531 — 달력보기 + 되돌아보기 mutation E2E.
 *
 * 영역:
 *   1. aside [시계|달력] 탭 전환 → MonthCalendar 표시
 *   2. 과거·오늘 날짜 클릭 → 되돌아보기 모달 (24h 기록)
 *   3. 모달 닫기 → 달력 복귀
 *
 * storageState reuse (auth.setup.ts) — qa-bot 1회 sign-in.
 */

test.describe('달력보기 + 되돌아보기', () => {
  test('달력 탭 전환 → 오늘 클릭 → 되돌아보기 모달', async ({page}) => {
    await page.goto('/project/plan1/');

    // 시계 탭이 디폴트 → 달력 탭 클릭
    await page.getByTestId('aside-tab-calendar').click();
    const cal = page.getByTestId('month-calendar');
    await expect(cal).toBeVisible({timeout: 5000});

    // 오늘 날짜 셀 클릭 → 되돌아보기 모달 (과거+오늘 허용).
    await cal.locator('.fc-day-today').first().click();
    const modal = page.getByTestId('retrospect-modal');
    await expect(modal).toBeVisible({timeout: 5000});

    // 닫기 → 달력 복귀
    await modal.getByRole('button', {name: /close|닫기/i}).click();
    await expect(modal).toHaveCount(0, {timeout: 3000});
    await expect(cal).toBeVisible();
  });

  test('시계 탭 복귀 → 아날로그 시계 표시', async ({page}) => {
    await page.goto('/project/plan1/');
    await page.getByTestId('aside-tab-calendar').click();
    await expect(page.getByTestId('month-calendar')).toBeVisible({timeout: 5000});
    await page.getByTestId('aside-tab-clock').click();
    await expect(page.getByTestId('month-calendar')).toHaveCount(0, {timeout: 3000});
    // AnalogClock svg 렌더 catch (시계 탭).
    await expect(page.locator('svg.mx-auto').first()).toBeVisible({timeout: 5000});
  });
});
