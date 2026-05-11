import {test, expect} from '@playwright/test';

/**
 * PLAN1-TASKS-BUCKET-20260511 — bucket 분할 mutation E2E spec.
 *
 * 영역 (PICT model `tests/qa-gate/models/task-bucket.txt` 정합):
 *   1. 모달 bucket 드롭다운 박힘 (title 위 · 디폴트 'now')
 *   2. 두 bucket 별 group 분리 (당장 할일 / 나중 할일)
 *   3. row priority 숫자 prefix 표시 (예: "1. 제목")
 *   4. 나중 할일 디폴트 접힘 · 클릭 시 펼침
 *   5. bucket 변경 시 priority namespace 독립 (logic-critic C1·C2 catch)
 *   6. 시간 h:mm format 표시 (30→0:30 · 60→1:00)
 *
 * SLA 정합 (dev-process.md § mutation E2E 가드):
 *   - bucket 변경 mutation 응답 시간 < 3000ms warm (4/29 사고 catch 한도)
 *
 * storageState reuse (auth.setup.ts 정합) — qa-bot 1회 sign-in.
 */

test.describe('task bucket 분할 chain', () => {
  test('TaskModal bucket 드롭다운 박힘 + 디폴트 now', async ({page}) => {
    await page.goto('/project/plan1/');
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    const bucketSelect = page.getByLabel(/list|분류/i);
    await expect(bucketSelect).toBeVisible({timeout: 5000});
    await expect(bucketSelect).toHaveValue('now');
  });

  test('당장 할일 + 나중 할일 두 bucket task 추가 → 별 group 박힘', async ({page}) => {
    await page.goto('/project/plan1/');
    // 'now' bucket task 추가 (디폴트)
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    await page.getByLabel(/title|제목/i).fill('now-task spec');
    await page.getByLabel(/duration|소요/i).fill('30');
    await page.getByLabel(/category|카테고리/i).selectOption({index: 0});
    await page.getByRole('button', {name: /add|추가|submit/i}).click();
    await expect(page.getByText('now-task spec')).toBeVisible({timeout: 5000});

    // 'later' bucket task 추가
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    await page.getByLabel(/list|분류/i).selectOption('later');
    await page.getByLabel(/title|제목/i).fill('later-task spec');
    await page.getByLabel(/duration|소요/i).fill('60');
    await page.getByLabel(/category|카테고리/i).selectOption({index: 0});
    await page.getByRole('button', {name: /add|추가|submit/i}).click();

    // 당장 할일 group 안 'now-task spec' 박힘
    await expect(page.getByText('now-task spec')).toBeVisible();
    // 나중 할일 group 디폴트 접힘 → 'later-task spec' 안 보임
    await expect(page.getByText('later-task spec')).toHaveCount(0);
    // 나중 할일 toggle 클릭 → 펼침
    await page.getByRole('button', {name: /later|나중 할일/i}).click();
    await expect(page.getByText('later-task spec')).toBeVisible({timeout: 3000});
  });

  test('h:mm format 표시 (30→0:30 · 60→1:00)', async ({page}) => {
    await page.goto('/project/plan1/');
    // 30분 task 추가
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    await page.getByLabel(/title|제목/i).fill('hm-test-30');
    await page.getByLabel(/duration|소요/i).fill('30');
    await page.getByLabel(/category|카테고리/i).selectOption({index: 0});
    await page.getByRole('button', {name: /add|추가|submit/i}).click();
    // h:mm = "0:30" 표시 catch
    await expect(page.getByText('0:30').first()).toBeVisible({timeout: 5000});

    // 60분 task 추가
    await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
    await page.getByLabel(/title|제목/i).fill('hm-test-60');
    await page.getByLabel(/duration|소요/i).fill('60');
    await page.getByLabel(/category|카테고리/i).selectOption({index: 0});
    await page.getByRole('button', {name: /add|추가|submit/i}).click();
    await expect(page.getByText('1:00').first()).toBeVisible({timeout: 5000});
  });

  test('bucket 변경 mutation < 3000ms warm + priority namespace 독립 (C1·C2 catch)', async ({page}) => {
    await page.goto('/project/plan1/');
    // 'now' bucket 안 task 2개 추가 (priority 1·2 박힘)
    for (const title of ['ns-now-A', 'ns-now-B']) {
      await page.getByRole('button', {name: /^\+ task$|^\+ 할일$/i}).click();
      await page.getByLabel(/title|제목/i).fill(title);
      await page.getByLabel(/duration|소요/i).fill('30');
      await page.getByLabel(/category|카테고리/i).selectOption({index: 0});
      await page.getByRole('button', {name: /add|추가|submit/i}).click();
      await expect(page.getByText(title)).toBeVisible({timeout: 5000});
    }

    // 두 번째 task 클릭 → 편집 모달 → bucket 'later' 박음 → 저장 (SLA 측정)
    await page.getByText('ns-now-B').click();
    await expect(page.getByLabel(/list|분류/i)).toBeVisible({timeout: 3000});
    const startMs = Date.now();
    await page.getByLabel(/list|분류/i).selectOption('later');
    await page.getByRole('button', {name: /save|저장/i}).click();
    // 'ns-now-B' 가 당장 group 에서 빠짐 + 나중 group (접힘 상태) 안 박힘
    await expect(page.getByText('ns-now-B')).toHaveCount(0, {timeout: 5000});
    const elapsedMs = Date.now() - startMs;
    expect(elapsedMs, `bucket 변경 SLA — got ${elapsedMs}ms`).toBeLessThan(3000);

    // 'ns-now-A' priority 1 prefix 박힘 (단독 남음 영영)
    await expect(page.getByText('1.').first()).toBeVisible();

    // 나중 할일 펼침 → 'ns-now-B' priority 1 (새 bucket 첫 영역 박힘 영영)
    await page.getByRole('button', {name: /later|나중 할일/i}).click();
    await expect(page.getByText('ns-now-B')).toBeVisible({timeout: 3000});
  });
});
