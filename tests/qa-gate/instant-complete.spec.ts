import {test, expect, Page} from '@playwright/test';

/**
 * plan1 mutation E2E gate — A10 즉시 완료 (! complete · cascade 발동) — RPN 64 High
 *
 * 4/29 catch 영역 인접 (cascade 발동 mutation 경로 — A9 cascade-bump 와 같은 chain):
 *   - completeSchedule(active.id, Date.now()) — status='done' + cascade 가능
 *   - actualDurationMin 기록 + 다음 chained schedule 의 startAt shift 가능 (cascade)
 *
 * 시나리오 (PICT model `instant-complete.txt` happy path · during case · warm path):
 *   - schedule 1개 추가 — "지금" 시작 + duration 60min (active 윈도우 진입)
 *   - ActiveTimer 의 "complete" 버튼 클릭 → completeSchedule mutation
 *   - SLA (warm < 3000ms / cold < 5000ms)
 *   - cleanup: 완료된 schedule 삭제 (status='done' 도 카드 클릭 → 편집 모달 → 삭제 가능)
 *
 * 4/29 catch 차이 (다른 spec 과):
 *   - cascade-bump (A9): extendScheduleBy (durationMin 변경 → cascade)
 *   - **instant-complete (A10): completeSchedule (status='done' → cascade)**
 *   - 둘 다 cascade 영역이지만 mutation 경로 다름 (extend vs complete)
 *
 * SLA 측정 출력 형식:
 *   [qa-gate] instant_complete_ms=NNN cold=true|false
 */

const SLA_WARM_MS = 3000;
const SLA_COLD_MS = 5000;

function dialogOf(page: Page, headingName: string | RegExp) {
  const heading = page.getByRole('heading', {name: headingName});
  const dialog = page.locator('div.max-w-md').filter({has: heading}).first();
  return {heading, dialog};
}

test.describe('plan1 mutation E2E — A10 instant-complete (High · cascade 영역)', () => {
  test('schedule active (지금 시작) → complete 버튼 SLA + cleanup', async ({page}) => {
    const title = `qa-cmp-${Date.now()}`;
    const catName = `cat-cmp-${Date.now()}`;

    // 0. 진입 + clock fake (분 boundary race 회피 — cascade-bump.spec.ts 와 동일 패턴)
    //    4차 root cause (trace.zip 분석): clock.install default freeze → setInterval stop
    //      → useNow notify X → SSR snapshot 0 → ActiveTimer idle → complete 버튼 visible X
    //    Fix: clock 2초 fastForward → setInterval 첫 fire → re-render → active 인식
    // PLAN1-FOCUS-VIEW-REDESIGN-20260506: split 메커니즘 폐기 → working hours rollover 회피 영역 사라짐.
    // clock.install 은 분 boundary race 회피 + setInterval fire 안정화 위해 유지.
    const fixedTime = new Date();
    fixedTime.setUTCHours(12, 0, 0, 0);
    await page.clock.install({time: fixedTime});
    await page.goto('/project/plan1/');
    await page.clock.fastForward(2000);

    // 1. 카테고리 보장
    await page.getByRole('button', {name: '카테고리'}).click();
    const cat = dialogOf(page, /categories|카테고리/i);
    await expect(cat.dialog).toBeVisible({timeout: 5_000});
    await cat.dialog.getByRole('textbox').first().fill(catName);
    await cat.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(cat.dialog.getByText(catName)).toBeVisible({timeout: SLA_COLD_MS});
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});

    // 2. + 새 스케줄 — "지금" 시작 + duration 60min
    const newBtn = page.getByRole('button', {name: '+ 새 스케줄'});
    await expect(newBtn).toBeEnabled({timeout: 10_000});
    await newBtn.click();

    const sched = dialogOf(page, '새 스케줄');
    await expect(sched.heading).toBeVisible({timeout: 5_000});
    await sched.dialog.getByRole('textbox').first().fill(title);
    // PLAN1-FOCUS-VIEW-REDESIGN-20260506: $ now 버튼 폐기 · 시작 시각 자동 (모달 mount snapshot).
    await sched.dialog.locator('input[type="number"]').fill('60');
    await sched.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(sched.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    await expect(page.getByText(title).first()).toBeVisible({timeout: 5_000});

    // 3. ActiveTimer "complete" 버튼 표시 확인
    //    i18n timer.buttonComplete = "complete"
    const completeBtn = page.getByRole('button', {name: 'complete', exact: true});
    await expect(completeBtn).toBeVisible({timeout: 10_000});

    // 4. 측정: complete click → completeSchedule mutation → ActiveTimer idle 전환
    //    (active schedule 가 status='done' 으로 변경 → findActiveSchedules 결과 빈 배열 → idle 표시)
    const startMs = Date.now();
    await completeBtn.click();
    // mutation 완료 신호: ActiveTimer 가 idle 로 전환되거나 또는 다음 active 가 표시
    //    단순화: idle 메시지 (i18n timer.idleEmpty = "idle · 진행 중 스케줄 없음") 표시 또는
    //    complete 버튼 사라짐
    await expect(completeBtn).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    const elapsedMs = Date.now() - startMs;

    const isCold = elapsedMs > SLA_WARM_MS;
    const threshold = isCold ? SLA_COLD_MS : SLA_WARM_MS;
    console.log(
      `[qa-gate] instant_complete_ms=${elapsedMs} cold=${isCold} threshold=${threshold}`
    );

    // 5. SLA 게이트 (4/29 사고 catch 한도 보존)
    expect(
      elapsedMs,
      `completeSchedule mutation 응답 ${elapsedMs}ms — ${
        isCold ? 'cold' : 'warm'
      } SLA ${threshold}ms 초과. cascade chain shift × sequential await loop 영역 진단 필요.`
    ).toBeLessThan(threshold);

    // 6. cleanup — 완료된 schedule 삭제 (status='done' 도 카드 클릭 → 편집 모달 가능)
    await page.getByText(title).first().click();
    const edit = dialogOf(page, '스케줄 편집');
    await expect(edit.heading).toBeVisible({timeout: 5_000});
    // PLAN1-FOCUS-VIEW-REDESIGN-V2 #15: 즉시 삭제 (deleteArmed 폐기)
    await edit.dialog.getByRole('button', {name: '삭제', exact: true}).click();
    await expect(edit.heading).toBeHidden({timeout: SLA_COLD_MS});
    await expect(page.getByText(title)).toHaveCount(0, {timeout: 3_000});
  });
});
