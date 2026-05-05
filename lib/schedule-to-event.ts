import type { EventInput } from '@fullcalendar/core'
import type { Schedule, Category } from './domain/types'

function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function schedulesToEvents(schedules: Schedule[], categories: Category[]): EventInput[] {
  const categoryMap = new Map(categories.map(category => [category.id, category]))
  return schedules.map(schedule => {
    const category = categoryMap.get(schedule.categoryId)
    const start = new Date(schedule.startAt)
    const end = new Date(start.getTime() + schedule.durationMin * 60_000)
    const accent = category?.color ?? '#5c6370'
    // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q24): is-chained className 폐기 (chained 디폴트 true 후 의미 없음).
    const classNames = [
      schedule.status === 'done' ? 'opacity-60' : '',
      schedule.splitFrom ? 'is-split-cont' : '',
    ].filter(Boolean)
    return {
      id: schedule.id,
      title: schedule.title,
      start,
      end,
      backgroundColor: tint(accent, 0.18),
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
