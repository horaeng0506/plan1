/**
 * DailyTimeline focusBounds HOUR floor 산식 검증 (PLAN1-FOCUS-VIEW-REDESIGN-20260506).
 *
 * 사양 변경 (대장 결정 2026-05-05):
 *   - HOUR floor: startMin = (h-1)*60, endMin = startMin + focusViewMin
 *   - 분 절삭 — 9:35 + 4h → [8:00, 12:00] (이전 [8:35, 12:35] 부정확)
 *   - 자정 다음날까지 연속 view (clamp 1440 폐기 → 2880)
 *   - 옵션 [4·6·8·10·12·16·20·24h] · default 12h · null 폐기
 *
 * PICT 환원 (test-case-design-principles.md § 1.2):
 *   Variables — nowHour ∈ {0,6,9,12,17,21,23}, nowMinute ∈ {0,35,59}, focusViewMin ∈ {240,720,1440}
 *   2-way pairwise + BVA boundary (자정 직전·직후 · HOUR floor 분 절삭) + RPN Critical
 */

import {describe, it, expect} from 'vitest';
import {focusBounds, minToTimeStr} from '@/lib/focus-bounds';

function ymdms(y: number, m: number, d: number, h: number, mm = 0): number {
  return new Date(y, m - 1, d, h, mm, 0, 0).getTime();
}

describe('focusBounds — HOUR floor 산식', () => {
  // SSR/hydration 가드
  it('1. nowMs ≤ 0 (SSR snapshot) → 전체 (0~24h)', () => {
    expect(focusBounds(720, 0)).toMatchObject({slotMinTime: '00:00:00', slotMaxTime: '24:00:00'});
    expect(focusBounds(240, -1)).toMatchObject({slotMinTime: '00:00:00', slotMaxTime: '24:00:00'});
  });

  // 핵심 — HOUR floor 분 절삭 검증 (대장 명시 사양)
  it('2. 9:35 + 4h → [8:00, 12:00] (분 절삭)', () => {
    expect(focusBounds(240, ymdms(2026, 5, 6, 9, 35))).toMatchObject({
      slotMinTime: '08:00:00',
      slotMaxTime: '12:00:00'
    });
  });

  it('3. 9:00 + 4h → [8:00, 12:00] (분 0 — boundary)', () => {
    expect(focusBounds(240, ymdms(2026, 5, 6, 9, 0))).toMatchObject({
      slotMinTime: '08:00:00',
      slotMaxTime: '12:00:00'
    });
  });

  it('4. 9:59 + 4h → [8:00, 12:00] (분 59 — 같은 시간대 그대로)', () => {
    expect(focusBounds(240, ymdms(2026, 5, 6, 9, 59))).toMatchObject({
      slotMinTime: '08:00:00',
      slotMaxTime: '12:00:00'
    });
  });

  it('5. 10:00 + 4h → [9:00, 13:00] (sliding window 자동 이동)', () => {
    expect(focusBounds(240, ymdms(2026, 5, 6, 10, 0))).toMatchObject({
      slotMinTime: '09:00:00',
      slotMaxTime: '13:00:00'
    });
  });

  // 옵션 매트릭스 — 12시 기준 (PICT 2-way 핵심 케이스)
  it('6. 12:00 + 4h(240) → [11:00, 15:00]', () => {
    expect(focusBounds(240, ymdms(2026, 5, 6, 12))).toMatchObject({
      slotMinTime: '11:00:00',
      slotMaxTime: '15:00:00'
    });
  });

  it('7. 12:00 + 6h(360) → [11:00, 17:00]', () => {
    expect(focusBounds(360, ymdms(2026, 5, 6, 12))).toMatchObject({
      slotMinTime: '11:00:00',
      slotMaxTime: '17:00:00'
    });
  });

  it('8. 12:00 + 8h(480) → [11:00, 19:00]', () => {
    expect(focusBounds(480, ymdms(2026, 5, 6, 12))).toMatchObject({
      slotMinTime: '11:00:00',
      slotMaxTime: '19:00:00'
    });
  });

  it('9. 12:00 + 10h(600) → [11:00, 21:00]', () => {
    expect(focusBounds(600, ymdms(2026, 5, 6, 12))).toMatchObject({
      slotMinTime: '11:00:00',
      slotMaxTime: '21:00:00'
    });
  });

  it('10. 12:00 + 12h(720 default) → [11:00, 23:00]', () => {
    expect(focusBounds(720, ymdms(2026, 5, 6, 12))).toMatchObject({
      slotMinTime: '11:00:00',
      slotMaxTime: '23:00:00'
    });
  });

  it('11. 12:00 + 16h(960) → [11:00, 27:00] (다음날 03:00 영역)', () => {
    expect(focusBounds(960, ymdms(2026, 5, 6, 12))).toMatchObject({
      slotMinTime: '11:00:00',
      slotMaxTime: '27:00:00'
    });
  });

  it('12. 12:00 + 20h(1200) → [11:00, 31:00]', () => {
    expect(focusBounds(1200, ymdms(2026, 5, 6, 12))).toMatchObject({
      slotMinTime: '11:00:00',
      slotMaxTime: '31:00:00'
    });
  });

  it('13. 12:00 + 24h(1440 max) → [11:00, 35:00]', () => {
    expect(focusBounds(1440, ymdms(2026, 5, 6, 12))).toMatchObject({
      slotMinTime: '11:00:00',
      slotMaxTime: '35:00:00'
    });
  });

  // 자정 boundary BVA — 본 변경 핵심 (clamp 1440 폐기 검증)
  it('14. 21:40 + 12h(default) → [20:00, 32:00] (실측 보고 사례 · 자정 넘는 view)', () => {
    expect(focusBounds(720, ymdms(2026, 5, 6, 21, 40))).toMatchObject({
      slotMinTime: '20:00:00',
      slotMaxTime: '32:00:00'
    });
  });

  it('15. 23:30 + 12h → [22:00, 34:00] (다음날 10시까지 연속 view)', () => {
    expect(focusBounds(720, ymdms(2026, 5, 6, 23, 30))).toMatchObject({
      slotMinTime: '22:00:00',
      slotMaxTime: '34:00:00'
    });
  });

  it('16. 23:59 + 24h → [22:00, 46:00] (max range · 자정 직전)', () => {
    expect(focusBounds(1440, ymdms(2026, 5, 6, 23, 59))).toMatchObject({
      slotMinTime: '22:00:00',
      slotMaxTime: '46:00:00'
    });
  });

  it('17. 0:00 + 4h → [00:00, 04:00] (h=0 → startMin=-60 → clamp 0)', () => {
    expect(focusBounds(240, ymdms(2026, 5, 6, 0, 0))).toMatchObject({
      slotMinTime: '00:00:00',
      slotMaxTime: '04:00:00'
    });
  });

  it('18. 0:30 + 4h → [00:00, 04:00] (h=0 · 분 절삭 + startMin clamp 0)', () => {
    expect(focusBounds(240, ymdms(2026, 5, 6, 0, 30))).toMatchObject({
      slotMinTime: '00:00:00',
      slotMaxTime: '04:00:00'
    });
  });

  it('19. 1:00 + 4h → [00:00, 04:00] (h=1 → startMin=0 정확)', () => {
    expect(focusBounds(240, ymdms(2026, 5, 6, 1, 0))).toMatchObject({
      slotMinTime: '00:00:00',
      slotMaxTime: '04:00:00'
    });
  });

  // 옵션 sliding (시간 흐름 자동 이동) 추가 검증
  it('20. 17:30 + 8h → [16:00, 24:00] (24:00 boundary)', () => {
    expect(focusBounds(480, ymdms(2026, 5, 6, 17, 30))).toMatchObject({
      slotMinTime: '16:00:00',
      slotMaxTime: '24:00:00'
    });
  });
});

