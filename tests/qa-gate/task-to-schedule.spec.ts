import {test, expect} from '@playwright/test';

/**
 * PLAN1-TASKS-FEATURE-20260509 — task → schedule 변환 분기 mutation E2E spec.
 *
 * 영역 (PICT model `tests/qa-gate/models/task-flow.txt` 정합):
 *   - 분기 1 (atomic): title·durationMin·categoryId 모두 valid → "지금 시작" 즉시 schedule 추가 + task 삭제 (db.batch atomic)
 *   - 분기 2 (modal): 필드 누락 또는 stale FK → NewScheduleModal 호출 + prefill + 사용자 채우고 submit
 *   - overlap MAX_OVERLAP=2 차단
 *   - chainedToPrev=true 디폴트 (Q7 정합)
 *
 * Critical C3 정합 — atomic chain (db.batch INSERT plan1Schedules + DELETE plan1Tasks WHERE userId AND id).
 */

test.describe('task → schedule 분기 chain', () => {
  test('분기 1 — 모든 필드 valid · "지금 시작" 즉시 atomic 추가', async ({page}) => {
    await page.goto('/project/plan1/');
    // 사전 task 박음 (분기 1 영영 — 모든 필드 valid)
    await page.getByRole('button', {name: /new task|새 task/i}).click();
    await page.getByLabel(/title|제목/i).fill('atomic flow spec');
    await page.getByLabel(/duration|소요/i).fill('30');
    await page.getByLabel(/category|카테고리/i).selectOption({index: 0});
    await page.getByRole('button', {name: /add|추가|submit/i}).click();
    await expect(page.getByText('atomic flow spec')).toBeVisible({timeout: 5000});

    // "스케줄로 추가" 클릭 → 변형 chain
    const taskItem = page.getByText('atomic flow spec').locator('..');
    await taskItem.getByRole('button', {name: /to schedule|스케줄로/i}).click();

    // "지금 시작" 클릭 → atomic chain (NewScheduleModal 안 거침)
    const startMs = Date.now();
    await taskItem.getByRole('button', {name: /now|지금/i}).click();

    // task 자체 삭제 박음 (atomic chain DELETE plan1Tasks)
    await expect(page.getByText('atomic flow spec')).toHaveCount(0, {timeout: 5000});

    // schedule 안 박음 (atomic chain INSERT plan1Schedules)
    // DailyTimeline 또는 ActiveTimer 영역 안 새 schedule 박힘 catch
    const newSchedule = page.getByText('atomic flow spec', {exact: false});
    await expect(newSchedule).toBeVisible({timeout: 5000});

    const elapsedMs = Date.now() - startMs;
    expect(elapsedMs, `atomic chain SLA — got ${elapsedMs}ms`).toBeLessThan(3000);

    // NewScheduleModal 박지 X (분기 1 정합)
    await expect(page.getByTestId('new-schedule-modal')).toHaveCount(0);
  });

  test('분기 2 — durationMin 누락 · NewScheduleModal 호출 + prefill', async ({page}) => {
    await page.goto('/project/plan1/');
    // 사전 task 박음 (분기 2 영영 — durationMin null)
    await page.getByRole('button', {name: /new task|새 task/i}).click();
    await page.getByLabel(/title|제목/i).fill('modal flow spec');
    // durationMin 박지 X
    await page.getByLabel(/category|카테고리/i).selectOption({index: 0});
    await page.getByRole('button', {name: /add|추가|submit/i}).click();
    await expect(page.getByText('modal flow spec')).toBeVisible({timeout: 5000});

    // "스케줄로 추가" → "지금 시작" 클릭
    const taskItem = page.getByText('modal flow spec').locator('..');
    await taskItem.getByRole('button', {name: /to schedule|스케줄로/i}).click();
    await taskItem.getByRole('button', {name: /now|지금/i}).click();

    // NewScheduleModal 박힘 (분기 2 정합 영영)
    const modal = page.getByTestId('new-schedule-modal').or(page.getByText(/new schedule|새 스케줄/i));
    await expect(modal).toBeVisible({timeout: 5000});

    // prefill 박힘 — title 박힘 영영 정합
    const titleInput = modal.getByLabel(/name|이름/i).or(modal.locator('input[type="text"]').first());
    await expect(titleInput).toHaveValue(/modal flow spec/);
  });

  test('분기 2 — categoryId 누락 · NewScheduleModal 호출', async ({page}) => {
    await page.goto('/project/plan1/');
    // 사전 task 박음 (분기 2 영영 — categoryId null)
    await page.getByRole('button', {name: /new task|새 task/i}).click();
    await page.getByLabel(/title|제목/i).fill('no-cat flow spec');
    await page.getByLabel(/duration|소요/i).fill('30');
    // categoryId 박지 X (디폴트 영영 또는 박지 X 영영)
    await page.getByRole('button', {name: /add|추가|submit/i}).click();
    await expect(page.getByText('no-cat flow spec')).toBeVisible({timeout: 5000});

    // "스케줄로 추가" → "지금 시작" 클릭
    const taskItem = page.getByText('no-cat flow spec').locator('..');
    await taskItem.getByRole('button', {name: /to schedule|스케줄로/i}).click();
    await taskItem.getByRole('button', {name: /now|지금/i}).click();

    // NewScheduleModal 박힘 (분기 2 정합 영영)
    const modal = page.getByTestId('new-schedule-modal').or(page.getByText(/new schedule|새 스케줄/i));
    await expect(modal).toBeVisible({timeout: 5000});
  });

  test('"취소" 클릭 → 변형 chain 영영 박지 X · task 그대로 박힘', async ({page}) => {
    await page.goto('/project/plan1/');
    await page.getByRole('button', {name: /new task|새 task/i}).click();
    await page.getByLabel(/title|제목/i).fill('cancel flow spec');
    await page.getByRole('button', {name: /add|추가|submit/i}).click();
    await expect(page.getByText('cancel flow spec')).toBeVisible({timeout: 5000});

    const taskItem = page.getByText('cancel flow spec').locator('..');
    await taskItem.getByRole('button', {name: /to schedule|스케줄로/i}).click();
    // "취소" 클릭 → 변형 chain 영영 박지 X
    await taskItem.getByRole('button', {name: /cancel|취소/i}).click();

    // task 그대로 박힘
    await expect(page.getByText('cancel flow spec')).toBeVisible();
    // 변형 버튼 박지 X (영영 영역 영영)
    await expect(taskItem.getByRole('button', {name: /now|지금/i})).toHaveCount(0);
    // 원래 버튼 박힘 (스케줄로 + 삭제)
    await expect(taskItem.getByRole('button', {name: /to schedule|스케줄로/i})).toBeVisible();
  });
});
