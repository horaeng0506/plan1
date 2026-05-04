'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useNow} from '@/lib/now';
import {useEscapeKey} from '@/lib/use-escape-key';
import {useCategoryDisplay} from '@/lib/category-display';
import {pad2, todayKey, dateKeyFromMs} from '@/lib/date-format';
import {isServerActionError} from '@/lib/server-action';
import {logClientError} from '@/lib/log';
import {findOverlapping, MAX_OVERLAP} from '@/lib/domain/overlap';
import {CategoryManager} from './CategoryManager';

function defaultHour(): number {
  const h = new Date().getHours() + 1;
  return h >= 24 ? 23 : h;
}

const MINUTE_OPTIONS = [0, 10, 20, 30, 40, 50];

function formatEndDisplay(ms: number, weekdayLabel: (idx: number) => string): string {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())} (${weekdayLabel(d.getDay())})`;
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
  // PLAN1-LOGIN-START-OPT-20260504 #7: 새 스케줄 시작 시점 라디오.
  // 'now' = 기존 동작 (defaultHour() · 사용자 자유 입력)
  // 'afterPrev' = 오늘 이전 스케줄의 endAt 으로 자동 set + chainedToPrev 자동 true
  // 편집 모드 (isEdit) 일 때는 startMode UI 노출 X — 기존 schedule 수정 의미 그대로.
  const [startMode, setStartMode] = useState<'now' | 'afterPrev'>('now');
  const [catOpen, setCatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Track 1 fix (2026-04-29): submit/handleNextAfter/handleDelete catch + 사용자 표시.
  // 기존 try/finally (catch 누락) 가 server action throw 를 silent failure 로 만들었음.
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  // PLAN1-LOGIN-START-OPT-20260504 #7: 오늘 이전 스케줄의 endAt 계산.
  // 오늘 (todayKey) schedule 중 startAt 가장 큰 것의 startAt + durationMin*60s.
  // 0건 → null → afterPrev 옵션 비활성.
  // editing 모드 시 항상 null (기존 schedule 수정 — startMode 무관).
  const prevScheduleEndAt: number | null = useMemo(() => {
    if (isEdit) return null;
    const today = todayKey();
    const todaySchedules = schedules.filter(s => dateKeyFromMs(s.startAt) === today);
    if (todaySchedules.length === 0) return null;
    const lastSchedule = todaySchedules.reduce((a, b) => (a.startAt >= b.startAt ? a : b));
    return lastSchedule.startAt + lastSchedule.durationMin * 60_000;
  }, [schedules, isEdit]);

  // PLAN1-LOGIN-START-OPT-20260504 #7: startMode='afterPrev' 선택 시 자동 채움.
  // useEffect 안 setState 는 React 19 lint (react-hooks/set-state-in-effect) 차단 →
  // 라디오 onChange 핸들러에서 직접 setState (event-driven).
  function selectAfterPrev() {
    if (prevScheduleEndAt === null) return; // disabled 상태 보호
    setStartMode('afterPrev');
    const d = new Date(prevScheduleEndAt);
    setDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
    setHour(d.getHours());
    setMinute(d.getMinutes());
    setChainedToPrev(true);
  }
  function selectNow() {
    setStartMode('now');
    // 'now' 로 복귀 시 사용자가 직접 시간 조정. 자동 채움 X.
  }

  const startAt = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
  }, [date, hour, minute]);
  const now = useNow();
  const nowReady = now > 0;
  // Track 1 fix (2026-04-29): UI 분 단위 정밀도 한계 흡수. 사용자가 분 단위로 입력하므로
  // startAt seconds=0 (분 boundary) 이 현재 분과 같거나 미래면 "지금/미래" 로 인정.
  // 1분 이상 과거(이전 분 boundary) 만 차단 — 대장 의도와 일치.
  const isFuture =
    nowReady && Math.floor(startAt / 60_000) >= Math.floor(now / 60_000);
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
  // PLAN1-TIMER-DUP-20260504 #6.1: 같은 시각 (overlap) schedule 한계 검사.
  // MAX_OVERLAP=2 — 동시 진행 가능 schedule 수. 3건+ submit 차단.
  // edit 모드: 자기 자신 exclude. add 모드: 전체 검사.
  const overlaps = useMemo(
    () =>
      durationMin > 0
        ? findOverlapping(schedules, startAt, durationMin, editing?.id)
        : [],
    [schedules, startAt, durationMin, editing?.id]
  );
  const overlapBlocked = overlaps.length >= MAX_OVERLAP;
  // add 모드: nowReady 필수 (hydration 전 submit 차단). edit 모드: 미래 검증 면제 (W1 정책).
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

  const setNowStart = () => {
    const n = new Date();
    setDate(dateKeyFromMs(n.getTime()));
    setHour(n.getHours());
    setMinute(n.getMinutes());
  };

  // Track 1 fix (2026-04-29): server action error 를 i18n key 로 매핑해 사용자 표시.
  // useRunMutation toast 패턴 대신 inline error (모달 안에 빨간 텍스트 한 줄) — 사용자가
  // 모달을 떠나지 않고 즉시 인지 + 재시도 가능. ServerActionError brand 검사 후 t(key, params).
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

  // 1차 클릭 후 사용자에게 dirty&&!baseOk 경고 노출 위한 ephemeral 메시지 (Stage 3e logic-critic Medium #2).
  const [nextAfterWarn, setNextAfterWarn] = useState<string | null>(null);
  // Stage 3f logic-critic Major fix: 입력 변경 시 stale warn 자동 reset.
  // Stage 8.C: React 19 react-hooks/set-state-in-effect + exhaustive-deps 와 충돌 — 의도된 동기화
  // (사용자 입력 변경 = warn 컨텍스트 무효화). cascading render 1tick 비용 수용.
  // nextAfterWarn 을 deps 에 넣지 않는 이유: 자기 자신 reset 트리거 → 무의미 1회 추가 run.
  // 정공법 refactor (각 setter 안에서 inline `setNextAfterWarn(null)`) 은 Stage 8 후속.
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    if (nextAfterWarn) setNextAfterWarn(null);
    // baseOk 회복 신호인 title/categoryId/durationMin 변경만 추적.
  }, [title, categoryId, durationMin]);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  const handleNextAfter = async () => {
    if (!editing || busy) return;
    if (isDirty && !baseOk) {
      setNextAfterWarn(t('schedule.warningEditIncomplete'));
      return;
    }
    setBusy(true);
    setNextAfterWarn(null);
    setSubmitError(null);
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
    } catch (err) {
      handleMutationError(err, 'handleNextAfter');
    } finally {
      setBusy(false);
    }
  };

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
            {/* PLAN1-LOGIN-START-OPT-20260504 #7: 시작 시점 라디오 (편집 모드 X). */}
            {!isEdit && (
              <fieldset className="rounded-none border border-line bg-bg p-3">
                <legend className="px-1 text-xs font-mono text-muted">
                  {t('schedule.startModeLabel')}
                </legend>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm font-mono">
                    <input
                      type="radio"
                      name="startMode"
                      value="now"
                      checked={startMode === 'now'}
                      onChange={selectNow}
                    />
                    <span>{t('schedule.startModeNow')}</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 text-sm font-mono ${
                      prevScheduleEndAt === null ? 'opacity-50' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="startMode"
                      value="afterPrev"
                      checked={startMode === 'afterPrev'}
                      disabled={prevScheduleEndAt === null}
                      onChange={selectAfterPrev}
                    />
                    <span>
                      {t('schedule.startModeAfterPrev')}
                      {prevScheduleEndAt === null && (
                        <span className="ml-2 text-xs text-muted">
                          ({t('schedule.startModeNoPrevHint')})
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              </fieldset>
            )}
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
