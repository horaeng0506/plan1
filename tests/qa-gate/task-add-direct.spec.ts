import {test, expect} from '@playwright/test';

/**
 * PLAN1-TASKS-FEATURE-20260509 — task 직접 작성 chain mutation E2E spec.
 *
 * 영역 (PICT model `tests/qa-gate/models/task-flow.txt` 정합):
 *   1. task UI 영영 박힘 (TaskList sidebar AnalogClock 위 · Q26 a 정합)
 *   2. "new task" 버튼 → TaskModal 박힘 (Terminal 톤 단순 form)
 *   3. 제목·소요·카테고리 박음 (모두 nullable 영영 단순 form 박음)
 *   4. submit → task list 안 새 task 박음
 *   5. task 삭제 → 즉시 삭제 + undo bar 박음
 *
 * SLA 정합 (dev-process.md § mutation E2E 가드):
 *   - mutation 응답 시간 < 3000ms warm (4/29 사고 catch 한도)
 *
 * storageState reuse (auth.setup.ts 정합) — qa-bot 1회 sign-in.
 */

test.describe('task 직접 작성 chain', () => {
  test('TaskList 박힘 + new task 버튼 박힘 (Q26 a 정합)', async ({page}) => {
    await page.goto('/project/plan1/');
    // 본 사이클 task UI 박힘 catch — TaskList sidebar AnalogClock 위
    const taskList = page.getByTestId('task-list');
    await expect(taskList).toBeVisible({timeout: 10000});
    const newTaskButton = page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i});
    await expect(newTaskButton).toBeVisible();
  });

  test('new task 클릭 → TaskModal 박힘 (Terminal 톤 단순 form · 시간 영역 X)', async ({page}) => {
    await page.goto('/project/plan1/');
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    // TaskModal 박힘 — 제목·소요·카테고리 3 필드만 (시간 영역 X 정합)
    await expect(page.getByLabel(/title|제목/i)).toBeVisible();
    await expect(page.getByLabel(/duration|소요/i)).toBeVisible();
    await expect(page.getByLabel(/category|카테고리/i)).toBeVisible();
    // 시간 영역 박지 X (NewScheduleModal 와 다른 영영)
    await expect(page.getByLabel(/start|시작/i)).toHaveCount(0);
  });

  test('빈 task 추가 OK (모든 필드 nullable · b 영역 정합)', async ({page}) => {
    await page.goto('/project/plan1/');
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    // QA-GATE-TASKMODAL-SETTLE-20260615: 모달이 hydration 끝나 추가 버튼 enabled 될 때까지
    // 대기 후 스코프 클릭. 미대기 시 동적 모달 hydration 직후 빈 버킷 찰나에 추가 disabled race.
    const modal = page.getByTestId('task-modal');
    await expect(modal).toBeVisible({timeout: 10_000});
    const submitBtn = modal.getByRole('button', {name: /^add$|^추가$/i});
    await expect(submitBtn).toBeEnabled({timeout: 10_000}); // lazy 모달 form hydration 대기
    // SLA 측정은 모달 settle 이후(순수 mutation 구간)부터.
    const startMs = Date.now();
    await submitBtn.click();
    // task list 안 새 task 표시 (디폴트 title 정합)
    const taskItem = page.getByTestId(/task-item/).first();
    await expect(taskItem).toBeVisible({timeout: 5000});
    const elapsedMs = Date.now() - startMs;
    expect(elapsedMs, `mutation SLA — got ${elapsedMs}ms`).toBeLessThan(3000);
  });

  test('valid task 박음 (제목·소요·카테고리 모두 박음)', async ({page}) => {
    await page.goto('/project/plan1/');
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    const modal = page.getByTestId('task-modal');
    await expect(modal).toBeVisible({timeout: 10_000});
    // QA-GATE-UNIQUE-TITLE-20260615: 고정 title 은 공유 qa-bot 계정에 누적돼 strict-mode
    // 다중 매칭 → unique title 로 정확히 이번 생성분만 검증.
    const title = `valid-task-${Date.now()}`;
    await modal.getByLabel(/title|제목/i).fill(title);
    await modal.getByLabel(/duration|소요/i).fill('30');
    // 카테고리 = 첫 옵션 (디폴트 categories[0])
    await modal.getByLabel(/category|카테고리/i).selectOption({index: 0});
    const submitBtn = modal.getByRole('button', {name: /^add$|^추가$/i});
    await expect(submitBtn).toBeEnabled({timeout: 10_000}); // lazy 모달 form hydration 대기
    await submitBtn.click();
    // task list 안 표시 catch
    const taskItem = page.getByText(title);
    await expect(taskItem).toBeVisible({timeout: 5000});
  });

  test('task 삭제 → 즉시 삭제 + undo bar 박음 (Q19 정합)', async ({page}) => {
    await page.goto('/project/plan1/');
    // 사전 task 생성 (unique title — 누적 copy strict-match·toHaveCount 회귀 회피)
    const title = `to-delete-${Date.now()}`;
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    const modal = page.getByTestId('task-modal');
    await expect(modal).toBeVisible({timeout: 10_000});
    await modal.getByLabel(/title|제목/i).fill(title);
    const submitBtn = modal.getByRole('button', {name: /^add$|^추가$/i});
    await expect(submitBtn).toBeEnabled({timeout: 10_000}); // lazy 모달 form hydration 대기
    await submitBtn.click();
    await expect(page.getByText(title)).toBeVisible({timeout: 5000});
    // 삭제 버튼 클릭
    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /delete|삭제/i}).click();
    // 즉시 삭제 catch
    await expect(page.getByText(title)).toHaveCount(0, {timeout: 3000});
    // undo bar 박힘
    const undoBar = page.getByTestId('undo-bar');
    await expect(undoBar).toBeVisible({timeout: 5000});
  });

  test('"스케줄로 추가" 버튼 → 변형 chain (지금 시작 / 마지막 직후 / 취소)', async ({page}) => {
    await page.goto('/project/plan1/');
    // 사전 task 생성 (분기 1 — 모든 필드 valid · unique title)
    const title = `to-schedule-${Date.now()}`;
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    const modal = page.getByTestId('task-modal');
    await expect(modal).toBeVisible({timeout: 10_000});
    await modal.getByLabel(/title|제목/i).fill(title);
    await modal.getByLabel(/duration|소요/i).fill('30');
    await modal.getByLabel(/category|카테고리/i).selectOption({index: 0});
    const submitBtn = modal.getByRole('button', {name: /^add$|^추가$/i});
    await expect(submitBtn).toBeEnabled({timeout: 10_000}); // lazy 모달 form hydration 대기
    await submitBtn.click();
    await expect(page.getByText(title)).toBeVisible({timeout: 5000});
    // "스케줄로 추가" 클릭 → 변형 chain
    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i}).click();
    // 변형 chain — 지금 시작 / 마지막+10 / 취소 (마지막+10 은 활성 스케줄 있을 때만).
    // PLAN1-LAST-PLUS-10-20260531 — 라벨 "last+10" / "마지막+10".
    await expect(taskItem.getByRole('button', {name: /now|지금/i})).toBeVisible();
    await expect(taskItem.getByRole('button', {name: /cancel|취소/i})).toBeVisible();
  });
});
