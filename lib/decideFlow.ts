/**
 * PLAN1-TASKS-FEATURE-20260509 (Critical C1) — task → schedule 변환 분기 함수.
 *
 * 입력 검증 순서:
 * 1. categoryId null·undefined·"" → 'modal' reason='no-category'
 * 2. durationMin null·undefined·<=0 → 'modal' reason='no-duration'
 * 3. categoryId stale (categories list 안 일치 X) → 'modal' reason='stale-category'
 * 4. 정상 → 'atomic' (server action convertTaskToSchedule 호출)
 *
 * pure function · client/server 둘 다 사용 영역.
 */

export interface TaskInput {
  categoryId: string | null | undefined;
  durationMin: number | null | undefined;
}

export interface CategoryOwner {
  id: string;
}

export type FlowDecision =
  | {type: 'modal'; reason: 'no-category' | 'no-duration' | 'stale-category'}
  | {type: 'atomic'; categoryId: string; durationMin: number};

export function decideFlow(task: TaskInput, categories: CategoryOwner[]): FlowDecision {
  if (task.categoryId == null || task.categoryId === '') {
    return {type: 'modal', reason: 'no-category'};
  }
  if (task.durationMin == null || task.durationMin <= 0) {
    return {type: 'modal', reason: 'no-duration'};
  }
  const exists = categories.some(c => c.id === task.categoryId);
  if (!exists) {
    return {type: 'modal', reason: 'stale-category'};
  }
  return {type: 'atomic', categoryId: task.categoryId, durationMin: task.durationMin};
}