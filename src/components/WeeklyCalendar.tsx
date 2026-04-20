import { useEffect, useMemo, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useAppStore } from '../domain/store'
import { schedulesToEvents } from '../lib/schedule-to-event'

function renderEventContent(arg: { event: { title: string } }) {
  return (
    <div className="px-1 py-0.5 text-xs leading-tight whitespace-normal break-words">
      <span style={{ color: "#5c6370" }}>▸ </span>{arg.event.title}
    </div>
  )
}

export function WeeklyCalendar() {
  const schedules = useAppStore((s) => s.schedules)
  const categories = useAppStore((s) => s.categories)
  const weekViewSpan = useAppStore((s) => s.settings.weekViewSpan)
  const events = useMemo(() => schedulesToEvents(schedules, categories), [schedules, categories])
  const calendarRef = useRef<FullCalendar>(null)

  useEffect(() => {
    calendarRef.current?.getApi().changeView(`weekView${weekViewSpan}`)
  }, [weekViewSpan])

  return (
    <div className="[&_.fc-event-title]:whitespace-normal [&_.fc-event-title]:break-words [&_.fc-daygrid-event]:whitespace-normal [&_.fc-daygrid-event-harness]:w-full">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView={`weekView${weekViewSpan}`}
        headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
        locale="ko"
        firstDay={1}
        height="auto"
        events={events}
        dayMaxEvents={false}
        editable={true}
        eventContent={renderEventContent}
        views={{
          weekView1: { type: 'dayGrid', duration: { weeks: 1 }, buttonText: '1주' },
          weekView2: { type: 'dayGrid', duration: { weeks: 2 }, buttonText: '2주' },
          weekView3: { type: 'dayGrid', duration: { weeks: 3 }, buttonText: '3주' },
        }}
      />
    </div>
  )
}
