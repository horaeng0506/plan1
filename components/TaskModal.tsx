'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {useEscapeKey} from '@/lib/use-escape-key';
import {useTaskBucketDisplay} from '@/lib/task-bucket-display';
import type {Task} from '@/lib/domain/types';

/**
 * PLAN1-TASKS-FEATURE-20260509 (S3) — 새 task 박는 modal.
 * PLAN1-TASKS-PRIORITY-20260510 — 편집 모드 + 우선순위 박스 + 소요시간 +/- 버튼.
 * PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 고정 bucket 드롭다운 → 사용자 정의 버킷 드롭다운.
 *   - 선택 버킷이 횟수차감형(isCountBased)이면 '횟수' 입력 노출 (min 1) + category·duration 필수.
 *   - priorityMax 동적 (선택 버킷 기준).
 */

interface TaskModalProps {
  mode: 'create' | 'edit';
  task?: Task;
  onClose: () => void;
}

export function TaskModal({mode, task, onClose}: TaskModalProps) {
  const t = useTranslations();
  const runMutation = useRunMutation();
  const categories = useAppStore(s => s.categories);
  const tasks = useAppStore(s => s.tasks);
  const taskBuckets = useAppStore(s => s.taskBuckets);
  const addTask = useAppStore(s => s.addTask);
  const updateTaskAction = useAppStore(s => s.updateTaskAction);
  const bucketDisplay = useTaskBucketDisplay();

  const isEdit = mode === 'edit' && task !== undefined;
  const initialBucketId = isEdit
    ? task!.bucketId ?? taskBuckets[0]?.id ?? ''
    : taskBuckets[0]?.id ?? '';

  const [title, setTitle] = useState(task?.title ?? '');
  const [durationMin, setDurationMin] = useState<number>(task?.durationMin ?? 0);
  const [categoryId, setCategoryId] = useState<string>(
    // 신규 기본값은 활성 우선 (소프트 삭제분 배제 · 대장 2026-07-03).
    task?.categoryId ?? categories.find(c => !c.deletedAt)?.id ?? ''
  );
  const [bucketId, setBucketId] = useState<string>(initialBucketId);
  const [count, setCount] = useState<number>(task?.count ?? 1);
  const [busy, setBusy] = useState(false);

  useEscapeKey(onClose, !busy);

  // ⚡ cold-load race fix (PLAN1-TASKS-BUCKET-CUSTOM-20260531):
  // 모달 mount 시점에 store.taskBuckets 가 아직 빈 순간이면 initialBucketId='' 로 캡처됨.
  // effect+setState 대신 derived 값으로 보정 — bucketId state 가 '' 면 첫 버킷으로 fallback
  // (dropdown 채워지면 자동 정합). 사용자가 dropdown 변경 시 setBucketId 로 state 가 우선.
  const effectiveBucketId = bucketId !== '' ? bucketId : taskBuckets[0]?.id ?? '';
  const selectedBucket = taskBuckets.find(b => b.id === effectiveBucketId);
  // PLAN1-TASKS-BUCKET-KIND-20260602 — kind==='count' 가 옛 isCountBased (count 필드 표시 조건).
  const isCountBased = selectedBucket?.kind === 'count';

  // priorityMax 계산 (선택 버킷 기준 · 동적).
  const computeMax = (bId: string): number => {
    const c = tasks.filter(tk => tk.bucketId === bId).length;
    if (!isEdit) return c + 1;
    return bId === initialBucketId ? c : c + 1;
  };
  const priorityMax = Math.max(1, computeMax(effectiveBucketId));
  const initialPriority = isEdit ? task!.priority ?? 1 : 1;
  const [priority, setPriority] = useState<number>(initialPriority);

  const handleBucketChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBucketId = e.target.value;
    setBucketId(newBucketId);
    const newMax = Math.max(1, computeMax(newBucketId));
    if (priority > newMax) setPriority(newMax);
  };

  const bumpDuration = (delta: number) => {
    setDurationMin(d => Math.max(0, d + delta));
  };

  // 횟수차감형이면 category·duration 필수 (server 강제와 정합 · UI 가드).
  const countNeedsMissing =
    isCountBased && (categoryId === '' || durationMin <= 0);

  const handleSubmit = async () => {
    if (busy || countNeedsMissing || effectiveBucketId === '') return;
    setBusy(true);
    const trimmedTitle = title.trim();
    const finalTitle = trimmedTitle === '' ? null : trimmedTitle;
    const finalDuration = durationMin <= 0 ? null : durationMin;
    const finalCategoryId = categoryId === '' ? null : categoryId;
    const finalCount = isCountBased ? Math.max(1, Math.floor(count)) : null;
    try {
      if (isEdit) {
        await runMutation(
          updateTaskAction({
            id: task!.id,
            title: finalTitle,
            durationMin: finalDuration,
            categoryId: finalCategoryId,
            priority,
            bucketId: effectiveBucketId,
            count: finalCount
          }),
          'updateTask'
        );
      } else {
        await runMutation(
          addTask({
            title: finalTitle,
            durationMin: finalDuration,
            categoryId: finalCategoryId,
            priority,
            bucketId: effectiveBucketId,
            count: finalCount
          }),
          'addTask'
        );
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const fieldCls =
    'w-full rounded-none border border-line bg-bg px-2 py-1 text-sm text-txt focus:border-ink focus:outline-none';
  const adjustBtn =
    'rounded-none border border-line bg-panel px-2 py-1 text-xs text-txt hover:bg-bg disabled:opacity-50';
  const priorityBtnBase =
    'rounded-none border border-line px-2 py-1 text-xs font-mono w-8 h-7 flex items-center justify-center';

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-none border border-line bg-panel p-6 font-mono" data-testid="task-modal">
        <h2 className="mb-4 text-sm font-medium text-ink">
          {isEdit ? t('task.modalEditHeading') : t('task.modalHeading')}
        </h2>
        {/* PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 버킷 드롭다운 (사용자 정의 · title 위). */}
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted" htmlFor="task-bucket">
            {t('task.fieldBucket')}
          </label>
          <select
            id="task-bucket"
            value={effectiveBucketId}
            onChange={handleBucketChange}
            disabled={busy}
            className={fieldCls}
          >
            {taskBuckets.map(b => (
              <option key={b.id} value={b.id}>{bucketDisplay(b)}</option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted" htmlFor="task-title">
            {t('task.fieldTitle')}
          </label>
          <input
            id="task-title"
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={busy}
            className={fieldCls}
          />
        </div>
        {/* 횟수차감형 버킷 → 횟수 입력 (min 1). */}
        {isCountBased && (
          <div className="mb-3">
            <label className="mb-1 block text-xs text-muted" htmlFor="task-count">
              {t('task.fieldCount')}
            </label>
            <input
              id="task-count"
              type="number"
              min={1}
              value={count}
              onChange={e => setCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              disabled={busy}
              className={fieldCls}
            />
          </div>
        )}
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted" htmlFor="task-duration">
            {t('task.fieldDuration')}
          </label>
          <input
            id="task-duration"
            type="number"
            min={0}
            value={durationMin}
            onChange={e => setDurationMin(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            disabled={busy}
            className={fieldCls}
          />
          <div className="mt-2 flex flex-wrap gap-1">
            <button type="button" onClick={() => bumpDuration(10)} disabled={busy} className={adjustBtn}>
              {t('schedule.buttonPlus10')}
            </button>
            <button type="button" onClick={() => bumpDuration(30)} disabled={busy} className={adjustBtn}>
              {t('schedule.buttonPlus30')}
            </button>
            <button type="button" onClick={() => bumpDuration(60)} disabled={busy} className={adjustBtn}>
              {t('schedule.buttonPlusHour')}
            </button>
          </div>
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted" htmlFor="task-category">
            {t('task.fieldCategory')}
          </label>
          <select
            id="task-category"
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
            disabled={busy}
            className={fieldCls}
          >
            <option value="">—</option>
            {/* 소프트 삭제(대장 2026-07-03): 활성만. 편집 중 태스크가 삭제된 카테고리면 그것도 표시. */}
            {categories
              .filter(c => !c.deletedAt || c.id === categoryId)
              .map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        </div>
        <div className="mb-4">
          <span className="mb-1 block text-xs text-muted">{t('task.fieldPriority')}</span>
          <div className="flex flex-wrap gap-1">
            {Array.from({length: priorityMax}, (_, i) => i + 1).map(p => {
              const selected = p === priority;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  disabled={busy}
                  className={
                    selected
                      ? `${priorityBtnBase} border-ink bg-ink text-bg`
                      : `${priorityBtnBase} bg-panel text-txt hover:bg-bg`
                  }
                  aria-pressed={selected}
                  aria-label={`${t('task.fieldPriority')} ${p}`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        {countNeedsMissing && (
          <p className="mb-3 text-xs text-danger">{t('task.countNeedsFields')}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-none border border-line bg-panel px-3 py-1 text-xs text-txt hover:bg-bg disabled:opacity-50"
          >
            {t('task.actionCancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || countNeedsMissing || effectiveBucketId === ''}
            className="rounded-none border border-ink bg-ink px-3 py-1 text-xs text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isEdit ? t('task.actionSave') : t('task.actionAdd')}
          </button>
        </div>
      </div>
    </div>
  );
}
