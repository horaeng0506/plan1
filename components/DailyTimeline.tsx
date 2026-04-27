'use client';

import {useMemo} from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {useAppStore} from '@/lib/store';
import {schedulesToEvents} from '@/lib/schedule-to-event';
import {pad2, todayKey} from '@/lib/date-format';
import {renderEventContent} from './event-renderer';

function minToTimeStr(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}:00`;
}

export function DailyTimeline({
  onEventClick
}: {
  onEventClick?: (id: string, splitFrom?: string) => void;
}) {
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);
  const workingHours = useAppStore(s => s.workingHours);
  const defaultWH = useAppStore(s => s.settings.defaultWorkingHours);

  const key = todayKey();
  const wh = workingHours[key] ?? {date: key, startMin: defaultWH.startMin, endMin: defaultWH.endMin};
  const slotMinTime = minToTimeStr(wh.startMin);
  const slotMaxTime = minToTimeStr(wh.endMin);

  const events = useMemo(() => schedulesToEvents(schedules, categories), [schedules, categories]);

  return (
    <div className="[&_.fc-event-title]:whitespace-normal [&_.fc-event-title]:break-words">
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        headerToolbar={{left: 'prev,next today', center: 'title', right: ''}}
        locale="ko"
        slotMinTime={slotMinTime}
        slotMaxTime={slotMaxTime}
        nowIndicator
        allDaySlot={false}
        height="auto"
        events={events}
        editable={false}
        eventClick={arg =>
          onEventClick?.(arg.event.id, arg.event.extendedProps?.splitFrom as string | undefined)
        }
        eventContent={renderEventContent}
      />
    </div>
  );
}
