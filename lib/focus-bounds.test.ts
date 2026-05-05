/**
 * DailyTimeline focusBounds 비대칭 산식 검증 (PLAN1-FOCUS-VIEW-FIX-20260505).
 *
 * 사고 회고: PR #50 (대칭 [now ± N/2]) 가 사용자 mental model 과 불일치 — 대장 명시
 * "지금 6시 + 4시간 → 5~9시" (= 비대칭 [now-1h, now+(N-1)h]).
 *
 * 산식: focusViewMin null 또는 ≤60 → 전체 (00:00-24:00). 그 외 [now-60, now+(N-60)] 분.
 */

import {describe, it, expect} from 'vitest';
import {focusBounds} from '@/lib/focus-bounds';

function ymdms(y: number, m: number, d: number, h: number, mm = 0): number {
  return new Date(y, m - 1, d, h, mm, 0, 0).getTime();
}

describe('DailyTimeline focusBounds — 비대칭 [now-1h, now+(N-1)h]', () => {
  const ms6 = ymdms(2026, 5, 5, 6);
  const ms7 = ymdms(2026, 5, 5, 7);
  const ms23h30 = ymdms(2026, 5, 5, 23, 30);
  const ms0h30 = ymdms(2026, 5, 5, 0, 30);

  it('1. focusViewMin null → 전체 (0~24h)', () => {
    expect(focusBounds(null, ms6)).toEqual({slotMinTime: '00:00:00', slotMaxTime: '24:00:00'});
  });

  it('2. focusViewMin ≤ 60 → 전체 (degenerate guard)', () => {
    expect(focusBounds(60, ms6)).toEqual({slotMinTime: '00:00:00', slotMaxTime: '24:00:00'});
    expect(focusBounds(0, ms6)).toEqual({slotMinTime: '00:00:00', slotMaxTime: '24:00:00'});
  });

  it('3. nowMs ≤ 0 (SSR/hydration 가드) → 전체', () => {
    expect(focusBounds(240, 0)).toEqual({slotMinTime: '00:00:00', slotMaxTime: '24:00:00'});
  });

  it('4. 대장 명시 — 6시 + 4시간(240) = 5~9시', () => {
    expect(focusBounds(240, ms6)).toEqual({slotMinTime: '05:00:00', slotMaxTime: '09:00:00'});
  });

  it('5. 6시 + 5시간(300) = 5~10시', () => {
    expect(focusBounds(300, ms6)).toEqual({slotMinTime: '05:00:00', slotMaxTime: '10:00:00'});
  });

  it('6. 6시 + 6시간(360) = 5~11시', () => {
    expect(focusBounds(360, ms6)).toEqual({slotMinTime: '05:00:00', slotMaxTime: '11:00:00'});
  });

  it('7. 6시 + 7시간(420) = 5~12시', () => {
    expect(focusBounds(420, ms6)).toEqual({slotMinTime: '05:00:00', slotMaxTime: '12:00:00'});
  });

  it('8. 6시 + 8시간(480) = 5~13시', () => {
    expect(focusBounds(480, ms6)).toEqual({slotMinTime: '05:00:00', slotMaxTime: '13:00:00'});
  });

  it('9. 7시 + 4시간(240) = 6~10시 (시간 흐름 자동 이동)', () => {
    expect(focusBounds(240, ms7)).toEqual({slotMinTime: '06:00:00', slotMaxTime: '10:00:00'});
  });

  it('10. 23:30 + 4시간(240) = 22:30~24:00 (clamp · slot 24h max)', () => {
    // now-60 = 22:30, now+180 = 26:30 → clamp 24:00
    expect(focusBounds(240, ms23h30)).toEqual({slotMinTime: '22:30:00', slotMaxTime: '24:00:00'});
  });

  it('11. 00:30 + 4시간(240) = 0:00~3:30 (clamp · slot 0 min)', () => {
    // now-60 = -30 → clamp 00:00, now+180 = 3:30
    expect(focusBounds(240, ms0h30)).toEqual({slotMinTime: '00:00:00', slotMaxTime: '03:30:00'});
  });
});
