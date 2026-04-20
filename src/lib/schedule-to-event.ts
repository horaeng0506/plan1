import type { EventInput } from '@fullcalendar/core'
import type { Schedule, Category } from '../domain/types'

export function schedulesToEvents(schedules: Schedule[], categories: Category[]): EventInput[] {
  const categoryMap = new Map(categories.map(category => [category.id, category]))
  return schedules.map(schedule => {
    const category = categoryMap.get(schedule.categoryId)
    const start = new Date(schedule.startAt)
    const end = new Date(start.getTime() + schedule.durationMin * 60_000)
    const accent = category?.color ?? '#5c6370'
    const classNames = [
      schedule.status === 'done' ? 'opacity-60' : '',
      schedule.splitFrom ? 'is-split-cont' : '',
    ].filter(Boolean)
    return {
      id: schedule.id,
      title: schedule.title,
      start,
      end,
      borderColor: accent,
      classNames,
      extendedProps: {
        categoryId: schedule.categoryId,
        timerType: schedule.timerType,
        status: schedule.status,
        splitFrom: schedule.splitFrom,
      },
    }
  })
}
