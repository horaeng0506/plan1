/**
 * DailyTimeline 집중 보기 모드 산식 (PLAN1-FOCUS-VIEW-REDESIGN-20260506).
 *
 * HOUR floor 산식 — 분 절삭 후 시간 단위 정렬:
 *   startMin = (h-1) * 60
 *   endMin   = startMin + focusViewMin
 * 9:35 + 4h → [8:00, 12:00] · 9:59 → [8:00, 12:00] · 10:00 → [9:00, 13:00] (자동 sliding)
 *
 * 자정 경계: clamp 1440 폐기 → 2880 (48h max). FullCalendar `slotMaxTime "26:00:00"`
 * 같은 24+ 값을 그대로 출력 → 같은 view 안에서 다음날 시각까지 연속 표시.
 * startMin 음수 (자정 직후 0:30 진입 시 h=0 → -60) 는 0 clamp.
 *
 * SSR/hydration 가드: nowMs <= 0 → 전체 보기 (00:00 ~ 24:00) fallback.
 * focusViewMin null 가드: 폐기 (null 옵션 사양 #3 폐기 · default 720). 단 store snapshot
 * 가 옛 null row 받을 수 있으므로 store.ts 가 720 fallback 박음.
 */

import {pad2} from './date-format';

export function minToTimeStr(min: number): string {
  const clamped = Math.max(0, Math.min(2880, Math.round(min)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}:00`;
}

export function focusBounds(
  focusViewMin: number,
  nowMs: number
): {slotMinTime: string; slotMaxTime: string} {
  if (nowMs <= 0) {
    return {slotMinTime: '00:00:00', slotMaxTime: '24:00:00'};
  }
  const now = new Date(nowMs);
  const h = now.getHours();
  let startMin = (h - 1) * 60;
  let endMin = startMin + focusViewMin;
  // 자정 직후 (h=0) startMin 음수 → 음수만큼 endMin 도 shift 해서 윈도우 길이 보존.
  // 0:30 + 4h: startMin=-60, endMin=180 → [0, 240] = 4h 보존 (이전 단순 clamp 시 3h 단축 결함)
  if (startMin < 0) {
    endMin -= startMin;
    startMin = 0;
  }
  return {slotMinTime: minToTimeStr(startMin), slotMaxTime: minToTimeStr(endMin)};
}
