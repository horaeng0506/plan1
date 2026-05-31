import {test, expect} from '@playwright/test';

/**
 * PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 할일 카테고리(버킷) 커스터마이징 + 횟수차감 mutation E2E.
 *
 * 영역:
 *   1. 관리 버튼 → 버킷 관리 모달 + 새 버킷 추가 (횟수차감형 체크)
 *   2. 추가한 버킷이 TaskModal 드롭다운에 표시
 *   3. 횟수차감형 task 생성 → 목록에 [n] 표시
 *   4. 횟수차감형 변환("지금 시작") → task 유지 + count 1 감소 (logic-critic 핵심 catch)
 *
 * SLA (dev-process.md § mutation E2E 가드): mutation < 3000ms warm.
 * storageState reuse (auth.setup.ts) — qa-bot 1회 sign-in.
 */

test.describe('task bucket 커스터마이징 + 횟수차감', () => {
  test('관리 → 횟수차감형 버킷 추가 → TaskModal 드롭다운 표시', async ({page}) => {
    const tag = Date.now();
    const bucketName = `cnt-bkt-${tag}`;
    await page.goto('/project/plan1/');

    // 관리 버튼 → 버킷 관리 모달
    await page.getByTestId('task-manage-button').click();
    const mgr = page.getByTestId('task-bucket-manager');
    await expect(mgr).toBeVisible({timeout: 5000});

    // 새 버킷 추가 (횟수차감형 체크)
    await mgr.getByPlaceholder(/name|이름/i).fill(bucketName);
    await mgr.getByRole('checkbox').last().check();
    await mgr.getByRole('button', {name: /^add$|^추가$/i}).click();
    // add 성공 시 TaskBucketManager 가 add 입력을 clear → toHaveValue('') 로 추가 완료 검증
    // (버킷 이름은 편집 가능한 input value 로 렌더되어 getByText 로 못 찾음).
    await expect(mgr.getByPlaceholder(/name|이름/i)).toHaveValue('', {timeout: 5000});

    // 모달 닫기
    await mgr.getByRole('button', {name: /close|닫기/i}).click();

    // TaskModal 드롭다운에 새 버킷 표시
    await page.getByTestId('task-new-button').click();
    const modal = page.getByTestId('task-modal');
    await expect(modal).toBeVisible({timeout: 5000});
    await expect(modal.getByLabel(/list|분류/i).locator('option', {hasText: bucketName})).toHaveCount(1);
  });

  test('횟수차감형 task → [n] 표시 + 변환 시 count 감소 + task 유지', async ({page}) => {
    const tag = Date.now();
    const bucketName = `cnt-bkt2-${tag}`;
    const taskTitle = `cnt-task-${tag}`;
    await page.goto('/project/plan1/');

    // 횟수차감형 버킷 추가
    await page.getByTestId('task-manage-button').click();
    const mgr = page.getByTestId('task-bucket-manager');
    await expect(mgr).toBeVisible({timeout: 5000});
    await mgr.getByPlaceholder(/name|이름/i).fill(bucketName);
    await mgr.getByRole('checkbox').last().check();
    await mgr.getByRole('button', {name: /^add$|^추가$/i}).click();
    // add 성공 시 TaskBucketManager 가 add 입력을 clear → toHaveValue('') 로 추가 완료 검증
    // (버킷 이름은 편집 가능한 input value 로 렌더되어 getByText 로 못 찾음).
    await expect(mgr.getByPlaceholder(/name|이름/i)).toHaveValue('', {timeout: 5000});
    await mgr.getByRole('button', {name: /close|닫기/i}).click();

    // 횟수차감형 task 생성 (count=3 · category·duration 필수)
    await page.getByTestId('task-new-button').click();
    const modal = page.getByTestId('task-modal');
    await modal.getByLabel(/list|분류/i).selectOption({label: bucketName});
    await modal.getByLabel(/title|제목/i).fill(taskTitle);
    await modal.getByLabel(/count|횟수/i).fill('3');
    await modal.getByLabel(/duration|소요/i).fill('30');
    await modal.getByLabel(/category|카테고리/i).selectOption({index: 0});
    await modal.getByRole('button', {name: /add|추가|submit/i}).click();

    // 목록에 [3] 표시
    const row = page.locator('[data-testid^="task-item-"]', {hasText: taskTitle});
    await expect(row).toBeVisible({timeout: 5000});
    await expect(row).toContainText('[3]');

    // 변환("지금 시작") → task 유지 + [2]
    const startMs = Date.now();
    await row.getByRole('button', {name: /\+ schedule|\+ 스케줄|schedule/i}).first().click();
    await row.getByRole('button', {name: /now|지금/i}).click();
    // 횟수차감형은 task 가 남아있고 count 만 감소.
    await expect(row).toContainText('[2]', {timeout: 5000});
    const elapsedMs = Date.now() - startMs;
    expect(elapsedMs, `count-decrement SLA — got ${elapsedMs}ms`).toBeLessThan(3000);
  });
});
