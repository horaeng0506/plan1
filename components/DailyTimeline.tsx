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

const FOCUS_OPTIONS: Array<{value: number | null; key: string}> = [
  {value: null, key: 'focusOff'},
  {value: 240, key: 'focus4h'},
  {value: 300, key: 'focus5h'},
  {value: 360, key: 'focus6h'},
  {value: 420, key: 'focus7h'},
  {value: 480, key: 'focus8h'}
];

export function DailyTimeline({
  onEventClick
}: {
  onEventClick?: (id: string, splitFrom?: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);
  const focusViewMin = useAppStore(s => s.settings.focusViewMin);
  const updateSettings = useAppStore(s => s.updateSettings);
  const runMutation = useRunMutation();

  const nowMs = useNow();

  const {slotMinTime, slotMaxTime} = useMemo(
    () => focusBounds(focusViewMin, nowMs),
    [focusViewMin, nowMs]
  );

  const events = useMemo(() => schedulesToEvents(schedules, categories), [schedules, categories]);

  const handleFocusChange = (value: string) => {
    const next = value === '' ? null : Number(value);
    runMutation(updateSettings({focusViewMin: next}), 'setFocus');
  };

  return (
    <div className="[&_.fc-event-title]:whitespace-normal [&_.fc-event-title]:break-words">
      {/* PLAN1-FOCUS-VIEW-FIX-20260505 — 헤더 우측 상단 select.
          DailyTimeline 전용 — 다른 view 와 분리. select value `''` = null (전체) */}
      <div className="mb-2 flex items-center justify-end">
        <label className="flex items-center gap-2 text-xs text-muted font-mono">
          <span>{t('nav.focusLabel')}</span>
          <select
            value={focusViewMin == null ? '' : String(focusViewMin)}
            onChange={e => handleFocusChange(e.target.value)}
            className="rounded-none border border-line bg-panel px-2 py-1 text-xs text-txt font-mono"
          >
            {FOCUS_OPTIONS.map(opt => (
              <option key={opt.key} value={opt.value == null ? '' : String(opt.value)}>
                {t(`nav.${opt.key}` as 'nav.focusOff')}
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
        eventClick={arg =>
          onEventClick?.(arg.event.id, arg.event.extendedProps?.splitFrom as string | undefined)
        }
        eventContent={renderEventContent}
      />
    </div>
  );
}
