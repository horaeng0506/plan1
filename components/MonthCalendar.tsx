'use client';

import {useMemo, useRef, useState} from 'react';
import {useLocale, useTranslations} from 'next-intl';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type {DayCellContentArg, DatesSetArg} from '@fullcalendar/core';
import {useAppStore} from '@/lib/store';
import {dateKey, todayKey} from '@/lib/date-format';

/**
 * PLAN1-CALENDAR-RETROSPECT-20260531 — 1달 달력 + 되돌아보기 진입.
 *   - 좌우 버튼으로 이전/다음달. 스케줄(done 포함) 있는 날짜에 점(dot) 마커.
 *   - 과거·오늘 날짜 클릭 → onDateClick(dateMs) (되돌아보기 모달). 미래 날짜는 비활성.
 *   - AnalogClock 과 별 FullCalendar 인스턴스 (timeGrid prop 충돌 회피 · env-critic).
 */

function fcLocale(locale: string): string {
  return locale === 'zh-CN' ? 'zh-cn' : locale;
}

export function MonthCalendar({onDateClick}: {onDateClick: (dateMs: number) => void}) {
  const t = useTranslations();
  const locale = useLocale();
  const schedules = useAppStore(s => s.schedules);
  const calRef = useRef<FullCalendar | null>(null);
  const [title, setTitle] = useState('');

  // 스케줄(done 포함)이 걸친 모든 날짜 키 (overlap 기준 — 자정 넘는 스케줄 양일 마킹).
  const daysWithSchedules = useMemo(() => {
    const set = new Set<string>();
    for (const s of schedules) {
      const effDur = s.actualDurationMin ?? s.durationMin;
      const startMs = s.startAt;
      const endMs = s.startAt + Math.max(0, effDur) * 60_000;
      // 시작일부터 종료일까지 각 날짜 마킹 (대부분 1일).
      const cur = new Date(startMs);
      cur.setHours(0, 0, 0, 0);
      const endDay = new Date(endMs);
      endDay.setHours(0, 0, 0, 0);
      // 안전 상한 (혹시 모를 비정상 데이터 무한루프 차단).
      let guard = 0;
      while (cur.getTime() <= endDay.getTime() && guard < 400) {
        set.add(dateKey(cur));
        cur.setDate(cur.getDate() + 1);
        guard++;
      }
    }
    return set;
  }, [schedules]);

  const tKey = todayKey();

  const handlePrev = () => calRef.current?.getApi().prev();
  const handleNext = () => calRef.current?.getApi().next();
  const handleDatesSet = (arg: DatesSetArg) => setTitle(arg.view.title);

  const renderDayCell = (arg: DayCellContentArg) => {
    const key = dateKey(arg.date);
    const isFuture = key > tKey;
    const has = daysWithSchedules.has(key);
    return (
      <div className={`flex flex-col items-center ${isFuture ? 'opacity-30' : ''}`}>
        <span>{arg.dayNumberText}</span>
        <span
          className={`mt-0.5 h-1 w-1 rounded-full ${has ? 'bg-success' : 'bg-transparent'}`}
          aria-hidden="true"
        />
      </div>
    );
  };

  const navBtn =
    'rounded-none border border-line bg-panel px-2 py-1 text-xs text-txt font-mono hover:bg-bg';

  return (
    <div data-testid="month-calendar" className="font-mono plan1-month-cal">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={handlePrev} aria-label={t('calendar.prevMonth')} className={navBtn}>
          ‹
        </button>
        <span className="text-sm font-medium text-ink">{title}</span>
        <button type="button" onClick={handleNext} aria-label={t('calendar.nextMonth')} className={navBtn}>
          ›
        </button>
      </div>
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={false}
        locale={fcLocale(locale)}
        height="auto"
        fixedWeekCount={false}
        showNonCurrentDates={false}
        dayCellContent={renderDayCell}
        datesSet={handleDatesSet}
        dateClick={arg => {
          if (dateKey(arg.date) > tKey) return; // 미래 비활성
          onDateClick(arg.date.getTime());
        }}
      />
    </div>
  );
}
