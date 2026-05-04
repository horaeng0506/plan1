'use client';

import {useMemo} from 'react';
import {useLocale} from 'next-intl';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {useAppStore} from '@/lib/store';
import {schedulesToEvents} from '@/lib/schedule-to-event';
import {pad2} from '@/lib/date-format';
import {useNow} from '@/lib/now';
import {renderEventContent} from './event-renderer';

function minToTimeStr(min: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(min)));
  return `${pad2(Math.floor(clamped / 60))}:${pad2(clamped % 60)}:00`;
}

// next-intl `zh-CN` → FullCalendar `zh-cn`.
function fcLocale(locale: string): string {
  return locale === 'zh-CN' ? 'zh-cn' : locale;
}

export function DailyTimeline({
  onEventClick
}: {
  onEventClick?: (id: string, splitFrom?: string) => void;
}) {
  const locale = useLocale();
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);
  // PLAN1-WH-FOCUS-20260504 — workingHours 폐기 + 집중 보기 모드.
  // focusViewMin null = 0~24h 전체. 값 N 일 때 [now-N/2, now+N/2] 구간 (분 단위).
  const focusViewMin = useAppStore(s => s.settings.focusViewMin);

  const nowMs = useNow();

  const {slotMinTime, slotMaxTime} = useMemo(() => {
    if (focusViewMin == null || focusViewMin <= 0 || nowMs <= 0) {
      return {slotMinTime: '00:00:00', slotMaxTime: '24:00:00'};
    }
    const now = new Date(nowMs);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const half = Math.floor(focusViewMin / 2);
    const startMin = nowMin - half;
    const endMin = nowMin + (focusViewMin - half);
    return {slotMinTime: minToTimeStr(startMin), slotMaxTime: minToTimeStr(endMin)};
  }, [focusViewMin, nowMs]);

  const events = useMemo(() => schedulesToEvents(schedules, categories), [schedules, categories]);

  return (
    <div className="[&_.fc-event-title]:whitespace-normal [&_.fc-event-title]:break-words">
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        headerToolbar={{left: 'prev,next today', center: 'title', right: ''}}
        locale={fcLocale(locale)}
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
