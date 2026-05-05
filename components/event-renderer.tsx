/**
 * FullCalendar eventContent 공유 renderer.
 *
 * Stage 4b prefix 제거 후 DailyTimeline 재사용. 본 함수는 title 만 렌더.
 * PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q24): is-chained className 폐기 (디폴트 true 후 의미 X).
 */

export function renderEventContent(arg: {
  event: {title: string; extendedProps: {splitFrom?: string}};
}) {
  return (
    <div className="px-1 py-0.5 text-xs leading-tight whitespace-normal break-words">
      {arg.event.title}
    </div>
  );
}
