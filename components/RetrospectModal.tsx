'use client';

import {useMemo} from 'react';
import {useLocale, useTranslations} from 'next-intl';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import {useAppStore} from '@/lib/store';
import {useEscapeKey} from '@/lib/use-escape-key';
import {schedulesToEvents} from '@/lib/schedule-to-event';
import {formatDateShort} from '@/lib/date-format';
import {renderEventContent} from './event-renderer';

/**
 * PLAN1-CALENDAR-RETROSPECT-20260531 — 과거 날짜 24시간 기록 되돌아보기 모달.
 *   - 00:00~24:00 전체 (focus window 미적용). 완료(done) 스케줄 포함.
 *   - done 은 actualDurationMin 기준 박스 크기 (schedulesToEvents 기존 동작).
 *   - 오늘 스케줄(메인 화면)과 구별되게 별 모달.
 */

function fcLocale(locale: string): string {
  return locale === 'zh-CN' ? 'zh-cn' : locale;
}

export function RetrospectModal({dateMs, onClose}: {dateMs: number; onClose: () => void}) {
  const t = useTranslations();
  const locale = useLocale();
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);

  useEscapeKey(onClose, true);

  const weekdayLabel = (w: number) => t(`weekdays.${w}` as 'weekdays.0');
  const dateLabel = formatDateShort(new Date(dateMs), weekdayLabel);

  // 해당 날짜에 걸친 스케줄 (overlap 기준). 자정 넘는 스케줄도 포함.
  const dayHasAny = useMemo(() => {
    const dayStart = new Date(dateMs);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayStartMs + 24 * 3600_000;
    return schedules.some(s => {
      const effDur = s.actualDurationMin ?? s.durationMin;
      const startMs = s.startAt;
      const endMs = s.startAt + Math.max(0, effDur) * 60_000;
      return startMs < dayEndMs && endMs > dayStartMs;
    });
  }, [schedules, dateMs]);

  // FullCalendar timeGridDay 가 initialDate 날짜 영역으로 자동 clip.
  const events = useMemo(() => schedulesToEvents(schedules, categories), [schedules, categories]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.75)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-none border border-line bg-panel p-6"
        onClick={e => e.stopPropagation()}
        data-testid="retrospect-modal"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-success font-mono">
            {t('retrospect.title')} <span className="text-ink">{dateLabel}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-none border border-line bg-panel px-3 py-1 text-xs text-txt font-mono hover:bg-bg"
          >
            {t('common.close')}
          </button>
        </div>
        {!dayHasAny && (
          <p className="mb-3 text-xs text-muted font-mono" data-testid="retrospect-empty">
            {t('retrospect.empty')}
          </p>
        )}
        <div className="max-h-[60vh] overflow-y-auto plan1-retrospect">
          <FullCalendar
            plugins={[timeGridPlugin]}
            initialView="timeGridDay"
            headerToolbar={false}
            dayHeaders={false}
            locale={fcLocale(locale)}
            slotMinTime="00:00:00"
            slotMaxTime="24:00:00"
            slotDuration="01:00:00"
            allDaySlot={false}
            height="auto"
            initialDate={new Date(dateMs)}
            events={events}
            editable={false}
            selectable={false}
            eventContent={renderEventContent}
          />
        </div>
      </div>
    </div>
  );
}
