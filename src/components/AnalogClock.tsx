import { useEffect, useMemo, useState } from 'react'
import { arc as d3Arc } from 'd3-shape'
import { useAppStore } from '../domain/store'

const SIZE = 260
const CENTER = SIZE / 2
const RADIUS_OUTER = 115
const RADIUS_TICK_INNER = 104
const RADIUS_SECTOR = 95
const RADIUS_HOUR_HAND = 55
const RADIUS_MINUTE_HAND = 85

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

function minutes12ToRadians(min: number): number {
  return ((min % 720) / 720) * Math.PI * 2
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function AnalogClock() {
  const schedules = useAppStore((s) => s.schedules)
  const categories = useAppStore((s) => s.categories)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const categoryColor = useMemo(() => {
    const map = new Map<string, string>()
    categories.forEach((c) => map.set(c.id, c.color))
    return map
  }, [categories])

  const sectors = useMemo(() => {
    const arcGen = d3Arc<{ startMin: number; endMin: number; color: string; id: string; opacity: number }>()
      .innerRadius(0)
      .outerRadius(RADIUS_SECTOR)
      .startAngle((d) => minutes12ToRadians(d.startMin))
      .endAngle((d) => minutes12ToRadians(d.endMin))
    return schedules
      .filter((s) => {
        if (s.status === 'done') return false
        const start = new Date(s.startAt)
        return isSameDay(start, now)
      })
      .map((s) => {
        const start = new Date(s.startAt)
        const startMin = start.getHours() * 60 + start.getMinutes()
        const endMin = Math.min(startMin + s.durationMin, 1440)
        const isPM = startMin >= 720
        const opacity = isPM ? 0.85 : 0.55
        const color = categoryColor.get(s.categoryId) ?? '#5c6370'
        const d = arcGen({ startMin, endMin, color, id: s.id, opacity }) ?? ''
        return { id: s.id, d, color, opacity }
      })
  }, [schedules, now, categoryColor])

  const totalMin = minutesOfDay(now)
  const hourAngle = ((totalMin % 720) / 720) * Math.PI * 2
  const minuteAngle = ((totalMin % 60) / 60) * Math.PI * 2

  const hourX = CENTER + RADIUS_HOUR_HAND * Math.sin(hourAngle)
  const hourY = CENTER - RADIUS_HOUR_HAND * Math.cos(hourAngle)
  const minX = CENTER + RADIUS_MINUTE_HAND * Math.sin(minuteAngle)
  const minY = CENTER - RADIUS_MINUTE_HAND * Math.cos(minuteAngle)

  const hourTicks: Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }> = []
  for (let h = 0; h < 12; h++) {
    const ang = (h / 12) * Math.PI * 2
    hourTicks.push({
      x1: CENTER + RADIUS_TICK_INNER * Math.sin(ang),
      y1: CENTER - RADIUS_TICK_INNER * Math.cos(ang),
      x2: CENTER + RADIUS_OUTER * Math.sin(ang),
      y2: CENTER - RADIUS_OUTER * Math.cos(ang),
      major: h % 3 === 0,
    })
  }

  const hourLabels: Array<{ x: number; y: number; text: string }> = []
  for (const h of [12, 3, 6, 9]) {
    const num = h === 12 ? 0 : h
    const ang = (num / 12) * Math.PI * 2
    hourLabels.push({
      x: CENTER + (RADIUS_TICK_INNER - 14) * Math.sin(ang),
      y: CENTER - (RADIUS_TICK_INNER - 14) * Math.cos(ang),
      text: String(h),
    })
  }

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} className="mx-auto">
      <circle cx={CENTER} cy={CENTER} r={RADIUS_OUTER} className="clock-face" strokeWidth={1} />
      {hourTicks.map((t, i) => (
        <line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          className={t.major ? "clock-tick-major" : "clock-tick-minor"}
          strokeWidth={t.major ? 2 : 1}
        />
      ))}
      {hourLabels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="JetBrains Mono, monospace"
          fontSize={12}
          fontWeight={500}
          className="clock-label"
        >
          {l.text}
        </text>
      ))}
      <g transform={`translate(${CENTER} ${CENTER})`}>
        {sectors.map((s) => (
          <path key={s.id} d={s.d} fill={s.color} opacity={s.opacity} />
        ))}
      </g>
      <line x1={CENTER} y1={CENTER} x2={hourX} y2={hourY} className="clock-hand-hour" strokeWidth={3} strokeLinecap="round" />
      <line x1={CENTER} y1={CENTER} x2={minX} y2={minY} className="clock-hand-minute" strokeWidth={2} strokeLinecap="round" />
      <circle cx={CENTER} cy={CENTER} r={4} className="clock-center-outer" />
      <circle cx={CENTER} cy={CENTER} r={1.5} className="clock-center-inner" />
    </svg>
  )
}