describe('minToTimeStr — clamp 0 ~ 2880 (48h max)', () => {
  it('21. 음수 → clamp 0 (00:00:00)', () => {
    expect(minToTimeStr(-60)).toBe('00:00:00');
    expect(minToTimeStr(-1)).toBe('00:00:00');
  });

  it('22. 1440 (24:00:00) — 자정 boundary 그대로 출력', () => {
    expect(minToTimeStr(1440)).toBe('24:00:00');
  });

  it('23. 1500 (25:00:00) — 다음날 새벽 1시 영역', () => {
    expect(minToTimeStr(1500)).toBe('25:00:00');
  });

  it('24. 2040 (34:00:00) — 다음날 오전 10시 영역 (23+11h)', () => {
    expect(minToTimeStr(2040)).toBe('34:00:00');
  });

  it('25. 2880 (48:00:00) — clamp max boundary', () => {
    expect(minToTimeStr(2880)).toBe('48:00:00');
  });

  it('26. 2881 → clamp 2880 (max 보호)', () => {
    expect(minToTimeStr(2881)).toBe('48:00:00');
    expect(minToTimeStr(99999)).toBe('48:00:00');
  });

  it('27. 분 단위 정밀 — 90 → 01:30:00', () => {
    expect(minToTimeStr(90)).toBe('01:30:00');
  });
});
