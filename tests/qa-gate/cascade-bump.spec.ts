import {test, expect, Page} from '@playwright/test';

/**
 * plan1 mutation E2E gate — A9 타이머 bump (cascade 발동) — Critical RPN 80
 *
 * 4/29 5초 latency 사고 직접 영역. cross-region (Vercel iad1 ↔ Neon ap-southeast-1)
 * × sequential await loop × cascade chain shift 결합 결함 catch.
 *
 * 시나리오 (PICT model `cascade-bump.txt` happy path · n_1 case · warm path):
 *   - schedule 1개 추가 — "지금" 버튼 클릭 (현재 분 set · isFuture 통과 + 즉시 active 윈도우 진입)
 *   - duration 60min · 추가 → ActiveTimer 즉시 표시
 *   - `+30m` 버튼 클릭 → extendScheduleBy mutation (cascade 발동 가능 영역)
 *   - SLA (warm < 3000ms / cold < 5000ms)
 *   - cleanup: schedule 삭제
 *
 * ActiveTimer 활성화 흐름 (선코드 실측 · 2026-05-02):
 *   - findActiveSchedules: status !== 'done' AND startAt <= now < startAt + durationMin*60000
 *   - useNow: setInterval(1000) 1초 갱신 + Date.now() 직접 호출
 *   - NewScheduleModal `setNowStart` 버튼: date=오늘 + hour·minute = 현재 시각 set
 *   - minuteOptions useMemo: 표준 boundary 외 분도 dynamic 추가 ([0,10,20,23,30,40,50] 등)
 *   - isFuture: Math.floor(startAt/60000) >= Math.floor(now/60000) — 같은 분이면 통과
 *   - → "지금" 클릭 + 추가 → 같은 분 startAt schedule = 즉시 active (clock fake 불요 · 정공)
 *
 * 4/29 catch 차이 (다른 spec 과):
 *   - schedule-add: createSchedule (insert)
 *   - schedule-edit: updateSchedule (update)
 *   - category-delete: deleteCategory
 *   - working-hours: setWorkingHours
 *   - **cascade-bump: extendScheduleBy (cascade chain shift 가능 — 4/29 직접 영역)**
 *
 * SLA 측정 출력 형식:
 *   [qa-gate] cascade_bump_ms=NNN cold=true|false
 *
 * 첫 시도 정직성 (2026-05-02):
 *   - 1차 시도 가정 "Playwright clock fake 로 ActiveTimer 활성화 우회" = 환각 / 과잉 설계
 *   - 실측 후 단순화: NewScheduleModal "지금" 버튼이 isFuture 통과 + 즉시 active 둘 다 해결
 *   - clock fake 없이 정공 동작
 */

const SLA_WARM_MS = 3000;
const SLA_COLD_MS = 5000;

function dialogOf(page: Page, headingName: string | RegExp) {
  const heading = page.getByRole('heading', {name: headingName});
  const dialog = page.locator('div.max-w-md').filter({has: heading}).first();
  return {heading, dialog};
}

test.describe('plan1 mutation E2E — A9 cascade-bump (Critical · 4/29 영역)', () => {
  test('schedule active (지금 시작) → +30m bump SLA + cleanup', async ({page}) => {
    const title = `qa-bump-${Date.now()}`;
    const catName = `cat-bump-${Date.now()}`;

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

    // 2. + 새 스케줄
    const newBtn = page.getByRole('button', {name: '+ 새 스케줄'});
    await expect(newBtn).toBeEnabled({timeout: 10_000});
    await newBtn.click();

    const sched = dialogOf(page, '새 스케줄');
    await expect(sched.heading).toBeVisible({timeout: 5_000});
    await sched.dialog.getByRole('textbox').first().fill(title);

    // 3. "now" 버튼 클릭 — date=오늘, hour·minute=현재 시각 자동 set
    //    minuteOptions useMemo 가 표준 boundary 외 분 dynamic 추가 → isFuture 통과
    //    i18n schedule.buttonNow = "now (시작을 지금으로)" — regex 로 i18n 변경 catch
    await sched.dialog.getByRole('button', {name: /^now/}).click();

    // 4. duration 60min 입력 (단일 input[type=number] · ActiveTimer 윈도우 충분히 길게)
    await sched.dialog.locator('input[type="number"]').fill('60');

    // 5. 추가 → schedule 생성 (즉시 active 윈도우 진입)
    await sched.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(sched.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    await expect(page.getByText(title).first()).toBeVisible({timeout: 5_000});

    // 6. ActiveTimer 표시 확인 — +30m 버튼 visible
    //    (schedule.startAt <= now < startAt + 60min · 같은 분 안에 진입하면 active)
    const bumpBtn = page.getByRole('button', {name: '+30m', exact: true});
    await expect(bumpBtn).toBeVisible({timeout: 10_000});

    // 7. 측정: +30m click → extendScheduleBy mutation → button 재 enabled
    const startMs = Date.now();
    await bumpBtn.click();
    await expect(bumpBtn).toBeEnabled({timeout: SLA_COLD_MS + 2_000});
    const elapsedMs = Date.now() - startMs;

    const isCold = elapsedMs > SLA_WARM_MS;
    const threshold = isCold ? SLA_COLD_MS : SLA_WARM_MS;
    console.log(
      `[qa-gate] cascade_bump_ms=${elapsedMs} cold=${isCold} threshold=${threshold}`
    );

    // 8. SLA 게이트 (4/29 사고 catch 한도 보존)
    expect(
      elapsedMs,
      `extendScheduleBy mutation 응답 ${elapsedMs}ms — ${
        isCold ? 'cold' : 'warm'
      } SLA ${threshold}ms 초과. 4/29 cross-region × cascade chain shift × sequential await loop 영역 진단 필요.`
    ).toBeLessThan(threshold);

    // 9. cleanup — schedule 삭제 (orphan row 누적 차단)
    await page.getByText(title).first().click();
    const edit = dialogOf(page, '스케줄 편집');
    await expect(edit.heading).toBeVisible({timeout: 5_000});
    await edit.dialog.getByRole('button', {name: '삭제', exact: true}).click();
    await edit.dialog
      .getByRole('button', {name: '삭제 확인', exact: true})
      .click();
    await expect(edit.heading).toBeHidden({timeout: SLA_COLD_MS});
    await expect(page.getByText(title)).toHaveCount(0, {timeout: 3_000});
  });
});
