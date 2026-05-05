'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useNow} from '@/lib/now';
import {useEscapeKey} from '@/lib/use-escape-key';
import {useCategoryDisplay} from '@/lib/category-display';
import {pad2} from '@/lib/date-format';
import {isServerActionError} from '@/lib/server-action';
import {logClientError} from '@/lib/log';
import {findOverlapping, MAX_OVERLAP} from '@/lib/domain/overlap';
import {buildHourOptions, floorToHourMs} from '@/lib/hour-options';
import {CategoryManager} from './CategoryManager';

const MINUTE_OPTIONS = [0, 10, 20, 30, 40, 50];

function formatEndDisplay(ms: number, weekdayLabel: (idx: number) => string): string {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())} (${weekdayLabel(d.getDay())})`;
}

export function NewScheduleModal({
  onClose,
  editingId: propEditingId,
  prefillStartAt
}: {
  onClose: () => void;
  editingId?: string;
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q7) — 빈 공간 클릭 시 PlanApp 가 30분 floor + auto-bump 후 전달.
  prefillStartAt?: number;
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

  const editingId = propEditingId ?? null;
  const editing = editingId ? schedules.find(s => s.id === editingId) ?? null : null;
  const isEdit = !!editing;

  useEffect(() => {
    if (propEditingId && !schedules.find(s => s.id === propEditingId)) onClose();
  }, [propEditingId, schedules, onClose]);

  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 — snapshot freeze (Q37):
  //   모달 mount 시점 1회 nowMs capture. 이후 hour 옵션 변동 X · 사용자 의도 보존.
  //   useState 의 lazy init 으로 SSR 시 0 받아도 client mount 후 자동 갱신 (useEffect).
  const live = useNow();
  const [nowSnapshot, setNowSnapshot] = useState(0);
  // React 19 react-hooks/set-state-in-effect 와 충돌하지만 SSR 가드 + 1회 capture 의도된 동기화.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (nowSnapshot === 0 && live > 0) setNowSnapshot(live);
  }, [nowSnapshot, live]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const hourOptions = useMemo(
    () => (nowSnapshot > 0 ? buildHourOptions(nowSnapshot) : []),
    [nowSnapshot]
  );

  // 진입 시점 startAt 결정 (우선순위):
  //   - 편집 모드: editing.startAt 그대로 (hour floor + remainder)
  //   - 빈 공간 클릭 (prefillStartAt): PlanApp 가 이미 30분 floor + auto-bump 후 전달
  //   - 새 추가 모드: 현재 시각 자동 (hour floor + 현재 분)
  // selectedHourMs 는 hour boundary 절대 ms · selectedMinute 는 0~59
  const initFloored = useMemo(() => {
    if (editing) return floorToHourMs(editing.startAt);
    if (prefillStartAt !== undefined) return floorToHourMs(prefillStartAt);
    if (nowSnapshot === 0) return null;
    return floorToHourMs(nowSnapshot);
  }, [editing, prefillStartAt, nowSnapshot]);

  const [selectedHourMs, setSelectedHourMs] = useState<number>(0);
  const [minute, setMinute] = useState<number>(0);
  // hourMs/minute 초기값을 nowSnapshot 도달 시점에 설정 (SSR 가드 + 편집 모드 동기).
  // React 19 react-hooks/set-state-in-effect 와 충돌하지만 의도된 동기화 (Stage 8.C 의 다른 영역
  // 동일 패턴 — CategoryManager 41-37 / NewScheduleModal 옛 nextAfterWarn). cascading render 1tick 비용 수용.
  const initAppliedRef = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (initAppliedRef.current) return;
    if (initFloored === null) return;
    setSelectedHourMs(initFloored.hourMs);
    setMinute(initFloored.remainderMin);
    initAppliedRef.current = true;
  }, [initFloored]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [title, setTitle] = useState(editing?.title ?? '');
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? (categories[0]?.id ?? ''));
  const [durationMin, setDurationMin] = useState(editing?.durationMin ?? 0);
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q6·Q30): chainedToPrev 디폴트 true. checkbox 유지.
  const [chainedToPrev, setChainedToPrev] = useState(editing?.chainedToPrev ?? true);
  const [catOpen, setCatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Track 1 fix (2026-04-29): submit catch + 사용자 표시 (silent failure 차단).
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Stage 4d-C a11y: Esc → close.
  useEscapeKey(onClose, !busy && !catOpen);

  const [deleteArmed, setDeleteArmed] = useState(false);
  const deleteTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    },
    []
  );

  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q15) — 마지막 스케줄 = 지금 이후 종료 미완료 (어제 시작 오늘 종료 포함).
  // done 제외 + endAt > now reduce maxEndAt. 0건 시 버튼 disabled.
  const lastScheduleEndAt: number | null = useMemo(() => {
    if (isEdit || nowSnapshot === 0) return null;
    const candidates = schedules.filter(
      s => s.status !== 'done' && s.startAt + s.durationMin * 60_000 > nowSnapshot
    );
    if (candidates.length === 0) return null;
    const last = candidates.reduce((a, b) =>
      a.startAt + a.durationMin * 60_000 > b.startAt + b.durationMin * 60_000 ? a : b
    );
    return last.startAt + last.durationMin * 60_000;
  }, [schedules, isEdit, nowSnapshot]);

  // 옵션 범위 안 (nowSnapshot ~ +24h) 확인. 옵션 밖이면 버튼 disabled.
  const lastWithinRange =
    lastScheduleEndAt !== null &&
    nowSnapshot > 0 &&
    lastScheduleEndAt < nowSnapshot + 24 * 3600_000;

  function handleAfterLast() {
    if (!lastWithinRange || lastScheduleEndAt === null) return;
    const {hourMs, remainderMin} = floorToHourMs(lastScheduleEndAt);
    setSelectedHourMs(hourMs);
    setMinute(remainderMin);
    setChainedToPrev(true);
  }

  const startAt = selectedHourMs + minute * 60_000;
  const nowReady = nowSnapshot > 0;
  const live60Min = Math.floor(live / 60_000);
  const start60Min = Math.floor(startAt / 60_000);
  const isFuture = nowReady && start60Min >= live60Min;
  const endAt = startAt + durationMin * 60_000;

  // minute select 옵션 동적 — 편집 모드 또는 마지막 다음 클릭 시 minute 가 옵션 밖이면 추가.
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

  // PLAN1-TIMER-DUP-20260504 #6.1: overlap 검사 (MAX_OVERLAP=2 한도). 3건+ 차단.
  const overlaps = useMemo(
    () =>
      durationMin > 0
        ? findOverlapping(schedules, startAt, durationMin, editing?.id)
        : [],
    [schedules, startAt, durationMin, editing?.id]
  );
  const overlapBlocked = overlaps.length >= MAX_OVERLAP;

  // add 모드: nowReady 필수 (hydration 전 submit 차단). edit 모드: 미래 검증 면제.
  const canSubmit = isEdit
    ? baseOk && isDirty && !overlapBlocked
    : baseOk && nowReady && isFuture && !overlapBlocked;

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

  const handleMutationError = (err: unknown, where: string) => {
    if (isServerActionError(err)) {
      setSubmitError(t(err.errorKey as 'serverError.unauthorized', err.params));
    } else {
      setSubmitError(t('error.unknown'));
    }
    logClientError(`[NewScheduleModal.${where}]`, err);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
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
    } catch (err) {
      handleMutationError(err, 'submit');
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
    setSubmitError(null);
    try {
      await removeSchedule(editing.id);
      onClose();
    } catch (err) {
      handleMutationError(err, 'handleDelete');
    } finally {
      setBusy(false);
    }
  };

  const fieldCls =
    'w-full rounded-none border border-line bg-bg px-3 py-2 text-ink font-mono';
  const adjustBtn =
    'rounded-none border border-line bg-panel px-2 py-1 text-xs text-txt font-mono hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50';

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
            {/* PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q4): "마지막 스케줄 다음" 버튼 (add 모드만). */}
            {!isEdit && (
              <div>
                <button
                  type="button"
                  onClick={handleAfterLast}
                  disabled={!lastWithinRange}
                  className={adjustBtn}
                  title={
                    lastWithinRange
                      ? undefined
                      : t('schedule.afterLastNoneHint')
                  }
                >
                  {t('schedule.buttonAfterLast')}
                </button>
              </div>
            )}
            {/* PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q14): hour select 동적 24h. fieldStartDate 폐기. */}
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-sm text-txt">{t('schedule.fieldStartHour')}</span>
                <select
                  value={String(selectedHourMs)}
                  onChange={e => setSelectedHourMs(Number(e.target.value))}
                  className={fieldCls}
                  disabled={!nowReady && !isEdit}
                >
                  {/* edit 모드: hour 옵션이 24h 안 아닐 수 있어 editing 시각 자체 별 옵션 표시 */}
                  {isEdit && editing && !hourOptions.some(o => o.value === selectedHourMs) && (
                    <option value={String(selectedHourMs)}>
                      {pad2(new Date(selectedHourMs).getHours())}
                      {t('schedule.hourSuffix')}
                    </option>
                  )}
                  {hourOptions.map(opt => (
                    <option key={opt.value} value={String(opt.value)}>
                      {pad2(opt.hourLabel)}
                      {t('schedule.hourSuffix')}{' '}
                      {opt.isTomorrow
                        ? t('schedule.hourTomorrowSuffix')
                        : t('schedule.hourTodaySuffix')}
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
            {!isEdit && nowReady && !isFuture && (
              <p className="text-xs text-danger">{t('schedule.warningFutureRequired')}</p>
            )}
            {durationMin > 0 && overlapBlocked && (
              <p
                className="text-xs text-danger font-mono"
                role="alert"
                aria-live="polite"
                data-testid="overlap-limit-warning"
              >
                {t('schedule.warningOverlapLimit', {limit: MAX_OVERLAP})}
              </p>
            )}
            <div>
              <span className="mb-1 block text-sm text-txt">{t('schedule.fieldDuration')}</span>
              <input
                type="number"
                min={0}
                value={durationMin}
                onChange={e => setDurationMin(Math.max(0, Number(e.target.value) || 0))}
                className={fieldCls}
                aria-label={t('schedule.fieldDuration')}
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
            {/* PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q30): chainedToPrev 디폴트 체크 + 토글 유지. */}
            <label className="flex items-start gap-2 text-sm text-txt font-mono">
              <input
                type="checkbox"
                checked={chainedToPrev}
                onChange={e => setChainedToPrev(e.target.checked)}
                className="mt-1"
              />
              <span>{t('schedule.chainedCheckbox')}</span>
            </label>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            {/* PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q22): $ next +10m 버튼 폐기. delete 만 유지. */}
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
              </div>
            )}
            {submitError && (
              <p
                className="text-xs text-danger font-mono"
                role="alert"
                aria-live="polite"
              >
                {submitError}
              </p>
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
