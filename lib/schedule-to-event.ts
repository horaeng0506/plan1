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
    // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 (Q-NEW3 둘다): is-chained className 부활 — DailyTimeline chain 시각 위계.
    // chained=true schedule 만 top dashed border (앞 schedule 과 연결됨 시각 표식).
    // 사용자 unchecked schedule (chain 끊김) 은 표식 X — 시각 차이로 chain 그룹 인지.
    const classNames = [
      schedule.status === 'done' ? 'opacity-60' : '',
      schedule.chainedToPrev ? 'is-chained' : '',
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
      },
    }
  })
}
