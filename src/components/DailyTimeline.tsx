import { useMemo } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useAppStore } from '../domain/store'
import { schedulesToEvents } from '../lib/schedule-to-event'

function minToTimeStr(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, '0')
  const m = (min % 60).toString().padStart(2, '0')
  return `${h}:${m}:00`
}

function renderEventContent(arg: { event: { title: string; extendedProps: { splitFrom?: string } } }) {
  const isCont = !!arg.event.extendedProps?.splitFrom
  return (
    <div className="px-1 py-0.5 text-xs leading-tight whitespace-normal break-words">
      <span style={{ color: "#5c6370" }}>{isCont ? "▸▸ " : "▸ "}</span>{arg.event.title}
    </div>
  )
}

function todayKey(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function DailyTimeline({ onEventClick }: { onEventClick?: (id: string, splitFrom?: string) => void }) {
  const schedules = useAppStore((s) => s.schedules)
  const categories = useAppStore((s) => s.categories)
  const workingHours = useAppStore((s) => s.workingHours)
  const defaultWH = useAppStore((s) => s.settings.defaultWorkingHours)

  const key = todayKey()
  const wh = workingHours[key] ?? { date: key, startMin: defaultWH.startMin, endMin: defaultWH.endMin }
  const slotMinTime = minToTimeStr(wh.startMin)
  const slotMaxTime = minToTimeStr(wh.endMin)

  const events = useMemo(() => schedulesToEvents(schedules, categories), [schedules, categories])

  return (
    <div className="[&_.fc-event-title]:whitespace-normal [&_.fc-event-title]:break-words">
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
        locale="ko"
        slotMinTime={slotMinTime}
        slotMaxTime={slotMaxTime}
        nowIndicator
        allDaySlot={false}
        height="auto"
        events={events}
        editable
        eventClick={(arg) => onEventClick?.(arg.event.id, arg.event.extendedProps?.splitFrom as string | undefined)}
        eventContent={renderEventContent}
      />
    </div>
  )
}
