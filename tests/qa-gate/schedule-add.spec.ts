import {test, expect, Page} from '@playwright/test';

/**
 * plan1 mutation E2E gate — A3 schedule 추가 (Track 2 C-2.5 · 2026-04-29).
 *
 * 2026-05-02 rename: mutation-e2e.spec.ts → schedule-add.spec.ts
 *   다른 spec (schedule-edit · category-delete · working-hours · cascade-bump · instant-complete)
 *   머지 후 명칭 일관성 위해. 일반 "mutation-e2e" 명칭 중복 회피.
 *
 * 시나리오: schedule 추가 → 모달 닫힘 → 응답 시간 SLA.
 *
 * 4/29 사고 회귀 catch:
 *   - cross-continent RTT (5초 latency) → SLA 3000ms 초과 시 fail
 *   - syncSchedules sequential await loop → 같은 SLA
 *   - + 새 스케줄 button 자체 disabled (인증 깨짐) → expect.toBeEnabled 단계 fail
 *
 * 흐름:
 *   1. 카테고리 자동 보장 (qa-bot prod DB 신규 가입 직후 categories 비어있으면 button disabled)
 *   2. + 새 스케줄 → 모달 → title + duration → 추가 → 모달 닫힘 wait → SLA
 *   3. 카드 표시 확인
 *   4. cleanup: 카드 클릭 → 편집 모달 → 삭제 (즉시 진행 · V2 #15)
 *
 * SLA:
 *   - warm  : < 3000ms
 *   - cold  : < 5000ms (Lambda spin-up · JWKS first fetch)
 *
 * 측정 출력 형식 (parseable):
 *   [qa-gate] schedule_add_ms=NNN cold=true|false
 */

const SLA_WARM_MS = 3000;
const SLA_COLD_MS = 5000;

/** modal heading 의 부모 dialog scope (NewScheduleModal·CategoryManager 등 max-w-md 컨테이너) */
function dialogOf(page: Page, headingName: string | RegExp) {
  const heading = page.getByRole('heading', {name: headingName});
  const dialog = page.locator('div.max-w-md').filter({has: heading}).first();
  return {heading, dialog};
}

test.describe('plan1 mutation E2E — A3 schedule 추가', () => {
  test('schedule 추가 → 응답 SLA + cleanup', async ({page}) => {
    const title = `qa-bot-${Date.now()}`;
    const catName = `cat-${Date.now()}`;

    // 0. 진입 (basePath=/project, plan1 sub-route)
    await page.goto('/project/plan1/');

    // 1. 카테고리 자동 보장 — qa-bot prod DB 신규 가입 시 categories 비어있어 schedule add disabled.
    //    매 spec 실행마다 unique catName 1개 추가. cleanup 누적 영향 작음 (list 만 길어짐).
    await page.getByRole('button', {name: '카테고리'}).click();
    const cat = dialogOf(page, /categories|카테고리/i);
    await expect(cat.dialog).toBeVisible({timeout: 5_000});
    await cat.dialog.getByRole('textbox').first().fill(catName);
    await cat.dialog.getByRole('button', {name: '추가', exact: true}).click();
    // 추가 mutation 완료 대기 — list 에 새 카테고리 표시
    await expect(cat.dialog.getByText(catName)).toBeVisible({timeout: SLA_COLD_MS});
    // 닫기 — 명시 close button (busy=true 이면 Esc useEscapeKey 비활성)
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});

    // 2. + 새 스케줄 (categories 1개 이상 + 미인증 X 보장 후)
    const newBtn = page.getByRole('button', {name: '+ 새 스케줄'});
    await expect(
      newBtn,
      'qa-bot sign-in + categories 1개 이상이면 enabled. 게스트 또는 categories 비어있으면 disabled.'
    ).toBeEnabled({timeout: 10_000});
    await newBtn.click();

    // 3. NewScheduleModal — title + duration. 시작 시각 자동 (현재 시각 hour boundary)
    //    PLAN1-FOCUS-VIEW-REDESIGN-20260506: date input 폐기 · hour select 동적 24h.
    //    default startAt = 현재 시각 → isFuture true (분 단위 정밀도 한계 흡수).
    const sched = dialogOf(page, '새 스케줄');
    await expect(sched.heading).toBeVisible({timeout: 5_000});
    await sched.dialog.getByRole('textbox').first().fill(title);
    await sched.dialog.locator('input[type="number"]').fill('30');

    // 4. 측정: 추가 click → 모달 닫힘
    const startMs = Date.now();
    await sched.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(sched.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    const elapsedMs = Date.now() - startMs;

    const isCold = elapsedMs > SLA_WARM_MS;
    const threshold = isCold ? SLA_COLD_MS : SLA_WARM_MS;
    console.log(
      `[qa-gate] schedule_add_ms=${elapsedMs} cold=${isCold} threshold=${threshold}`
    );

    // 5. SLA 게이트
    expect(
      elapsedMs,
      `mutation 응답 ${elapsedMs}ms — ${
        isCold ? 'cold' : 'warm'
      } SLA ${threshold}ms 초과 (4/29 5초 latency 회귀 가능성). instrument 박고 phase 진단 필요.`
    ).toBeLessThan(threshold);

    // 6. 카드 표시 — DailyTimeline focus window (default 12h · [지금-1h, 지금+11h]) 안.
    //    PLAN1-FOCUS-VIEW-REDESIGN-20260506: WeeklyCalendar 폐기 → next-button 회피 영역 제거.
    //    default startAt = 현재 시각이라 항상 focus window 안.
    await expect(page.getByText(title).first()).toBeVisible({timeout: 5_000});

    // 7. cleanup — schedule 삭제 (orphan row 누적 차단)
    await page.getByText(title).first().click();
    const edit = dialogOf(page, '스케줄 편집');
    await expect(edit.heading).toBeVisible({timeout: 5_000});
    // PLAN1-FOCUS-VIEW-REDESIGN-V2 #15: 즉시 삭제 (deleteArmed 폐기 · 1차 click 만)
    await edit.dialog.getByRole('button', {name: '삭제', exact: true}).click();
    await expect(edit.heading).toBeHidden({timeout: SLA_COLD_MS});
    await expect(page.getByText(title)).toHaveCount(0, {timeout: 3_000});
  });
});
