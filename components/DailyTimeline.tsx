'use client';

import {useMemo} from 'react';
import {useLocale, useTranslations} from 'next-intl';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {useAppStore} from '@/lib/store';
import {schedulesToEvents, chainGroupsToBackgroundEvents} from '@/lib/schedule-to-event';
import {focusBounds} from '@/lib/focus-bounds';
import {formatDateRangeLabel} from '@/lib/date-format';
import {useNow} from '@/lib/now';
import {useRunMutation} from '@/lib/use-run-mutation';
import {renderEventContent} from './event-renderer';

// next-intl `zh-CN` → FullCalendar `zh-cn`.
function fcLocale(locale: string): string {
  return locale === 'zh-CN' ? 'zh-cn' : locale;
}

// PLAN1-FOCUS-VIEW-REDESIGN-20260506: null 옵션 폐기 + default 12h. 5h·7h 폐기, 10·12·16·20·24h 신규.
const FOCUS_OPTIONS: Array<{value: number; key: string}> = [
  {value: 240, key: 'focus4h'},
  {value: 360, key: 'focus6h'},
  {value: 480, key: 'focus8h'},
  {value: 600, key: 'focus10h'},
  {value: 720, key: 'focus12h'},
  {value: 960, key: 'focus16h'},
  {value: 1200, key: 'focus20h'},
  {value: 1440, key: 'focus24h'}
];

export function DailyTimeline({
  onEventClick,
  onDateClick
}: {
  onEventClick?: (id: string) => void;
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q7·Q10·Q11·Q18) — 빈 공간 클릭 → 모달.
  // 30분 floor + auto-bump (focus window 안 과거 영역 클릭 시 startAt = max(clickedMs, now)).
  onDateClick?: (clickedMs: number) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506: null 폐기. 옛 row null 받을 수 있어 fallback 720.
  // S12 portal repo schema migration 후 NOT NULL DEFAULT 720 박힐 때까지 안전망.
  const focusViewMin = useAppStore(s => s.settings.focusViewMin ?? 720);
  const updateSettings = useAppStore(s => s.updateSettings);
  const runMutation = useRunMutation();

  const nowMs = useNow();

  const {slotMinTime, slotMaxTime, startMs, endMs} = useMemo(
    () => focusBounds(focusViewMin, nowMs),
    [focusViewMin, nowMs]
  );

  // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #2·#3: 자체 헤더 날짜 라벨 (5.6(수) / 5.6(수)-7).
  const weekdayLabels = useMemo(
    () => [
      t('weekdays.0'), t('weekdays.1'), t('weekdays.2'), t('weekdays.3'),
      t('weekdays.4'), t('weekdays.5'), t('weekdays.6')
    ],
    [t]
  );
  const weekdayLabel = (w: number) => weekdayLabels[w] ?? '';
  const dateLabel = useMemo(
    () => (startMs > 0 ? formatDateRangeLabel(startMs, endMs - 1, weekdayLabel) : ''),
    // endMs 는 exclusive (slotMaxTime "24:00:00" 시 다음날 0:00 ms) → -1 로 inclusive 변환
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startMs, endMs, weekdayLabels]
  );

  // 2026-05-06 (대장 명시) — 12시간 기준 표기 (오전/오후 표기 X) · "X시 끝" / "X시 Y분 끝".
  // h12 = ((h24 + 11) % 12) + 1 — 0→12 · 13→1 · 23→11
  const finalEndLabel = useMemo(() => {
    const candidates = schedules.filter(s => s.status !== 'done');
    if (candidates.length === 0) return null;
    const finalMs = candidates.reduce(
      (max, s) => Math.max(max, s.startAt + s.durationMin * 60_000),
      0
    );
    const d = new Date(finalMs);
    const h12 = ((d.getHours() + 11) % 12) + 1;
    const m = d.getMinutes();
    const minuteText = m > 0 ? ` ${m}${t('schedule.minuteSuffix')}` : '';
    return `${h12}${t('schedule.hourSuffix')}${minuteText} ${t('header.finalEndAtSuffix')}`;
  }, [schedules, t]);

  const events = useMemo(
    () => [
      ...chainGroupsToBackgroundEvents(schedules),
      ...schedulesToEvents(schedules, categories)
    ],
    [schedules, categories]
  );

  const handleFocusChange = (value: string) => {
    runMutation(updateSettings({focusViewMin: Number(value)}), 'setFocus');
  };

  return (
    <div className="[&_.fc-event-title]:whitespace-normal [&_.fc-event-title]:break-words">
      {/* PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #1·#2·#3:
            - headerToolbar=false (< > today 폐기)
            - dayHeaders=false (빈칸|요일 row 폐기)
            - 자체 헤더: focus dropdown (좌) + 날짜 라벨 (우) · "집중" 라벨 폐기 */}
      <div className="mb-2 flex items-center justify-between">
        <select
          value={String(focusViewMin)}
          onChange={e => handleFocusChange(e.target.value)}
          className="rounded-none border border-line bg-panel px-2 py-1 text-xs text-txt font-mono"
          aria-label={t('nav.focusLabel')}
        >
          {FOCUS_OPTIONS.map(opt => (
            <option key={opt.key} value={String(opt.value)}>
              {t(`nav.${opt.key}` as 'nav.focus4h')}
            </option>
          ))}
        </select>
        {/* 2026-05-06 (대장 명시 · 위치 swap) — 가운데 날짜 · 우측 끝 시각. */}
        <span className="text-xs text-muted font-mono">{dateLabel}</span>
        {finalEndLabel && (
          <span className="text-sm font-medium text-ink font-mono">{finalEndLabel}</span>
        )}
      </div>
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        headerToolbar={false}
        dayHeaders={false}
        locale={fcLocale(locale)}
        slotMinTime={slotMinTime}
        slotMaxTime={slotMaxTime}
        slotDuration="00:30:00"
        nowIndicator
        allDaySlot={false}
        height="auto"
        events={events}
        editable={false}
        eventClick={arg => onEventClick?.(arg.event.id)}
        dateClick={arg => onDateClick?.(arg.date.getTime())}
        eventContent={renderEventContent}
      />
    </div>
  );
}
