/**
 * DailyTimeline 집중 보기 모드 산식 (PLAN1-FOCUS-VIEW-FIX-20260505).
 *
 * 비대칭 [now-1h, now+(N-1)h] — 대장 명시 정합 (6시 + 4시간 → 5~9시).
 * 단위 spec 격리 위해 store/api chain 와 분리된 별 module.
 */

import {pad2} from './date-format';

export function minToTimeStr(min: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(min)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}:00`;
}

export function focusBounds(
  focusViewMin: number | null,
  nowMs: number
): {slotMinTime: string; slotMaxTime: string} {
  if (focusViewMin == null || focusViewMin <= 60 || nowMs <= 0) {
    return {slotMinTime: '00:00:00', slotMaxTime: '24:00:00'};
  }
  const now = new Date(nowMs);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = nowMin - 60;
  const endMin = nowMin + (focusViewMin - 60);
  return {slotMinTime: minToTimeStr(startMin), slotMaxTime: minToTimeStr(endMin)};
}
