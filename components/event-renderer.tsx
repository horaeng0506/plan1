/**
 * FullCalendar eventContent 공유 renderer (simplify code-reuse 추출).
 *
 * Stage 4b prefix 제거 후 DailyTimeline/WeeklyCalendar 가 동일한 12줄 함수 복사.
 * 한 곳 정의 → 양쪽 import. .is-split-cont/.is-chained CSS 위계는 globals.css 가
 * lib/schedule-to-event.ts 에서 부여하는 className 으로 운반 — 본 함수는 title 만.
 */

export function renderEventContent(arg: {
  event: {title: string; extendedProps: {splitFrom?: string; chainedToPrev?: boolean}};
}) {
  return (
    <div className="px-1 py-0.5 text-xs leading-tight whitespace-normal break-words">
      {arg.event.title}
    </div>
  );
}
