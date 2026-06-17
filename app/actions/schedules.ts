'use server';

/**
 * 스케줄 CRUD + cascade server actions.
 *
 * A4-1 (2026-06-17): 비즈니스 로직을 `lib/server/schedule-core` 단일 코어로 통합 (정공법).
 *   - 이전: 자체 loadUserState·syncSchedules·rowToDomain·cascade 직접 호출 → 코어와 거의 복붙 중복.
 *   - 지금: 코어 *Core 함수 호출 + `WEB_GUARDS`(overlap·concurrency guard off) → **기존 웹 동작 불변**.
 *   - 코어의 `ApiError(code)` 는 `callCore` 어댑터가 `ServerActionError(i18n key)` 로 변환
 *     (정상 에러가 runAction catch-all 에서 error.unknown 으로 뭉개지는 것 차단).
 *   - guard 도입(동작 개선)은 A4-2 별도 사이클 (lock-out 사전 실측 + 클라 409 핸들링 + i18n).
 *
 * Stage 5.1 part 2: 사용자 facing error 는 ServerActionError 로 표면화 → runAction 이
 *   discriminated union return 으로 변환 (Next.js prod redact 회피).
 */

import {requireUser} from '@/lib/auth-helpers';
import {runAction, type ServerActionResult} from '@/lib/server-action';
import {callCore} from '@/lib/server/action-error-adapter';
import {
  createScheduleCore,
  updateScheduleCore,
  deleteScheduleCore,
  completeScheduleCore,
  insertScheduleBetweenCore,
  listSchedulesCore,
  WEB_GUARDS
} from '@/lib/server/schedule-core';
import type {Schedule} from '@/lib/domain/types';

export async function listSchedules(): Promise<ServerActionResult<Schedule[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => listSchedulesCore(user.id));
  });
}

export async function createSchedule(input: {
  title: string;
  categoryId: string;
  startAt: number;
  durationMin: number;
  timerType: 'countup' | 'timer1' | 'countdown';
  chainedToPrev?: boolean;
}): Promise<ServerActionResult<Schedule[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => createScheduleCore(user.id, input, WEB_GUARDS));
  });
}

// PLAN1-SCHEDULE-INSERT-BETWEEN-20260602 — 새 스케줄(A2)을 충돌 스케줄(B) 시작 위치에 "사이 삽입".
// 로직 단일 원천: lib/domain/insert-between (코어 insertScheduleBetweenCore 경유).
export async function insertScheduleBetween(input: {
  title: string;
  categoryId: string;
  durationMin: number;
  timerType: 'countup' | 'timer1' | 'countdown';
  conflictId: string;
  // 클라가 본 충돌 일정 시작시각 — server state 와 불일치 시 TOCTOU 거부 (코어가 검증).
  expectedConflictStart: number;
}): Promise<ServerActionResult<Schedule[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => insertScheduleBetweenCore(user.id, input, WEB_GUARDS));
  });
}

export async function updateSchedule(input: {
  id: string;
  startAt?: number;
  durationMin?: number;
  title?: string;
  categoryId?: string;
  timerType?: 'countup' | 'timer1' | 'countdown';
  chainedToPrev?: boolean;
}): Promise<ServerActionResult<Schedule[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => updateScheduleCore(user.id, input, WEB_GUARDS));
  });
}

export async function deleteSchedule(id: string): Promise<ServerActionResult<void>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => deleteScheduleCore(user.id, id));
  });
}

export async function completeSchedule(input: {
  id: string;
  completeAtMs: number;
}): Promise<ServerActionResult<Schedule[]>> {
  return runAction(async () => {
    const user = await requireUser();
    return callCore(() => completeScheduleCore(user.id, input, WEB_GUARDS));
  });
}
