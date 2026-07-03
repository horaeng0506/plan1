'use client';

import {Fragment, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useNow} from '@/lib/now';
import {useEscapeKey} from '@/lib/use-escape-key';
import {useCategoryDisplay} from '@/lib/category-display';
import {pad2, formatDateShort} from '@/lib/date-format';
import {isServerActionError} from '@/lib/server-action';
import {logClientError} from '@/lib/log';
import {findOverlapping, MAX_OVERLAP} from '@/lib/domain/overlap';
import {buildHourOptions, floorToHourMs} from '@/lib/hour-options';
import {focusBounds} from '@/lib/focus-bounds';
import {AFTER_LAST_GAP_MS} from '@/lib/after-last';
import type {Schedule} from '@/lib/domain/types';
import {CategoryManager} from './CategoryManager';
import {Spinner} from './Spinner';

const MINUTE_OPTIONS = [0, 10, 20, 30, 40, 50];

function formatEndDisplay(ms: number, weekdayLabel: (idx: number) => string): string {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())} (${weekdayLabel(d.getDay())})`;
}

/**
 * PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #5: prev chain 산식.
 * 새 schedule.startAt 이전 + 미완료 + endAt > now (지나간 schedule 폐기) + chainedToPrev=true 연속 chain.
 * 시간순 가장 가까운 prev (직전) 부터 chained=false 만나기 전까지.
 *
 * 2026-05-06 fix: 지나간 (endAt < now) schedule 폐기 — 사용자 입장 "오늘 새로 시작" 시 옛 chain 노출 X.
 */
function getPrevChain(schedules: Schedule[], newStartAt: number, nowMs: number): Schedule[] {
  const sorted = schedules
    .filter(
      s =>
        s.status !== 'done' &&
        s.startAt < newStartAt &&
        s.startAt + s.durationMin * 60_000 > nowMs
    )
    .sort((a, b) => b.startAt - a.startAt);
  const result: Schedule[] = [];
  for (const s of sorted) {
    result.unshift(s);
    if (!s.chainedToPrev) break;
  }
  return result;
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
  // PLAN1-SCHEDULE-INSERT-BETWEEN-20260602 — A2 사이 삽입 (B 시작 시간 충돌 시 선택지).
  const insertScheduleBetween = useAppStore(s => s.insertScheduleBetween);
  // PLAN1-CHAIN-FOCUS-GUARD-20260510 (C 옵션): focus view 안 prior schedule check 용.
  const focusViewMin = useAppStore(s => s.settings.focusViewMin);

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

  // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #10: 디폴트 "새 스케줄" + onFocus 디폴트 값일 때만 자동 삭제.
  const titleDefault = t('schedule.titleDefault');
  const [title, setTitle] = useState(editing?.title ?? titleDefault);
  const handleTitleFocus = () => {
    if (title === titleDefault) setTitle('');
  };
  // 신규 기본값은 활성 카테고리 우선 (categories[0] 이 소프트 삭제분일 수 있어 배제 · 대장 2026-07-03).
  const [categoryId, setCategoryId] = useState(
    editing?.categoryId ?? (categories.find(c => !c.deletedAt)?.id ?? '')
  );
  // 완료 일정은 타임라인이 actualDurationMin 으로 표시되므로 편집 시작값도 actual 기준
  // (보이는 값과 일치 · 저장 시 actualDurationMin 으로 반영). 미완료는 actualDurationMin 이 없어 durationMin.
  const editingDurationMin = editing ? (editing.actualDurationMin ?? editing.durationMin) : 0;
  const [durationMin, setDurationMin] = useState(editingDurationMin);
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q6·Q30): chainedToPrev 디폴트 true. checkbox 유지.
  const [chainedToPrev, setChainedToPrev] = useState(editing?.chainedToPrev ?? true);
  const [catOpen, setCatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Track 1 fix (2026-04-29): submit catch + 사용자 표시 (silent failure 차단).
  const [submitError, setSubmitError] = useState<string | null>(null);
  // PLAN1-SCHEDULE-INSERT-BETWEEN-20260602 — startAt 정확 일치 충돌 시 선택지 패널 상태.
  const [insertChoice, setInsertChoice] = useState<{
    conflictId: string;
    conflictStart: number;
    canSameTime: boolean;
    canInsertBetween: boolean;
  } | null>(null);

  // Stage 4d-C a11y: Esc → close.
  useEscapeKey(onClose, !busy && !catOpen);

  // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #15: deleteArmed state 폐기 (즉시 삭제 · undo bar 5초로 회복 가능).

  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q15) — 마지막 스케줄 = 지금 이후 종료 미완료.
  // V2 #9 (Q-NEW4 b · Q-NEW10 b): 0건 시 클릭 → Date.now() 박음.
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

  function handleAfterLast() {
    // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #9·Q-NEW10 b: 0건 또는 24h 옵션 밖이면 Date.now() 사용.
    // PLAN1-LAST-PLUS-10-20260531 — 마지막 종료 +10분 (TaskList 변환 버튼과 통일).
    const nowMs = Date.now();
    let targetMs: number;
    if (lastScheduleEndAt !== null && lastScheduleEndAt > nowMs && lastScheduleEndAt < nowMs + 24 * 3600_000) {
      targetMs = lastScheduleEndAt + AFTER_LAST_GAP_MS;
    } else {
      targetMs = nowMs;
    }
    const {hourMs, remainderMin} = floorToHourMs(targetMs);
    setSelectedHourMs(hourMs);
    setMinute(remainderMin);
    setChainedToPrev(true);
  }

  const startAt = selectedHourMs + minute * 60_000;
  const nowReady = nowSnapshot > 0;
  const endAt = startAt + durationMin * 60_000;

  // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #12 (Q-NEW6 d·Q-NEW11 d):
  // 시작 분 자동 갱신. 사용자 명시 변경 = lock (선택값 ≠ 직전 자동값).
  // 사용자 입력값이 시간 흐름 후 자연 일치 (= 직전 자동값) 시 자동 모드 자연 복원.
  // PLAN1-PREFILL-RACE-FIX-20260509: baseline 영역 = currentSelected → floorToHourMs(live) 정정.
  // 옛 영역 결함: prefillStartAt 박힌 영역 (시간 클릭) 도 baseline = currentSelected (사용자 클릭 시간)
  // 박아서, 1초 tick 후 자연 일치로 자동 갱신 → 사용자 클릭 시간이 현재시간으로 덮어쓰임.
  // 정공: baseline = floorToHourMs(live) (자동 모드 baseline). 사용자 클릭 시간 또는 명시 변경
  // 영역은 currentSelected ≠ baseline 으로 자연 lock.
  const prevAutoMsRef = useRef<number>(0);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!nowReady || isEdit) return;
    const currentSelected = selectedHourMs + minute * 60_000;
    // 첫 mount 시 baseline = 자동 모드 baseline (live floor).
    // 사용자 클릭 시간 (prefillStartAt) 박혔으면 currentSelected ≠ baseline → 자연 lock.
    // 일반 진입 (prefillStartAt 없음 · nowSnapshot 박힘) → currentSelected = baseline → 자동 모드 자연 시작.
    if (prevAutoMsRef.current === 0) {
      const {hourMs: liveHourMs0, remainderMin: liveMin0} = floorToHourMs(live);
      prevAutoMsRef.current = liveHourMs0 + liveMin0 * 60_000;
      return;
    }
    // 사용자 명시 변경 → lock (자동 갱신 안 함)
    if (currentSelected !== prevAutoMsRef.current) return;
    // 자동 갱신: live 의 hour boundary + remainder
    const {hourMs: newHourMs, remainderMin: newMinute} = floorToHourMs(live);
    const newAutoMs = newHourMs + newMinute * 60_000;
    if (newAutoMs === currentSelected) return; // 동일 → noop (1초 tick 안 분 안 바뀜)
    setSelectedHourMs(newHourMs);
    setMinute(newMinute);
    prevAutoMsRef.current = newAutoMs;
  }, [live, selectedHourMs, minute, nowReady, isEdit]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // minute select 옵션 동적 — 편집 모드 또는 마지막 다음 클릭 시 minute 가 옵션 밖이면 추가.
  const minuteOptions = useMemo(() => {
    if (MINUTE_OPTIONS.includes(minute)) return MINUTE_OPTIONS;
    return [...MINUTE_OPTIONS, minute].sort((a, b) => a - b);
  }, [minute]);

  const isDirty = editing
    ? title.trim() !== editing.title ||
      categoryId !== editing.categoryId ||
      startAt !== editing.startAt ||
      durationMin !== editingDurationMin ||
      chainedToPrev !== (editing.chainedToPrev ?? false)
    : false;

  // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #11: durationMin 0 허용 (submit 시점 30 fallback).
  // #10 디폴트 "새 스케줄" 도 baseOk 통과 (title.trim() 길이 검증만).
  const baseOk =
    title.trim().length > 0 &&
    categoryId !== '' &&
    categoryId !== '__NEW__' &&
    !busy;

  // PLAN1-TIMER-DUP-20260504 #6.1: overlap 검사 (MAX_OVERLAP=2 한도). 3건+ 차단.
  // durationMin=0 은 finalDuration 30 fallback 으로 등록되므로 overlap 도 같은 기준으로 계산.
  // (logic-critic Major — durationMin=0 시 overlaps=[] 되어 MAX_OVERLAP 한도 우회 차단)
  const effOverlapDuration = durationMin === 0 ? 30 : durationMin;
  const overlaps = useMemo(
    () => findOverlapping(schedules, startAt, effOverlapDuration, editing?.id),
    [schedules, startAt, effOverlapDuration, editing?.id]
  );
  const overlapBlocked = overlaps.length >= MAX_OVERLAP;

  // PLAN1-SCHEDULE-INSERT-BETWEEN-20260602 — startAt 정확 일치 충돌(B 시작 시간에 넣기) 감지.
  //   - conflictGroup: 새 추가 모드 + 같은 startAt active 그룹 (B, 겹친 X...).
  //   - canSameTime: 추가 후 겹침 ≤ MAX_OVERLAP (P2: 이미 2개면 false → ① 불가).
  //   - canInsertBetween: 직전 active 존재 (P1: B 첫 일정이면 false → ② 불가).
  const conflictGroup = useMemo(
    () =>
      !isEdit && nowReady && durationMin >= 0
        ? schedules.filter(s => s.status !== 'done' && s.startAt === startAt)
        : [],
    [schedules, startAt, isEdit, nowReady, durationMin]
  );
  const hasConflict = conflictGroup.length > 0;
  // ① 같은 시간 가능 = 추가 후 전체 동시 점유(정확 일치 + 부분 겹침 모두) ≤ MAX_OVERLAP.
  // conflictGroup(정확 일치)만 세면 부분 겹침 동시 존재 시 한도 우회 (logic-critic Major) → overlaps 기준.
  const canSameTime = overlaps.length + 1 <= MAX_OVERLAP;
  // ② 사이 삽입 가능 = 직전 active 존재 + gap ≥ 0 (gap<0 비정상 겹침이면 server 도 null → 사전 차단).
  const canInsertBetween = useMemo(() => {
    if (isEdit) return false;
    const prev = schedules.filter(s => s.status !== 'done' && s.startAt < startAt);
    if (prev.length === 0) return false;
    const a = prev.reduce((m, s) => (s.startAt > m.startAt ? s : m));
    return startAt - (a.startAt + a.durationMin * 60_000) >= 0;
  }, [schedules, startAt, isEdit]);

  // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #5 (Q-NEW3 둘다): prev chain 시각화 — 새 schedule 의 직전 chain 보여줌.
  const prevChain = useMemo(
    () =>
      chainedToPrev && !isEdit && nowReady
        ? getPrevChain(schedules, startAt, live)
        : [],
    [schedules, startAt, chainedToPrev, isEdit, nowReady, live]
  );

  // add 모드: nowReady 필수 (hydration 전 submit 차단). edit 모드: 미래 검증 면제.
  // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #12: isFuture 검증 폐기 (자동 갱신으로 startAt 항상 현재 시각).
  // PLAN1-SCHEDULE-INSERT-BETWEEN-20260602: 정확 일치 충돌이면 overlapBlocked 우회 — 선택지(①/②)로 처리.
  //   둘 중 하나라도 가능하면 submit 허용(선택지 열림). 둘 다 불가일 때만 차단.
  //   정확 일치 아닌 부분 겹침 3개째는 기존 overlapBlocked 차단 유지.
  const blockedForAdd = hasConflict ? !(canSameTime || canInsertBetween) : overlapBlocked;
  const canSubmit = isEdit
    ? baseOk && isDirty && !overlapBlocked
    : baseOk && nowReady && !blockedForAdd;

  // PLAN1-SCHEDULE-INSERT-BETWEEN-20260602 — 선택 패널은 트리거 시점 conflictStart 와 현재
  // startAt 이 일치할 때만 유효. 시·분 변경 시 파생값이 null 되어 자동 무효화 (stale conflictStart
  // 로 ①/② 가 다른 시각에 작동하는 모순 차단 · useEffect+setState 회피 — logic-critic Major).
  const insertChoiceActive =
    insertChoice && insertChoice.conflictStart === startAt ? insertChoice : null;

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

  // PLAN1-SCHEDULE-INSERT-BETWEEN-20260602 — submit/선택 핸들러 공유 입력 빌더.
  const buildScheduleInput = () => {
    // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #11: durationMin 0 → 30 fallback.
    const finalDuration = durationMin === 0 ? 30 : durationMin;
    // #10: title 디폴트 "새 스케줄" 그대로 등록 가능.
    const finalTitle = title.trim() || titleDefault;
    // PLAN1-CHAIN-FOCUS-GUARD-20260510 (C 옵션): 새 schedule 등록 시점 focus view 안
    // prior schedule 0개면 chainedToPrev 강제 false. 편집 모드는 영향 X.
    let effectiveChainedToPrev = chainedToPrev;
    if (!isEdit && chainedToPrev) {
      const focus = focusBounds(focusViewMin, live);
      const priorInFocus = schedules.filter(
        s => s.startAt < startAt && s.startAt >= focus.startMs && s.startAt < focus.endMs
      );
      if (priorInFocus.length === 0) {
        effectiveChainedToPrev = false;
      }
    }
    return {
      title: finalTitle,
      categoryId,
      startAt,
      durationMin: finalDuration,
      timerType: 'countup' as const,
      chainedToPrev: effectiveChainedToPrev
    };
  };

  const submit = async () => {
    if (!canSubmit) return;
    // 새 추가 + startAt 정확 일치 충돌 → 선택지 패널 (① 같은 시간 / ② 사이 삽입).
    if (!isEdit && hasConflict) {
      setSubmitError(null);
      setInsertChoice({
        conflictId: conflictGroup[0].id,
        conflictStart: startAt,
        canSameTime,
        canInsertBetween
      });
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const input = buildScheduleInput();
    try {
      if (isEdit && editing) {
        await updateSchedule(editing.id, {
          title: input.title,
          categoryId: input.categoryId,
          startAt: input.startAt,
          durationMin: input.durationMin,
          chainedToPrev: input.chainedToPrev
        });
      } else {
        await addSchedule(input);
      }
      onClose();
    } catch (err) {
      handleMutationError(err, 'submit');
    } finally {
      setBusy(false);
    }
  };

  // ① 같은 시간에 추가 (겹침). 기존 addSchedule 경로.
  const handleInsertSameTime = async () => {
    if (busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await addSchedule(buildScheduleInput());
      onClose();
    } catch (err) {
      handleMutationError(err, 'insertSameTime');
    } finally {
      setBusy(false);
    }
  };

  // ② 사이 삽입 (갭 보존 + 뒤 밀기). insertScheduleBetween 경로.
  const handleInsertBetween = async () => {
    if (busy || !insertChoiceActive) return;
    setBusy(true);
    setSubmitError(null);
    const input = buildScheduleInput();
    try {
      await insertScheduleBetween({
        title: input.title,
        categoryId: input.categoryId,
        durationMin: input.durationMin,
        timerType: 'countup',
        conflictId: insertChoiceActive.conflictId,
        expectedConflictStart: insertChoiceActive.conflictStart
      });
      onClose();
    } catch (err) {
      handleMutationError(err, 'insertBetween');
    } finally {
      setBusy(false);
    }
  };

  // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #15: 즉시 삭제 (확인 단계 폐기 · undo bar 회복).
  const handleDelete = async () => {
    if (!editing || busy) return;
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
                onFocus={handleTitleFocus}
                className={fieldCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-txt">{t('schedule.fieldCategory')}</span>
              <select
                value={categoryId}
                onChange={e => handleCategoryChange(e.target.value)}
                className={fieldCls}
              >
                {/* 소프트 삭제(대장 2026-07-03): 활성만 노출. 편집 중 스케줄이 삭제된 카테고리면 그것도 표시. */}
                {categories
                  .filter(c => !c.deletedAt || c.id === categoryId)
                  .map(c => (
                    <option key={c.id} value={c.id}>
                      {categoryDisplay(c)}
                    </option>
                  ))}
                <option value="__NEW__">{t('schedule.categoryAddOption')}</option>
              </select>
            </label>
            {/* PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #4·#6·#9·#12:
                  - hour select: disabled separator (5.6(수) 그룹 헤더)
                  - grid-cols-3 (시작시 | 시작분 | 마지막직후 · 세로 통일)
                  - 마지막 직후: 0건 또는 24h 밖이면 Date.now() 박음 (disabled X) */}
            <div className="grid grid-cols-3 gap-2">
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
                  {/* PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 (Q-NEW12 b): disabled separator pattern (a11y 안전).
                      PLAN1-HOUR-SEP-20260601 (대장): 첫 옵션(시작일) leading separator 폐기 —
                      실제 날짜 경계(tomorrow 전환) 직전에만 separator 박음 (— 6.2(화) — 유지). */}
                  {hourOptions.map((opt, idx) => {
                    const prev = idx > 0 ? hourOptions[idx - 1] : null;
                    const showSeparator =
                      prev !== null && prev.isTomorrow !== opt.isTomorrow;
                    const dayDate = new Date(opt.value);
                    const dayLabel = formatDateShort(dayDate, w => weekdayLabel(w));
                    return (
                      <Fragment key={opt.value}>
                        {showSeparator && (
                          <option disabled value={`__sep_${opt.value}`}>
                            ━ {dayLabel} ━
                          </option>
                        )}
                        <option value={String(opt.value)}>
                          {pad2(opt.hourLabel)}
                          {t('schedule.hourSuffix')}
                        </option>
                      </Fragment>
                    );
                  })}
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
              {/* PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #6: 마지막 직후 버튼 — grid-cols-3 안 세로 통일 (label spacer + 버튼).
                  2026-05-06 fix: select 와 height 정합 + 취소 버튼 색 (border-line bg-panel text-txt) 통일 */}
              {!isEdit && (
                <div className="flex flex-col">
                  <span className="mb-1 block text-sm text-txt opacity-0 select-none">.</span>
                  <button
                    type="button"
                    onClick={handleAfterLast}
                    className="w-full rounded-none border border-line bg-panel px-3 py-2 text-sm text-txt font-mono hover:bg-bg cursor-pointer"
                  >
                    {t('schedule.buttonAfterLast')}
                  </button>
                </div>
              )}
            </div>
            {/* PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #12: warningFutureRequired 영역 폐기 (자동 갱신). */}
            {durationMin > 0 && overlapBlocked && !hasConflict && (
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
            {/* PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #7: "종료 시간" 라벨 + placeholder. */}
            <div className="text-xs font-mono text-muted">
              {t('schedule.endLabelV2')}:{' '}
              {durationMin > 0 ? (
                formatEndDisplay(endAt, weekdayLabel)
              ) : (
                <span className="text-muted opacity-60">{t('schedule.endPlaceholder')}</span>
              )}
            </div>
            {/* 앱 plan1app 정합(대장 2026-07-02): '앞 일정과 연결' 체크박스 → '시작 시간 고정' 토글로 전환.
                연결이 디폴트(chainedToPrev=true·체크 해제), 체크 시 연결 해제 = 고정 시작(chainedToPrev=false).
                따라서 체크 상태 = !chainedToPrev, onChange 시 반전. */}
            <label className="flex items-start gap-2 text-sm text-txt font-mono">
              <input
                type="checkbox"
                checked={!chainedToPrev}
                onChange={e => setChainedToPrev(!e.target.checked)}
                className="mt-1"
              />
              <span>{t('schedule.fixedStartCheckbox')}</span>
            </label>
            {/* PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #5 (Q-NEW3 둘다): prev chain 시각 박스 (add 모드 + chained=true 시). */}
            {!isEdit && chainedToPrev && prevChain.length > 0 && (
              <div className="rounded-none border border-dashed border-line bg-bg p-2">
                <span className="mb-1 block text-[10px] text-muted font-mono uppercase tracking-wider">
                  {t('schedule.prevChainLabel')}
                </span>
                <ul className="space-y-1">
                  {prevChain.map(s => (
                    <li key={s.id} className="flex items-center justify-between text-xs font-mono text-txt">
                      <span className="truncate">▸ {s.title}</span>
                      <span className="ml-2 text-muted whitespace-nowrap">
                        {pad2(new Date(s.startAt).getHours())}:{pad2(new Date(s.startAt).getMinutes())}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="mt-6 flex flex-col gap-2">
            {submitError && (
              <p
                className="text-xs text-danger font-mono"
                role="alert"
                aria-live="polite"
              >
                {submitError}
              </p>
            )}
            {insertChoiceActive ? (
              /* PLAN1-SCHEDULE-INSERT-BETWEEN-20260602 — 시작 시간 충돌 선택 패널.
                 P1(직전 없음): ②만 숨김 → ①. P2(이미 2개 겹침): ① 숨김 → ②. */
              <div className="flex flex-col gap-2" data-testid="insert-choice">
                <p className="text-sm text-txt font-mono">{t('insert.conflictPrompt')}</p>
                {insertChoiceActive.canSameTime && (
                  <button
                    type="button"
                    onClick={handleInsertSameTime}
                    disabled={busy}
                    data-testid="insert-same-time"
                    className="inline-flex items-center gap-1.5 rounded-none border border-line bg-panel px-4 py-2 text-sm text-txt font-mono hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy && <Spinner size={12} />}
                    {t('insert.sameTime')}
                  </button>
                )}
                {insertChoiceActive.canInsertBetween && (
                  <button
                    type="button"
                    onClick={handleInsertBetween}
                    disabled={busy}
                    data-testid="insert-between"
                    className="inline-flex items-center gap-1.5 rounded-none border border-ink bg-ink px-4 py-2 text-sm text-bg font-mono hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy && <Spinner size={12} />}
                    {t('insert.between')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInsertChoice(null)}
                  disabled={busy}
                  className="rounded-none border border-line bg-panel px-4 py-2 text-sm text-txt font-mono hover:bg-bg disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
              </div>
            ) : (
              /* PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #14: 삭제 + 취소 + 저장 같은 row · y 통일 */
              <div className="flex items-center justify-between gap-2">
                {/* 좌측: 삭제 (편집 모드만 · 그 외 빈 영역) */}
                {isEdit ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-none border border-danger bg-panel px-4 py-2 text-sm text-danger font-mono hover:bg-[rgba(224,108,117,0.1)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy && <Spinner size={12} />}
                    {t('common.delete')}
                  </button>
                ) : (
                  <span />
                )}
                {/* 우측: 취소 + 저장 */}
                <div className="flex gap-2">
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
                    className="inline-flex items-center gap-1.5 rounded-none border border-ink bg-ink px-4 py-2 text-sm text-bg font-mono hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy && <Spinner size={12} />}
                    {submitLabel}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {catOpen && <CategoryManager onClose={() => setCatOpen(false)} />}
    </>
  );
}
