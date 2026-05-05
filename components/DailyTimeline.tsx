'use client';

import {useMemo} from 'react';
import {useLocale, useTranslations} from 'next-intl';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import {useAppStore} from '@/lib/store';
import {schedulesToEvents} from '@/lib/schedule-to-event';
import {focusBounds} from '@/lib/focus-bounds';
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
  onEventClick
}: {
  onEventClick?: (id: string) => void;
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

  const {slotMinTime, slotMaxTime} = useMemo(
    () => focusBounds(focusViewMin, nowMs),
    [focusViewMin, nowMs]
  );

  const events = useMemo(() => schedulesToEvents(schedules, categories), [schedules, categories]);

  const handleFocusChange = (value: string) => {
    runMutation(updateSettings({focusViewMin: Number(value)}), 'setFocus');
  };

  return (
    <div className="[&_.fc-event-title]:whitespace-normal [&_.fc-event-title]:break-words">
      {/* PLAN1-FOCUS-VIEW-REDESIGN-20260506 — focus select 좌측 이동 (Q3·Q29). */}
      <div className="mb-2 flex items-center justify-start">
        <label className="flex items-center gap-2 text-xs text-muted font-mono">
          <span>{t('nav.focusLabel')}</span>
          <select
            value={String(focusViewMin)}
            onChange={e => handleFocusChange(e.target.value)}
            className="rounded-none border border-line bg-panel px-2 py-1 text-xs text-txt font-mono"
          >
            {FOCUS_OPTIONS.map(opt => (
              <option key={opt.key} value={String(opt.value)}>
                {t(`nav.${opt.key}` as 'nav.focus4h')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        headerToolbar={{left: 'prev,next today', center: 'title', right: ''}}
        locale={fcLocale(locale)}
        slotMinTime={slotMinTime}
        slotMaxTime={slotMaxTime}
        nowIndicator
        allDaySlot={false}
        height="auto"
        events={events}
        editable={false}
        eventClick={arg => onEventClick?.(arg.event.id)}
        eventContent={renderEventContent}
      />
    </div>
  );
}
