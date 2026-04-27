'use client';

import {useMemo} from 'react';
import {useLocale, useTranslations} from 'next-intl';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import {useAppStore} from '@/lib/store';
import {schedulesToEvents} from '@/lib/schedule-to-event';
import {renderEventContent} from './event-renderer';

function fcLocale(locale: string): string {
  return locale === 'zh-CN' ? 'zh-cn' : locale;
}

export function WeeklyCalendar({
  onEventClick
}: {
  onEventClick?: (id: string, splitFrom?: string) => void;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);
  const weekViewSpan = useAppStore(s => s.settings.weekViewSpan);
  const events = useMemo(() => schedulesToEvents(schedules, categories), [schedules, categories]);

  return (
    <div className="[&_.fc-event-title]:whitespace-normal [&_.fc-event-title]:break-words [&_.fc-daygrid-event]:whitespace-normal [&_.fc-daygrid-event-harness]:w-full">
      <FullCalendar
        key={`weekView${weekViewSpan}`}
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView={`weekView${weekViewSpan}`}
        headerToolbar={{left: 'prev,next today', center: 'title', right: ''}}
        locale={fcLocale(locale)}
        firstDay={1}
        height="auto"
        events={events}
        dayMaxEvents={false}
        editable={false}
        eventClick={arg =>
          onEventClick?.(arg.event.id, arg.event.extendedProps?.splitFrom as string | undefined)
        }
        eventContent={renderEventContent}
        views={{
          weekView1: {type: 'dayGrid', duration: {weeks: 1}, buttonText: t('nav.weekSpan1')},
          weekView2: {type: 'dayGrid', duration: {weeks: 2}, buttonText: t('nav.weekSpan2')},
          weekView3: {type: 'dayGrid', duration: {weeks: 3}, buttonText: t('nav.weekSpan3')}
        }}
      />
    </div>
  );
}
