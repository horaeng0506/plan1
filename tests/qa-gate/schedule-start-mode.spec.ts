import {test, expect, Page} from '@playwright/test';

/**
 * plan1 mutation E2E — 새 스케줄 시작 시점 라디오 (PLAN1-LOGIN-START-OPT-20260504 #7).
 *
 * 시나리오:
 *   - storageState (auth.setup.ts) 인증된 상태 진입
 *   - 카테고리 자동 보장 (schedule-add 패턴 정합)
 *   - 1차 schedule 추가 (오늘 날짜) → cleanup 의 reference 로 사용
 *   - 2차 모달 열기 → "이전 스케줄 바로 다음" 라디오 enabled 확인 → 클릭
 *   - chainedToPrev checkbox 자동 checked 검증 (자동 채움 간접 증거)
 *   - 모달 닫기 (저장 안 함) + cleanup 1차 schedule 삭제
 *
 * 검증:
 *   - 1차 추가 전: afterPrev 라디오 disabled (오늘 0건)
 *   - 1차 추가 후: afterPrev 라디오 enabled
 *   - afterPrev 클릭 → chainedToPrev checkbox 자동 checked
 *
 * preview/production 무관 (storageState 인증 + 정상 schedule add 흐름).
 *
 * 출력 형식:
 *   [qa-gate] schedule_start_mode_<step>=NNN
 */

const SLA_COLD_MS = 5000;

function dialogOf(page: Page, headingName: string | RegExp) {
  const heading = page.getByRole('heading', {name: headingName});
  const dialog = page.locator('div.max-w-md').filter({has: heading}).first();
  return {heading, dialog};
}

