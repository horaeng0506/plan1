/**
 * 시작 시간 hour select 동적 옵션 (PLAN1-FOCUS-VIEW-REDESIGN-20260506).
 *
 * 사양 (Q14·Q37 정정):
 *   - 옵션 = 지금 시각 hour boundary 부터 향후 24h (24개)
 *   - 각 옵션 value = 해당 hour 의 절대 ms timestamp (라벨만 "today"/"tomorrow")
 *   - snapshot freeze: 모달 mount 시점 1회 capture · 모달 열린 채 자정 통과해도 사용자 의도 보존
 *   - 라벨에 isTomorrow 플래그로 i18n 키 매핑 (today vs tomorrow suffix)
 */

export interface HourOption {
  value: number;        // 절대 ms timestamp (해당 hour 의 :00)
  hourLabel: number;    // 0~23 (시계 표시용)
  isTomorrow: boolean;  // 라벨 today/tomorrow 분기
}

export function buildHourOptions(nowMs: number): HourOption[] {
  const now = new Date(nowMs);
  const baseHour = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    0,
    0,
    0
  ).getTime();
  const todayDate = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();

  const options: HourOption[] = [];
  for (let i = 0; i < 24; i++) {
    const ts = baseHour + i * 3600_000;
    const d = new Date(ts);
    const isTomorrow =
      d.getDate() !== todayDate ||
      d.getMonth() !== todayMonth ||
      d.getFullYear() !== todayYear;
    options.push({value: ts, hourLabel: d.getHours(), isTomorrow});
  }
  return options;
}

/**
 * 절대 ms 가 옵션 안 어느 hour boundary 인지 floor.
 * "마지막 스케줄 다음" 클릭 시 endAt → hourValue + minute 분리에 사용.
 */
export function floorToHourMs(ms: number): {hourMs: number; remainderMin: number} {
  const d = new Date(ms);
  const hourMs = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    0,
    0,
    0
  ).getTime();
  const remainderMin = Math.round((ms - hourMs) / 60_000);
  return {hourMs, remainderMin};
}
