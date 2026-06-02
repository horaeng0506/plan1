'use server';

/**
 * PLAN1-INIT-CONSOLIDATE-20260602 — 앱 초기 로드 통합 server action.
 *
 * 배경 (성능 진단 2026-06-02): store.init() 이 6개 server action(listSchedules·
 * listCategories·getSettings·listTasks·listTaskBuckets·listDateMarks)을 Promise.all
 * 로 호출했으나, Next.js 는 server action 을 클라이언트에서 순차(sequential) 처리한다
 * (의도된 설계 · vercel/next.js#69265). 사용자(한국)↔서버(sin1) RTT 가 6번 직렬로 쌓여
 * 초기 로드가 느렸다.
 *
 * 정공: 단일 initApp() 1요청으로 통합. 클라↔서버 POST 6→1 (사용자 RTT 직격).
 * 서버 내부에서는 기존 6 함수를 Promise.all 로 호출 — 서버↔Neon 은 같은 region(sin1↔
 * ap-southeast-1)이라 병렬 query RTT 가 작다. 기존 함수의 seed/upsert 로직을 그대로
 * 재사용해 회귀 위험을 최소화 (각 함수 내부 requireUser 는 같은 서버 프로세스 안 호출 ·
 * JWKS 모듈 캐시 재사용이라 JWT verify CPU 비용만 발생, 네트워크 왕복 아님).
 */

import {listSchedules} from './schedules';
import {listCategories} from './categories';
import {getSettings} from './settings';
import {listTasks} from './tasks';
import {listTaskBuckets} from './task-buckets';
import {listDateMarks} from './date-marks';
import {
  runAction,
  unwrapServerActionResult as unwrap,
  type ServerActionResult
} from '@/lib/server-action';
import type {InitData} from '@/lib/domain/types';

export async function initApp(): Promise<ServerActionResult<InitData>> {
  return runAction(async () => {
    const [schedulesR, categoriesR, settingsR, tasksR, bucketsR, dateMarksR] = await Promise.all([
      listSchedules(),
      listCategories(),
      getSettings(),
      listTasks(),
      listTaskBuckets(),
      listDateMarks()
    ]);
    // 하나라도 실패(unauthorized 등)면 unwrap 이 throw → runAction 이 errorKey 로 전파.
    return {
      schedules: unwrap(schedulesR),
      categories: unwrap(categoriesR),
      settings: unwrap(settingsR),
      tasks: unwrap(tasksR),
      taskBuckets: unwrap(bucketsR),
      dateMarks: unwrap(dateMarksR)
    };
  });
}