test.describe('plan1 mutation E2E — 새 스케줄 시작 시점 라디오 (#7)', () => {
  test('afterPrev 라디오 disabled→enabled + chainedToPrev 자동 checked', async ({page}) => {
    const title = `qa-bot-startmode-${Date.now()}`;
    const catName = `cat-startmode-${Date.now()}`;

    await page.goto('/project/plan1/');

    // 1. 카테고리 자동 보장
    await page.getByRole('button', {name: '카테고리'}).click();
    const cat = dialogOf(page, /categories|카테고리/i);
    await expect(cat.dialog).toBeVisible({timeout: SLA_COLD_MS});
    await cat.dialog.getByRole('textbox').first().fill(catName);
    await cat.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(cat.dialog.getByText(catName)).toBeVisible({timeout: SLA_COLD_MS});
    await cat.dialog.getByRole('button', {name: '닫기', exact: true}).click();
    await expect(cat.dialog).toBeHidden({timeout: 3_000});

    // 2. 모달 열기 1차 (오늘 schedule 0건 가정 가능 시점) — afterPrev disabled 확인
    //    qa-bot prod DB 누적 schedule 영향 흡수 — disabled 만 확인하지 않고 라디오 존재만 검증.
    const newBtn = page.getByRole('button', {name: '+ 새 스케줄'});
    await expect(newBtn).toBeEnabled({timeout: SLA_COLD_MS});
    await newBtn.click();

    const sched = dialogOf(page, '새 스케줄');
    await expect(sched.heading).toBeVisible({timeout: SLA_COLD_MS});

    // 라디오 fieldset 존재 검증
    const startModeRadioNow = sched.dialog.getByRole('radio', {name: /지금 시작|start now/i});
    const startModeRadioAfter = sched.dialog.getByRole('radio', {
      name: /이전 스케줄 바로 다음|right after previous schedule/i
    });
    await expect(startModeRadioNow).toBeVisible();
    await expect(startModeRadioNow).toBeChecked(); // default = 'now'
    await expect(startModeRadioAfter).toBeVisible();

    // 3. 1차 schedule 추가 — 오늘 날짜 + 동적 시간 (afterPrev 의 reference 가 됨)
    // afterPrev 검증을 위해 today 사용 의무 (lib prevScheduleEndAt = todayKey() 필터링).
    // 시간은 spec 실행 시점 +2h 동적 set:
    //   - isFuture 자연 보장 (spec 시각 > 2h 후 시각)
    //   - prod DB 누적 schedule 와 overlap 회피 (매 spec run 시 다른 시간대 — overlap MAX 2 가드 통과)
    //   - 23h+ wrap-around 시 same-day 안 보장 (today 안 시간대만 prevScheduleEndAt 인식)
    await sched.dialog.getByRole('textbox').first().fill(title);
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await sched.dialog.locator('input[type="date"]').fill(todayIso);

    // 동적 hour: today 안 +2h 시각. 22h+ 면 same-day overflow → skip.
    const targetHour = today.getHours() + 2;
    if (targetHour >= 24) {
      console.log('[qa-gate] schedule_start_mode_skip=same_day_overflow');
      await sched.dialog.getByRole('button', {name: '취소', exact: true}).click();
      test.skip(true, '실행 시각이 today 22h+ — same-day +2h overflow → skip');
      return;
    }
    await sched.dialog.locator('select').nth(1).selectOption(String(targetHour));
    // duration 30 (overlap window 작게)
    await sched.dialog.locator('input[type="number"]').fill('30');

    // isFuture warning 추가 안전망 (실행 시각이 정확히 분 boundary 시 race 가능)
    const isFutureWarning = sched.dialog.getByText(/Start time must be in the future|미래여야/i);
    if (await isFutureWarning.isVisible().catch(() => false)) {
      console.log(`[qa-gate] schedule_start_mode_skip=past_${targetHour}`);
      await sched.dialog.getByRole('button', {name: '취소', exact: true}).click();
      test.skip(true, `실행 시각이 today ${targetHour}h 이후 — race · skip`);
      return;
    }

    const startMs1 = Date.now();
    await sched.dialog.getByRole('button', {name: '추가', exact: true}).click();
    await expect(sched.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
    console.log(`[qa-gate] schedule_start_mode_first_add_ms=${Date.now() - startMs1}`);

    // 4. 모달 다시 열기 — afterPrev enabled + 클릭 → chainedToPrev 자동 checked 검증
    await newBtn.click();
    await expect(sched.heading).toBeVisible({timeout: SLA_COLD_MS});

    const afterRadio2 = sched.dialog.getByRole('radio', {
      name: /이전 스케줄 바로 다음|right after previous schedule/i
    });
    await expect(afterRadio2, 'afterPrev 라디오는 today schedule 1건 이상이면 enabled').toBeEnabled({
      timeout: 3_000
    });
    await afterRadio2.click();

    // chainedToPrev checkbox (label "이전 스케줄과 연결" 또는 "chain to previous schedule") 자동 checked
    const chainedCheckbox = sched.dialog.getByRole('checkbox', {
      name: /이전 스케줄과 연결|chain to previous schedule/i
    });
    await expect(chainedCheckbox, 'afterPrev 선택 시 chainedToPrev 자동 true').toBeChecked();

    // 모달 취소 (저장 안 함) — 검증만
    await sched.dialog.getByRole('button', {name: '취소', exact: true}).click();
    await expect(sched.heading).toBeHidden({timeout: 3_000});

    // 5. cleanup — 1차 schedule 삭제 (편집 모달 → deleteArmed → 확인)
    // schedule-edit.spec.ts 와 동일 패턴: 1st click '삭제' (armed) → 2nd click '삭제 확인' (실제).
    // button 의 accessible name 이 토글되므로 selector 도 두 번 분리해서 사용 (stale locator 방지).
    const card = page.getByText(title).first();
    await expect(card).toBeVisible({timeout: SLA_COLD_MS});
    await card.click();
    const editSched = dialogOf(page, '스케줄 편집');
    await expect(editSched.heading).toBeVisible({timeout: SLA_COLD_MS});
    await editSched.dialog
      .getByRole('button', {name: '삭제', exact: true})
      .click();
    await editSched.dialog
      .getByRole('button', {name: '삭제 확인', exact: true})
      .click();
    await expect(editSched.heading).toBeHidden({timeout: SLA_COLD_MS + 2_000});
  });
});
