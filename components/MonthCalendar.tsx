'use client';

import {useMemo, useRef, useState} from 'react';
import {useLocale, useTranslations} from 'next-intl';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type {DayCellContentArg, DatesSetArg} from '@fullcalendar/core';
import {useAppStore} from '@/lib/store';
import {logClientError} from '@/lib/log';
import {dateKey, todayKey} from '@/lib/date-format';
import type {DateMarkColor} from '@/lib/domain/types';

/**
 * PLAN1-CALENDAR-RETROSPECT-20260531 — 1달 달력 + 되돌아보기 진입.
 *   - 좌우 버튼으로 이전/다음달. 스케줄(done 포함) 있는 날짜에 점(dot) 마커.
 *   - 과거·오늘 날짜 클릭 → onDateClick(dateMs) (되돌아보기 모달).
 *
 * PLAN1-FUTURE-DATE-MARKS-20260601 — 미래 날짜 클릭 → 색 마킹 (무색→red→green→blue 순환).
 *   - 미래 날짜만 색 원 표시. 색칠한 날짜가 오늘이 되면 key > tKey 조건이 깨져 자동 제외.
 *   - 오늘 동작은 기존 그대로 (onDateClick 모달 진입 — 변경 없음).
 *   - AnalogClock 과 별 FullCalendar 인스턴스 (timeGrid prop 충돌 회피 · env-critic).
 */

function fcLocale(locale: string): string {
  return locale === 'zh-CN' ? 'zh-cn' : locale;
}

// 미래 날짜 색 원 — 표준 tailwind 팔레트 (빨강/녹색/파랑).
const COLOR_BG: Record<DateMarkColor, string> = {
  red: 'bg-red-500',
  green: 'bg-green-500',
  blue: 'bg-blue-500'
};

export function MonthCalendar({onDateClick}: {onDateClick: (dateMs: number) => void}) {
  const t = useTranslations();
  const locale = useLocale();
  const schedules = useAppStore(s => s.schedules);
  // PLAN1-FUTURE-DATE-MARKS-20260601 — 미래 날짜 색 마킹.
  const dateMarks = useAppStore(s => s.dateMarks);
  const rotateDateMark = useAppStore(s => s.rotateDateMark);
  const calRef = useRef<FullCalendar | null>(null);
  const [title, setTitle] = useState('');

  // dateKey → color 빠른 조회.
  const markMap = useMemo(() => {
    const m = new Map<string, DateMarkColor>();
    for (const mk of dateMarks) m.set(mk.dateKey, mk.color);
    return m;
  }, [dateMarks]);

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
    // 미래 날짜에만 색 원 (오늘이 되면 isFuture false → 원 사라짐).
    const mark = isFuture ? markMap.get(key) : undefined;
    return (
      <div className={`flex flex-col items-center ${isFuture && !mark ? 'opacity-30' : ''}`}>
        <span
          className={
            mark
              ? `flex h-6 w-6 items-center justify-center rounded-full ${COLOR_BG[mark]} text-white`
              : ''
          }
        >
          {arg.dayNumberText}
        </span>
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
          const key = dateKey(arg.date);
          if (key > tKey) {
            // 미래 날짜 → 색 회전 (무색→red→green→blue→무색).
            rotateDateMark(key).catch(err =>
              logClientError('[plan1 · rotateDateMark]', err)
            );
            return;
          }
          // 과거·오늘 → 되돌아보기 모달 (기존 동작 유지).
          onDateClick(arg.date.getTime());
        }}
      />
    </div>
  );
}
