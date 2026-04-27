'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useEscapeKey} from '@/lib/use-escape-key';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

const DATE_GUARD_MAX = 1000;

function enumerateDates(
  from: string,
  to: string,
  weekdaysOnly: boolean
): {dates: string[]; truncated: boolean} {
  // from > to 보호 (Stage 3e logic-critic Medium #8 — silent 빈배열 회피).
  if (from > to) return {dates: [], truncated: false};
  const result: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < DATE_GUARD_MAX) {
    const [y, m, d] = cur.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    if (!weekdaysOnly || !isWeekend) result.push(cur);
    cur = addDaysKey(cur, 1);
    guard++;
  }
  return {dates: result, truncated: guard >= DATE_GUARD_MAX && cur <= to};
}

type Mode = 'single' | 'range';

export function WorkingHoursEditor({onClose}: {onClose: () => void}) {
  const t = useTranslations();
  const defaultWH = useAppStore(s => s.settings.defaultWorkingHours);
  const setWorkingHours = useAppStore(s => s.setWorkingHours);
  const bulkSetWorkingHours = useAppStore(s => s.bulkSetWorkingHours);
  const setDefaultWorkingHours = useAppStore(s => s.setDefaultWorkingHours);

  const [mode, setMode] = useState<Mode>('single');
  const [date, setDate] = useState(todayKey());
  const [fromDate, setFromDate] = useState(todayKey());
  const [toDate, setToDate] = useState(addDaysKey(todayKey(), 6));
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [startTime, setStartTime] = useState(minToTime(defaultWH.startMin));
  const [endTime, setEndTime] = useState(minToTime(defaultWH.endMin));
  const [alsoDefault, setAlsoDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  // Stage 4d-C a11y: Esc → close. busy 중 비활성.
  useEscapeKey(onClose, !busy);

  const startMin = timeToMin(startTime);
  const endMin = timeToMin(endTime);
  const validTime = startMin < endMin;
  const validRange = mode === 'single' || fromDate <= toDate;
  const valid = validTime && validRange;
  const [warn, setWarn] = useState<string | null>(null);

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setWarn(null);
    try {
      const hours = {startMin, endMin};
      if (mode === 'single') {
        await setWorkingHours(date, hours);
      } else {
        const {dates, truncated} = enumerateDates(fromDate, toDate, weekdaysOnly);
        if (dates.length === 0) {
          setWarn(t('workingHours.warningNoDates'));
          return;
        }
        if (truncated) {
          setWarn(t('workingHours.warningTruncated', {max: DATE_GUARD_MAX}));
          return;
        }
        await bulkSetWorkingHours(dates, hours);
      }
      if (alsoDefault) await setDefaultWorkingHours(hours);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // Stage 4a 4채널 토큰화.
  const tabBtn = (active: boolean) =>
    `px-3 py-1 text-sm rounded-none border font-mono ${
      active
        ? 'bg-ink text-bg border-ink'
        : 'bg-panel text-txt border-line hover:bg-bg'
    }`;

  const fieldWrap =
    'w-full rounded-none border border-line bg-bg px-3 py-2 text-ink font-mono';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.75)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-none border border-line bg-panel p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-success font-mono">
          {t('workingHours.header')}
        </h2>

        <div className="mb-4 flex gap-1">
          <button type="button" className={tabBtn(mode === 'single')} onClick={() => setMode('single')}>
            {t('workingHours.tabSingle')}
          </button>
          <button type="button" className={tabBtn(mode === 'range')} onClick={() => setMode('range')}>
            {t('workingHours.tabRange')}
          </button>
        </div>

        <div className="space-y-3">
          {mode === 'single' && (
            <label className="block">
              <span className="mb-1 block text-sm text-txt">{t('workingHours.fieldDate')}</span>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={fieldWrap}
              />
            </label>
          )}
          {mode === 'range' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-sm text-txt">{t('workingHours.fieldFromDate')}</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className={fieldWrap}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-txt">{t('workingHours.fieldToDate')}</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className={fieldWrap}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-txt">
                <input
                  type="checkbox"
                  checked={weekdaysOnly}
                  onChange={e => setWeekdaysOnly(e.target.checked)}
                />
                {t('workingHours.checkboxWeekdaysOnly')}
              </label>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-sm text-txt">{t('workingHours.fieldStartTime')}</span>
              <input
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                className={fieldWrap}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-txt">{t('workingHours.fieldEndTime')}</span>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                className={fieldWrap}
              />
            </label>
          </div>
          {!validTime && (
            <p className="text-xs text-danger">{t('workingHours.errorEndAfterStart')}</p>
          )}
          {mode === 'range' && !validRange && (
            <p className="text-xs text-danger">{t('workingHours.errorToAfterFrom')}</p>
          )}
          {warn && (
            <p className="text-xs text-warn font-mono">{warn}</p>
          )}
          <label className="flex items-center gap-2 text-sm text-txt">
            <input
              type="checkbox"
              checked={alsoDefault}
              onChange={e => setAlsoDefault(e.target.checked)}
            />
            {t('workingHours.checkboxAlsoDefault')}
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-none border border-line bg-panel px-4 py-2 text-sm text-txt font-mono hover:bg-bg"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!valid || busy}
            className="rounded-none border border-ink bg-ink px-4 py-2 text-sm text-bg font-mono hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
