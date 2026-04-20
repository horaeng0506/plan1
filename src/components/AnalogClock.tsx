import { useEffect, useMemo, useState } from 'react'
import { arc as d3Arc } from 'd3-shape'
import { useAppStore } from '../domain/store'

const SIZE = 280
const CENTER = SIZE / 2
const RADIUS_OUTER = 120
const RADIUS_TICK_INNER = 108
const RADIUS_ARC_OUTER = 104
const RADIUS_ARC_INNER = 72
const RADIUS_HAND = 100

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function minutesToRadians(min: number): number {
  return (min / 1440) * Math.PI * 2
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function AnalogClock() {
  const schedules = useAppStore((s) => s.schedules)
  const categories = useAppStore((s) => s.categories)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const categoryColor = useMemo(() => {
    const map = new Map<string, string>()
    categories.forEach((c) => map.set(c.id, c.color))
    return map
  }, [categories])

  const sectors = useMemo(() => {
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(todayStart)
    todayEnd.setDate(todayEnd.getDate() + 1)
    const arcGen = d3Arc<{ startMin: number; endMin: number; color: string; id: string }>()
      .innerRadius(RADIUS_ARC_INNER)
      .outerRadius(RADIUS_ARC_OUTER)
      .startAngle((d) => minutesToRadians(d.startMin))
      .endAngle((d) => minutesToRadians(d.endMin))
    return schedules
      .filter((s) => {
        const start = new Date(s.startAt)
        return isSameDay(start, now)
      })
      .map((s) => {
        const start = new Date(s.startAt)
        const startMin = minutesOfDay(start)
        const endMin = Math.min(startMin + s.durationMin, 1440)
        const color = categoryColor.get(s.categoryId) ?? '#6b7280'
        const d = arcGen({ startMin, endMin, color, id: s.id }) ?? ''
        return { id: s.id, d, color }
      })
  }, [schedules, now, categoryColor])

  const handAngle = minutesToRadians(minutesOfDay(now))
  const handX = CENTER + RADIUS_HAND * Math.sin(handAngle)
  const handY = CENTER - RADIUS_HAND * Math.cos(handAngle)

  const hourTicks: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  for (let h = 0; h < 24; h++) {
    const ang = minutesToRadians(h * 60)
    hourTicks.push({
      x1: CENTER + RADIUS_TICK_INNER * Math.sin(ang),
      y1: CENTER - RADIUS_TICK_INNER * Math.cos(ang),
      x2: CENTER + RADIUS_OUTER * Math.sin(ang),
      y2: CENTER - RADIUS_OUTER * Math.cos(ang),
    })
  }

  const hourLabels: Array<{ x: number; y: number; text: string }> = []
  for (const h of [0, 6, 12, 18]) {
    const ang = minutesToRadians(h * 60)
    hourLabels.push({
      x: CENTER + (RADIUS_TICK_INNER - 12) * Math.sin(ang),
      y: CENTER - (RADIUS_TICK_INNER - 12) * Math.cos(ang),
      text: String(h).padStart(2, '0'),
    })
  }

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} className="mx-auto">
      <g transform={`translate(0,0)`}>
        <circle cx={CENTER} cy={CENTER} r={RADIUS_OUTER} className="fill-white stroke-gray-300 dark:fill-gray-900 dark:stroke-gray-700" strokeWidth={2} />
        {hourTicks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="stroke-gray-400 dark:stroke-gray-600" strokeWidth={i % 6 === 0 ? 2 : 1} />
        ))}
        {hourLabels.map((l, i) => (
          <text key={i} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" className="fill-gray-600 dark:fill-gray-300 text-[11px]">{l.text}</text>
        ))}
        <g transform={`translate(${CENTER} ${CENTER})`}>
          {sectors.map((s) => (
            <path key={s.id} d={s.d} fill={s.color} opacity={0.85} />
          ))}
        </g>
        <line x1={CENTER} y1={CENTER} x2={handX} y2={handY} className="stroke-gray-900 dark:stroke-gray-100" strokeWidth={2} strokeLinecap="round" />
        <circle cx={CENTER} cy={CENTER} r={4} className="fill-gray-900 dark:fill-gray-100" />
      </g>
    </svg>
  )
}
