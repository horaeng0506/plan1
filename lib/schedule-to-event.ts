import type { EventInput } from '@fullcalendar/core'
import type { Schedule, Category } from './domain/types'

function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * PLAN1-FOCUS-VIEW-V2-20260506 (Q-NEW3 둘다 — 큰 박스 패턴 · 대장 명시 2026-05-06):
 * chain group 검색 — chained=true 연속 schedule 들의 시간 범위.
 * 결과 = 각 group 의 시작·끝 시각. group 안 schedule 2개+ 만 (단독 schedule 그룹화 의미 X).
 * FullCalendar background event 로 큰 외곽 박스 표시.
 */
export function findChainGroups(
  schedules: Schedule[]
): Array<{startAt: number; endAt: number}> {
  const sorted = schedules
    .filter(s => s.status !== 'done')
    .slice()
    .sort((a, b) => a.startAt - b.startAt)
  const groups: Array<{startAt: number; endAt: number}> = []
  let groupStart: number | null = null
  let groupEnd: number | null = null
  let chainSize = 0
  for (const s of sorted) {
    const end = s.startAt + s.durationMin * 60_000
    if (s.chainedToPrev && groupStart !== null) {
      groupEnd = Math.max(groupEnd ?? end, end)
      chainSize++
    } else {
      if (chainSize >= 2 && groupStart !== null && groupEnd !== null) {
        groups.push({startAt: groupStart, endAt: groupEnd})
      }
      groupStart = s.startAt
      groupEnd = end
      chainSize = 1
    }
  }
  if (chainSize >= 2 && groupStart !== null && groupEnd !== null) {
    groups.push({startAt: groupStart, endAt: groupEnd})
  }
  return groups
}

/**
 * chain group 들을 FullCalendar background event 로 변환 — 큰 외곽 박스 시각화.
 * display='background' 는 schedule 카드 뒤 영역에 색상 + border 표시 (chained 카드들 묶음).
 */
export function chainGroupsToBackgroundEvents(
  schedules: Schedule[]
): EventInput[] {
  return findChainGroups(schedules).map((g, i) => ({
    id: `chain-group-${i}`,
    start: new Date(g.startAt),
    end: new Date(g.endAt),
    display: 'background',
    classNames: ['chain-group-box']
  }))
}

export function schedulesToEvents(schedules: Schedule[], categories: Category[]): EventInput[] {
  const categoryMap = new Map(categories.map(category => [category.id, category]))
  return schedules.map(schedule => {
    const category = categoryMap.get(schedule.categoryId)
    const start = new Date(schedule.startAt)
    const end = new Date(start.getTime() + schedule.durationMin * 60_000)
    const accent = category?.color ?? '#5c6370'
    // PLAN1-FOCUS-VIEW-V2-20260506 (대장 명시 — 큰 박스 패턴 채택):
    // is-chained className (작은 dashed top border) 폐기 → chainGroupsToBackgroundEvents 큰 외곽 박스로 대체.
    const classNames = [
      schedule.status === 'done' ? 'opacity-60' : '',
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
