/**
 * splitByWorkingHours — server TZ vs user TZ 충돌 회귀 catch
 *
 * 사고: 2026-05-04 prod 사용자 KST 입력 → 14:00 KST fall-back. root cause:
 *   - Vercel iad1 (UTC) + TZ env 부재 → server local TZ = UTC
 *   - lib/domain/split.ts 의 dateKeyOf·minutesOfDay·dayStartMs·addDaysMs 가
 *     server-local Date API 사용 (timezone-naive)
 *   - 사용자 KST 07:00 입력 ms = UTC 22:00 (전날) → server 가 dateKey 를
 *     UTC 전날로 잘못 lookup → wh miss → next-day wh.startMin fall-back
 *
 * 본 spec 은 옵션 D (vercel.json TZ=Asia/Seoul) 적용 전 red.
 * 옵션 D 적용 후 spec 1·2 green.
 * 옵션 A (user TZ aware) 적용 후 spec 3 (PST 사용자) 도 green.
 *
 * 환원 근거: tests/qa-gate/models/schedule-tz.txt § 1 timezone race triplet (3-way)
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {splitByWorkingHours} from './split';
import type {Schedule, WorkingHours} from './types';

function mkSchedule(id: string, startAt: number, durationMin: number): Schedule {
  return {
    id,
    title: id,
    categoryId: 'cat-default',
    startAt,
    durationMin,
    timerType: 'countup',
    status: 'pending',
    createdAt: 0,
    updatedAt: 0
  };
}

// 사용자 wall-clock 시각 (KST = UTC+9) → epoch ms 명시 변환
// system TZ 와 무관하게 정확한 ms 산출 — Date.UTC 후 KST offset 차감
function kstWallClockMs(y: number, m: number, d: number, h: number, mm = 0): number {
  return Date.UTC(y, m - 1, d, h - 9, mm, 0, 0);
}

// 같은 패턴 PST 사용자 (UTC-8)
function pstWallClockMs(y: number, m: number, d: number, h: number, mm = 0): number {
  return Date.UTC(y, m - 1, d, h + 8, mm, 0, 0);
}

const DEFAULT_WH = {startMin: 540, endMin: 1080}; // 09:00~18:00

describe('splitByWorkingHours — TZ race fall-back regression', () => {
  // 옵션 D 검증 — server TZ KST 강제 시 정상 처리
  // (vitest 실행 시점 process.env.TZ 가 결정. 옵션 D 적용 후 vercel.json TZ=Asia/Seoul)
  let originalTZ: string | undefined;

  beforeAll(() => {
    originalTZ = process.env.TZ;
    // 본 spec 은 server TZ KST 가정 — 옵션 D 박힌 prod 환경 시뮬
    process.env.TZ = 'Asia/Seoul';
  });

  afterAll(() => {
    if (originalTZ) process.env.TZ = originalTZ;
    else delete process.env.TZ;
  });

  it('1. KST 사용자 07:00 입력 → server TZ KST 일 때 startAt 변동 없음 (옵션 D 검증)', () => {
    const startAt = kstWallClockMs(2026, 5, 4, 7);
    const sched = mkSchedule('s-tz-1', startAt, 60);
    const result = splitByWorkingHours([sched], {}, DEFAULT_WH);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s-tz-1');
    // 사용자가 입력한 정확한 ms 가 그대로 — fall-back 없음
    expect(result[0].startAt).toBe(startAt);
    expect(result[0].splitFrom).toBeUndefined();
  });

  it('2. KST 사용자 06:00 + working hours 06:00-15:00 (custom) → fall-back 안 일어남', () => {
    const startAt = kstWallClockMs(2026, 5, 4, 6);
    const sched = mkSchedule('s-tz-2', startAt, 60);
    // 사용자가 KST 기준 5/4 wh 를 06:00-15:00 (custom) 으로 설정
    const wh: Record<string, WorkingHours> = {
      '2026-05-04': {date: '2026-05-04', startMin: 360, endMin: 900}
    };
    const result = splitByWorkingHours([sched], wh, {startMin: 360, endMin: 900});

    expect(result).toHaveLength(1);
    expect(result[0].startAt).toBe(startAt);
    expect(result[0].splitFrom).toBeUndefined();
  });

  it('3. PST 사용자 (옵션 A 후 통과) — server KST + user PST → user wall-clock 기준 처리', () => {
    // 사용자 PST 09:00 = UTC 17:00 = KST 02:00 (다음날)
    const startAt = pstWallClockMs(2026, 5, 4, 9);
    const sched = mkSchedule('s-tz-3', startAt, 60);
    const result = splitByWorkingHours([sched], {}, DEFAULT_WH);

    // 옵션 A 박기 전: server KST 기준 dateKey/minutesOfDay 처리 → KST 02:00 으로 인식 → wh miss → fall-back
    // 옵션 A 박은 후: user TZ 인자 받아 PST 기준 → 09:00 정상 처리 → fall-back 없음
    // 본 spec 은 옵션 A 검증용 — 현재는 fail 예상 (TODO: 옵션 A 박은 후 .skip 제거)
    expect(result).toHaveLength(1);
    expect(result[0].startAt).toBe(startAt);
  });

  it('4. day boundary KST 23:30 + 60min schedule → server TZ KST 시 day boundary 정확', () => {
    // KST 5/4 23:30 + 60min = KST 5/5 00:30
    // server TZ KST 시: dateKey = '2026-05-04' (시작 기준), minutesOfDay = 1410
    // wh.endMin = 1080 → endMin = 1470 > 1080 → split 유발
    // fittable = max(0, 1080 - 1410) = 0 → next day 9:00 으로 이동
    const startAt = kstWallClockMs(2026, 5, 4, 23, 30);
    const sched = mkSchedule('s-tz-4', startAt, 60);
    const result = splitByWorkingHours([sched], {}, DEFAULT_WH);

    // split 결과: original (시작 23:30 fittable 0 → 빈 part 안 남김) + part dayIndex=1 (5/5 09:00)
    // 검증: part 의 startAt 이 KST 5/5 09:00 ms 와 정확 일치
    const expectedNextDay = kstWallClockMs(2026, 5, 5, 9);
    const part = result.find(s => s.splitFrom === 's-tz-4');
    expect(part).toBeDefined();
    expect(part!.startAt).toBe(expectedNextDay);
  });
});
