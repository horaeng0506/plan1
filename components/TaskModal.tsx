'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {useEscapeKey} from '@/lib/use-escape-key';
import type {Task} from '@/lib/domain/types';

/**
 * PLAN1-TASKS-FEATURE-20260509 (S3) — 새 task 박음 modal.
 * PLAN1-TASKS-PRIORITY-20260510 (사양 4·5·6번) — 편집 모드 + 우선순위 박스 버튼 + 소요시간 +/- 버튼.
 *
 * mode:
 *   - 'create': 새 task 박음. priority default 1 (최우선) · max = (현재 task 개수)+1
 *   - 'edit':   기존 task 편집. priority default 박음 = task.priority · max = 현재 task 개수
 *
 * 사양:
 *   - 5번 priority — 카테고리 다음 행 박음. 박스 버튼 1~max. 디폴트 = create 1 / edit task.priority
 *   - 6번 duration — NewScheduleModal 같은 +10/+30/+60 버튼 chain. -10/-30 박지 X (task 영역 단순화)
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
  const addTask = useAppStore(s => s.addTask);
  const updateTaskAction = useAppStore(s => s.updateTaskAction);

  const isEdit = mode === 'edit' && task !== undefined;

  // priority max: edit = 현재 task 개수 · create = (현재 + 1)
  const priorityMax = isEdit ? tasks.length : tasks.length + 1;
  // priority default: edit = task.priority · create = 1 (최우선)
  const initialPriority = isEdit ? (task!.priority ?? 1) : 1;

  const [title, setTitle] = useState(task?.title ?? '');
  const [durationMin, setDurationMin] = useState<number>(task?.durationMin ?? 0);
  const [categoryId, setCategoryId] = useState<string>(
    task?.categoryId ?? categories[0]?.id ?? ''
  );
  const [priority, setPriority] = useState<number>(initialPriority);
  const [busy, setBusy] = useState(false);

  useEscapeKey(onClose, !busy);

  const bumpDuration = (delta: number) => {
    setDurationMin(d => Math.max(0, d + delta));
  };

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true);
    const trimmedTitle = title.trim();
    const finalTitle = trimmedTitle === '' ? null : trimmedTitle;
    const finalDuration = durationMin <= 0 ? null : durationMin;
    const finalCategoryId = categoryId === '' ? null : categoryId;
    try {
      if (isEdit) {
        await runMutation(
          updateTaskAction({
            id: task!.id,
            title: finalTitle,
            durationMin: finalDuration,
            categoryId: finalCategoryId,
            priority
          }),
          'updateTask'
        );
      } else {
        await runMutation(
          addTask({
            title: finalTitle,
            durationMin: finalDuration,
            categoryId: finalCategoryId,
            priority
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
      <div className="w-full max-w-sm rounded-none border border-line bg-panel p-6 font-mono">
        <h2 className="mb-4 text-sm font-medium text-ink">
          {isEdit ? t('task.modalEditHeading') : t('task.modalHeading')}
        </h2>
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
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted" htmlFor="task-duration">
            {t('task.fieldDuration')}
          </label>
          <input
            id="task-duration"
            type="number"
            min={0}
            value={durationMin}
            onChange={e => setDurationMin(Math.max(0, Number(e.target.value) || 0))}
            disabled={busy}
            className={fieldCls}
          />
          <div className="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => bumpDuration(10)}
              disabled={busy}
              className={adjustBtn}
            >
              {t('schedule.buttonPlus10')}
            </button>
            <button
              type="button"
              onClick={() => bumpDuration(30)}
              disabled={busy}
              className={adjustBtn}
            >
              {t('schedule.buttonPlus30')}
            </button>
            <button
              type="button"
              onClick={() => bumpDuration(60)}
              disabled={busy}
              className={adjustBtn}
            >
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
            {categories.map(c => (
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
            disabled={busy}
            className="rounded-none border border-ink bg-ink px-3 py-1 text-xs text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isEdit ? t('task.actionSave') : t('task.actionAdd')}
          </button>
        </div>
      </div>
    </div>
  );
}
