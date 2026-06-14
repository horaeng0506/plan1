import {test, expect} from '@playwright/test';

/**
 * PLAN1-TASKS-FEATURE-20260509 — task → schedule 변환 분기 mutation E2E spec.
 *
 * 현재 흐름 (lib/decideFlow.ts + TaskList.handleConvertClick + PlanApp 정합):
 *   - "+ 스케줄" 클릭 시 decideFlow 로 분기 결정.
 *   - 분기 atomic (categoryId·durationMin valid + category 존재): task-item armed → "지금"/"마지막+10"/"취소"
 *     표시 → "지금" 클릭 시 즉시 변환(db.batch atomic · task 삭제 + schedule 생성).
 *   - 분기 modal (categoryId/durationMin 누락 또는 stale): onEditTask → TaskModal(edit)이 prefill 로 열림
 *     (누락 필드 보완 후 재변환 UX). ※ 옛 spec 은 NewScheduleModal 을 기대했으나 현재 코드는 TaskModal edit.
 *
 * QA-GATE-CONVFLOW-20260615: unique title + task-item 컨테이너 스코프 + decideFlow 현 흐름 정합 재작성.
 * 카테고리 select index 0 = placeholder("") 라 valid task 는 index 1(실제 category) 선택.
 */

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
  // index 0 은 placeholder("") — 실제 category 는 index 1.
  if (opts.pickCategory) await modal.getByLabel(/category|카테고리/i).selectOption({index: 1});
  const submitBtn = modal.getByRole('button', {name: /^add$|^추가$/i});
  await expect(submitBtn).toBeEnabled({timeout: 10_000});
  await submitBtn.click();
  await expect(page.getByText(title)).toBeVisible({timeout: 5000});
}

test.describe('task → schedule 분기 chain', () => {
  test('분기 atomic — 모든 필드 valid · "지금 시작" 즉시 변환', async ({page}) => {
    await page.goto('/project/plan1/');
    const title = `atomic-flow-${Date.now()}`;
    await createTask(page, title, {duration: '30', pickCategory: true});

    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i}).click();
    // valid → armed → "지금" 표시
    const startMs = Date.now();
    await taskItem.getByRole('button', {name: /now|지금/i}).click();

    // atomic chain: task-item 삭제(생성된 schedule 은 같은 title 이라 task-item 스코프로 확인)
    await expect(taskItem).toHaveCount(0, {timeout: 5000});
    await expect(page.getByText(title, {exact: false})).toBeVisible({timeout: 5000});
    const elapsedMs = Date.now() - startMs;
    expect(elapsedMs, `atomic chain SLA — got ${elapsedMs}ms`).toBeLessThan(3000);
  });

  test('분기 modal — durationMin 누락 · TaskModal(edit) prefill 호출', async ({page}) => {
    await page.goto('/project/plan1/');
    const title = `modal-dur-${Date.now()}`;
    await createTask(page, title, {pickCategory: true}); // duration 누락 → 분기 modal

    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i}).click();
    // invalid(no-duration) → +스케줄 즉시 TaskModal(edit) 열림 (지금 단계 없음)
    const editModal = page.getByTestId('task-modal');
    await expect(editModal).toBeVisible({timeout: 5000});
    // prefill — title 전달
    await expect(editModal.getByLabel(/title|제목/i)).toHaveValue(new RegExp(title));
  });

  test('분기 atomic — duration 있으면 category 미선택이어도 armed', async ({page}) => {
    // 실측(2026-06-15): category 미선택으로 생성해도 변환 가능(arm)해진다 → decideFlow
    // no-category→modal 분기는 생성 UI 로 도달 불가(modal 분기는 durationMin 누락 테스트가 커버).
    await page.goto('/project/plan1/');
    const title = `dur-only-${Date.now()}`;
    await createTask(page, title, {duration: '30'});

    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i}).click();
    // armed → "지금" 표시 (atomic 변환 가능)
    await expect(taskItem.getByRole('button', {name: /now|지금/i})).toBeVisible({timeout: 5000});
  });

  test('"취소" 클릭 → armed 해제 · task 유지', async ({page}) => {
    await page.goto('/project/plan1/');
    const title = `cancel-flow-${Date.now()}`;
    await createTask(page, title, {duration: '30', pickCategory: true}); // valid → armed 가능

    const taskItem = page.getByTestId(/task-item/).filter({hasText: title});
    await taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i}).click();
    // armed → "취소" 표시 → 클릭 시 해제
    await taskItem.getByRole('button', {name: /cancel|취소/i}).click();

    // task 유지 + 변형 버튼 미표시 + 원래 "+스케줄" 복귀
    await expect(page.getByText(title)).toBeVisible();
    await expect(taskItem.getByRole('button', {name: /now|지금/i})).toHaveCount(0);
    await expect(taskItem.getByRole('button', {name: /^\+ schedule$|^\+ 스케줄$/i})).toBeVisible();
  });
});
