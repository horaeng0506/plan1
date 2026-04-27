'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useNow} from '@/lib/now';
import {useEscapeKey} from '@/lib/use-escape-key';
import {useCategoryDisplay} from '@/lib/category-display';
import {CategoryManager} from './CategoryManager';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function defaultHour(): number {
  const h = new Date().getHours() + 1;
  return h >= 24 ? 23 : h;
}

function dateKeyFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// Stage 4d-B: 모듈 스코프 nowCache 제거 → 공유 lib/now.ts useNow() 사용.

const MINUTE_OPTIONS = [0, 10, 20, 30, 40, 50];

// Stage 5 i18n: weekday label 은 t('weekdays.0..6') 로 locale 매핑.
function formatEndDisplay(ms: number, weekdayLabel: (idx: number) => string): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mn} (${weekdayLabel(d.getDay())})`;
}

export function NewScheduleModal({
  onClose,
  editingId: propEditingId
}: {
  onClose: () => void;
  editingId?: string;
}) {
  const t = useTranslations();
  const categoryDisplay = useCategoryDisplay();
  // Stage 5 critic logic Minor #3: dynamic key cast 제거 위해 7개 키 미리 배열로.
  const weekdayLabels = useMemo(
    () => [
      t('weekdays.0'),
      t('weekdays.1'),
      t('weekdays.2'),
      t('weekdays.3'),
      t('weekdays.4'),
      t('weekdays.5'),
      t('weekdays.6')
    ],
    [t]
  );
  const weekdayLabel = (idx: number) => weekdayLabels[idx] ?? '';
  const categories = useAppStore(s => s.categories);
  const schedules = useAppStore(s => s.schedules);
  const addSchedule = useAppStore(s => s.addSchedule);
  const updateSchedule = useAppStore(s => s.updateSchedule);
  const removeSchedule = useAppStore(s => s.removeSchedule);

  const [editingId, setEditingId] = useState<string | null>(propEditingId ?? null);
  const editing = editingId ? schedules.find(s => s.id === editingId) ?? null : null;
  const isEdit = !!editing;

  useEffect(() => {
    if (propEditingId && !schedules.find(s => s.id === propEditingId)) onClose();
  }, [propEditingId, schedules, onClose]);

  const initDate = editing ? dateKeyFromMs(editing.startAt) : todayKey();
  const initHour = editing ? new Date(editing.startAt).getHours() : defaultHour();
  const initMinute = editing ? new Date(editing.startAt).getMinutes() : 0;
  const initDuration = editing?.durationMin ?? 0;
  const initTitle = editing?.title ?? '';
  const initCategoryId = editing?.categoryId ?? (categories[0]?.id ?? '');
  const initChained = editing?.chainedToPrev ?? false;

  const [title, setTitle] = useState(initTitle);
  const [categoryId, setCategoryId] = useState(initCategoryId);
  const [date, setDate] = useState(initDate);
  const [hour, setHour] = useState<number>(initHour);
  const [minute, setMinute] = useState<number>(initMinute);
  const [durationMin, setDurationMin] = useState<number>(initDuration);
  const [chainedToPrev, setChainedToPrev] = useState<boolean>(initChained);
  const [catOpen, setCatOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Stage 4d-C a11y: Esc → close. busy 중 비활성 + catOpen 시 자식 모달이 먼저 받음.
  useEscapeKey(onClose, !busy && !catOpen);

  const [deleteArmed, setDeleteArmed] = useState(false);
  const deleteTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    },
    []
  );

  const startAt = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
  }, [date, hour, minute]);
  const now = useNow();
  const nowReady = now > 0;
  const isFuture = nowReady && startAt > now;
  const endAt = startAt + durationMin * 60_000;

  const minuteOptions = useMemo(() => {
    if (MINUTE_OPTIONS.includes(minute)) return MINUTE_OPTIONS;
    return [...MINUTE_OPTIONS, minute].sort((a, b) => a - b);
  }, [minute]);

  const isDirty = editing
    ? title.trim() !== editing.title ||
      categoryId !== editing.categoryId ||
      startAt !== editing.startAt ||
      durationMin !== editing.durationMin ||
      chainedToPrev !== (editing.chainedToPrev ?? false)
    : false;

  const baseOk =
    title.trim().length > 0 &&
    categoryId !== '' &&
    categoryId !== '__NEW__' &&
    durationMin > 0 &&
    !busy;
  // add 모드: nowReady 필수 (hydration 전 submit 차단). edit 모드: 미래 검증 면제 (W1 정책).
  const canSubmit = isEdit ? baseOk && isDirty : baseOk && nowReady && isFuture;

  const handleCategoryChange = (v: string) => {
    if (v === '__NEW__') {
      setCatOpen(true);
      return;
    }
    setCategoryId(v);
  };

  const bumpDuration = (delta: number) => {
    setDurationMin(d => Math.max(0, d + delta));
  };

  const setNowStart = () => {
    const n = new Date();
    setDate(dateKeyFromMs(n.getTime()));
    setHour(n.getHours());
    setMinute(n.getMinutes());
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    // mutation 진입 시 deleteArmed 가 살아있으면 stale state — 명시적으로 reset
    // (Stage 3e logic-critic Medium #9 — busy 상호작용 보호).
    setDeleteArmed(false);
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    try {
      if (isEdit && editing) {
        await updateSchedule(editing.id, {
          title: title.trim(),
          categoryId,
          startAt,
          durationMin,
          chainedToPrev
        });
      } else {
        await addSchedule({
          title: title.trim(),
          categoryId,
          startAt,
          durationMin,
          timerType: 'countup',
          chainedToPrev
        });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!editing || busy) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      deleteTimerRef.current = window.setTimeout(() => setDeleteArmed(false), 2000);
      return;
    }
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    setBusy(true);
    try {
      await removeSchedule(editing.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // 1차 클릭 후 사용자에게 dirty&&!baseOk 경고 노출 위한 ephemeral 메시지 (Stage 3e logic-critic Medium #2).
  const [nextAfterWarn, setNextAfterWarn] = useState<string | null>(null);
  // Stage 3f logic-critic Major fix: 입력 변경 시 stale warn 자동 reset.
  useEffect(() => {
    if (nextAfterWarn) setNextAfterWarn(null);
    // baseOk 회복 신호인 title/categoryId/durationMin 변경만 추적.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, categoryId, durationMin]);
  const handleNextAfter = async () => {
    if (!editing || busy) return;
    if (isDirty && !baseOk) {
      setNextAfterWarn(t('schedule.warningEditIncomplete'));
      return;
    }
    setBusy(true);
    setNextAfterWarn(null);
    try {
      if (isDirty && baseOk) {
        await updateSchedule(editing.id, {
          title: title.trim(),
          categoryId,
          startAt,
          durationMin,
          chainedToPrev
        });
      }
      const formEndAt = startAt + durationMin * 60_000;
      const nextStart = formEndAt + 10 * 60_000;
      const d = new Date(nextStart);
      setEditingId(null);
      setTitle('');
      setCategoryId(categories[0]?.id ?? '');
      setDate(dateKeyFromMs(nextStart));
      setHour(d.getHours());
      setMinute(d.getMinutes());
      setDurationMin(0);
      setChainedToPrev(false);
      setDeleteArmed(false);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    } finally {
      setBusy(false);
    }
  };

  // Stage 4a 4채널 토큰화.
  const fieldCls =
    'w-full rounded-none border border-line bg-bg px-3 py-2 text-ink font-mono';
  const adjustBtn =
    'rounded-none border border-line bg-panel px-2 py-1 text-xs text-txt font-mono hover:bg-bg';

  const headerTxt = isEdit ? t('schedule.headerEdit') : t('schedule.headerNew');
  const submitLabel = isEdit ? t('common.save') : t('common.add');

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.75)] p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md rounded-none border border-line bg-panel p-6"
          onClick={e => e.stopPropagation()}
        >
          <h2 className="mb-4 text-sm font-semibold text-success font-mono">
            {headerTxt}
          </h2>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-sm text-txt">{t('schedule.fieldName')}</span>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className={fieldCls}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-txt">{t('schedule.fieldCategory')}</span>
              <select
                value={categoryId}
                onChange={e => handleCategoryChange(e.target.value)}
                className={fieldCls}
              >
                {categories.map(c => (
                  <option key={c.id} value={c.id}>
                    {categoryDisplay(c)}
                  </option>
                ))}
                <option value="__NEW__">{t('schedule.categoryAddOption')}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-txt">{t('schedule.fieldStartDate')}</span>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className={fieldCls}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-sm text-txt">{t('schedule.fieldStartHour')}</span>
                <select
                  value={hour}
                  onChange={e => setHour(Number(e.target.value))}
                  className={fieldCls}
                >
                  {Array.from({length: 24}, (_, i) => (
                    <option key={i} value={i}>
                      {String(i).padStart(2, '0')}{t('schedule.hourSuffix')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-txt">{t('schedule.fieldStartMinute')}</span>
                <select
                  value={minute}
                  onChange={e => setMinute(Number(e.target.value))}
                  className={fieldCls}
                >
                  {minuteOptions.map(m => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, '0')}{t('schedule.minuteSuffix')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <button type="button" onClick={setNowStart} className={adjustBtn}>
                {t('schedule.buttonNow')}
              </button>
            </div>
            {!isEdit && nowReady && !isFuture && (
              <p className="text-xs text-danger">{t('schedule.warningFutureRequired')}</p>
            )}
            <div>
              <span className="mb-1 block text-sm text-txt">{t('schedule.fieldDuration')}</span>
              <input
                type="number"
                min={0}
                value={durationMin}
                onChange={e => setDurationMin(Math.max(0, Number(e.target.value) || 0))}
                className={fieldCls}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" onClick={() => bumpDuration(-30)} className={adjustBtn}>
                  {t('schedule.buttonMinus30')}
                </button>
                <button type="button" onClick={() => bumpDuration(-10)} className={adjustBtn}>
                  {t('schedule.buttonMinus10')}
                </button>
                <button type="button" onClick={() => bumpDuration(10)} className={adjustBtn}>
                  {t('schedule.buttonPlus10')}
                </button>
                <button type="button" onClick={() => bumpDuration(30)} className={adjustBtn}>
                  {t('schedule.buttonPlus30')}
                </button>
                <button type="button" onClick={() => bumpDuration(60)} className={adjustBtn}>
                  {t('schedule.buttonPlusHour')}
                </button>
              </div>
            </div>
            <div className="text-xs font-mono text-muted">
              {t('schedule.endLabel')} →{' '}
              {durationMin > 0 ? (
                formatEndDisplay(endAt, weekdayLabel)
              ) : (
                <span className="text-muted opacity-60">{t('schedule.endEmpty')}</span>
              )}
            </div>
            <label className="flex items-start gap-2 text-sm text-txt font-mono">
              <input
                type="checkbox"
                checked={chainedToPrev}
                onChange={e => setChainedToPrev(e.target.checked)}
                className="mt-1"
              />
              <span>
                {t('schedule.chainedCheckbox')}
                <span className="block text-xs text-muted">
                  {t('schedule.chainedHelp')}
                </span>
              </span>
            </label>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            {isEdit && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className={`rounded-none border px-3 py-2 text-sm font-mono disabled:cursor-not-allowed disabled:opacity-50 ${
                    deleteArmed
                      ? 'border-danger bg-danger text-bg hover:opacity-90'
                      : 'border-danger bg-panel text-danger hover:bg-[rgba(224,108,117,0.1)]'
                  }`}
                >
                  {deleteArmed ? t('common.confirmDelete') : t('common.delete')}
                </button>
                <button
                  type="button"
                  onClick={handleNextAfter}
                  disabled={busy}
                  className={adjustBtn}
                  title={t('schedule.nextAfterTooltip')}
                >
                  {t('schedule.buttonNextAfter')}
                </button>
              </div>
            )}
            {nextAfterWarn && (
              <p className="text-xs text-danger font-mono">{nextAfterWarn}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-none border border-line bg-panel px-4 py-2 text-sm text-txt font-mono hover:bg-bg"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="rounded-none border border-ink bg-ink px-4 py-2 text-sm text-bg font-mono hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
      {catOpen && <CategoryManager onClose={() => setCatOpen(false)} />}
    </>
  );
}
