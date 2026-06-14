import {test, expect} from '@playwright/test';

/**
 * PLAN1-TASKS-FEATURE-20260509 — task → schedule 변환 분기 mutation E2E spec.
 *
 * 영역 (PICT model `tests/qa-gate/models/task-flow.txt` 정합):
 *   - 분기 1 (atomic): title·durationMin·categoryId 모두 valid → "지금 시작" 즉시 schedule 추가 + task 삭제 (db.batch atomic)
 *   - 분기 2 (modal): 필드 누락 또는 stale FK → NewScheduleModal 호출 + prefill + 사용자 채우고 submit
 *
 * Critical C3 정합 — atomic chain (db.batch INSERT plan1Schedules + DELETE plan1Tasks WHERE userId AND id).
 *
 * QA-GATE-UNIQUE-TITLE-20260615: 고정 title 은 공유 qa-bot 계정에 누적돼 strict-mode 다중 매칭 →
 * unique title 로 이번 생성분만 검증. 생성은 task-modal 스코프 + 추가 버튼 enabled 대기(lazy hydration).
 */

// task 생성 공용 헬퍼 — title 입력 후 추가. duration/category 옵션.
async function createTask(
  page: import('@playwright/test').Page,
  title: string,
  opts: {duration?: string; pickCategory?: boolean} = {}
) {
  await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
  const modal = page.getByTestId('task-modal');
  await expect(modal).toBeVisible({timeout: 10_000});
  await modal.getByLabel(/title|제목/i).fill(title);
  if (opts.duration) await modal.getByLabel(/duration|소요/i).fill(opts.duration);
  if (opts.pickCategory) await modal.getByLabel(/category|카테고리/i).selectOption({index: 0});
  const submitBtn = modal.getByRole('button', {name: /^add$|^추가$/i});
  await expect(submitBtn).toBeEnabled({timeout: 10_000}); // lazy 모달 form hydration 대기
  await submitBtn.click();
  await expect(page.getByText(title)).toBeVisible({timeout: 5000});
}

test.describe('task → schedule 분기 chain', () => {
  test('분기 1 — 모든 필드 valid · "지금 시작" 즉시 atomic 추가', async ({page}) => {
    await page.goto('/project/plan1/');
    const title = `atomic-flow-${Date.now()}`;
    await createTask(page, title, {duration: '30', pickCategory: true});

    // "스케줄로 추가" 클릭 → 변형 chain
    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i}).click();

    // "지금 시작" 클릭 → atomic chain (NewScheduleModal 안 거침)
    const startMs = Date.now();
    await taskItem.getByRole('button', {name: /now|지금/i}).click();

    // task 자체 삭제 (atomic chain DELETE plan1Tasks)
    await expect(page.getByText(title)).toHaveCount(0, {timeout: 5000});

    // schedule 생성 (atomic chain INSERT plan1Schedules) — 같은 title 로 표시
    const newSchedule = page.getByText(title, {exact: false});
    await expect(newSchedule).toBeVisible({timeout: 5000});

    const elapsedMs = Date.now() - startMs;
    expect(elapsedMs, `atomic chain SLA — got ${elapsedMs}ms`).toBeLessThan(3000);

    // NewScheduleModal 미표시 (분기 1 정합)
    await expect(page.getByTestId('new-schedule-modal')).toHaveCount(0);
  });

  test('분기 2 — durationMin 누락 · NewScheduleModal 호출 + prefill', async ({page}) => {
    await page.goto('/project/plan1/');
    const title = `modal-flow-${Date.now()}`;
    // durationMin 미입력 → 분기 2
    await createTask(page, title, {pickCategory: true});

    // "스케줄로 추가" → "지금 시작" 클릭
    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i}).click();
    await taskItem.getByRole('button', {name: /now|지금/i}).click();

    // NewScheduleModal 표시 (분기 2 정합)
    const modal = page.getByTestId('new-schedule-modal').or(page.getByText(/new schedule|새 스케줄/i));
    await expect(modal).toBeVisible({timeout: 5000});

    // prefill 확인 — title 전달
    const titleInput = modal.getByLabel(/name|이름/i).or(modal.locator('input[type="text"]').first());
    await expect(titleInput).toHaveValue(new RegExp(title));
  });

  test('분기 2 — categoryId 누락 · NewScheduleModal 호출', async ({page}) => {
    await page.goto('/project/plan1/');
    const title = `no-cat-flow-${Date.now()}`;
    // categoryId 미선택 → 분기 2
    await createTask(page, title, {duration: '30'});

    // "스케줄로 추가" → "지금 시작" 클릭
    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i}).click();
    await taskItem.getByRole('button', {name: /now|지금/i}).click();

    // NewScheduleModal 표시 (분기 2 정합)
    const modal = page.getByTestId('new-schedule-modal').or(page.getByText(/new schedule|새 스케줄/i));
    await expect(modal).toBeVisible({timeout: 5000});
  });

  test('"취소" 클릭 → 변형 chain 미진행 · task 유지', async ({page}) => {
    await page.goto('/project/plan1/');
    const title = `cancel-flow-${Date.now()}`;
    await createTask(page, title);

    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i}).click();
    // "취소" 클릭 → 변형 chain 미진행
    await taskItem.getByRole('button', {name: /cancel|취소/i}).click();

    // task 유지
    await expect(page.getByText(title)).toBeVisible();
    // 변형 버튼 미표시
    await expect(taskItem.getByRole('button', {name: /now|지금/i})).toHaveCount(0);
    // 원래 버튼 표시 (스케줄로 + 삭제)
    await expect(taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i})).toBeVisible();
  });
});
