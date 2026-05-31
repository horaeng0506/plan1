'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {logClientError} from '@/lib/log';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {useEscapeKey} from '@/lib/use-escape-key';
import {useTaskBucketDisplay} from '@/lib/task-bucket-display';
import type {TaskBucketInfo} from '@/lib/domain/types';

/**
 * PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 할일 카테고리(버킷) 관리 modal.
 * CategoryManager 참고 — 단 색 없음 + 횟수차감형(isCountBased) 체크박스.
 *   - 각 버킷 이름 편집 + 횟수차감형 토글 + 삭제(최소 1개 유지 가드 · 소속 task cascade).
 *   - default 버킷은 placeholder 로 현지화 이름 표시(빈 입력 = default 유지).
 */

export function TaskBucketManager({onClose}: {onClose: () => void}) {
  const t = useTranslations();
  const runMutation = useRunMutation();
  const bucketDisplay = useTaskBucketDisplay();
  const taskBuckets = useAppStore(s => s.taskBuckets);
  const tasks = useAppStore(s => s.tasks);
  const addTaskBucket = useAppStore(s => s.addTaskBucket);
  const updateTaskBucketAction = useAppStore(s => s.updateTaskBucketAction);
  const removeTaskBucket = useAppStore(s => s.removeTaskBucket);

  const [newName, setNewName] = useState('');
  const [newCountBased, setNewCountBased] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // 행별 편집 draft. 부재 시 버킷 값에서 파생.
  const [drafts, setDrafts] = useState<Record<string, {name: string; isCountBased: boolean}>>({});

  useEscapeKey(onClose, !busy);

  const draftOf = (b: TaskBucketInfo) =>
    drafts[b.id] ?? {
      name: b.defaultKind !== null && b.name === '' ? '' : b.name,
      isCountBased: b.isCountBased
    };

  const setDraft = (id: string, patch: Partial<{name: string; isCountBased: boolean}>) => {
    setDrafts(d => ({...d, [id]: {...draftOf(taskBuckets.find(b => b.id === id)!), ...d[id], ...patch}}));
  };

  const taskCountByBucket = (id: string) => tasks.filter(tk => tk.bucketId === id).length;

  const canAdd = newName.trim().length > 0 && !busy;

  const handleAdd = async () => {
    if (!canAdd) return;
    setBusy(true);
    try {
      await addTaskBucket({name: newName.trim(), isCountBased: newCountBased});
      setNewName('');
      setNewCountBased(false);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (b: TaskBucketInfo) => {
    if (busy) return;
    const d = draftOf(b);
    setBusy(true);
    try {
      await updateTaskBucketAction({id: b.id, name: d.name.trim(), isCountBased: d.isCountBased});
      setDrafts(prev => {
        const next = {...prev};
        delete next[b.id];
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (b: TaskBucketInfo) => {
    if (busy) return;
    if (confirmId && confirmId !== b.id) setConfirmId(null);
    const count = taskCountByBucket(b.id);
    if (count === 0) {
      runMutation(removeTaskBucket(b.id), 'removeTaskBucket');
      if (confirmId === b.id) setConfirmId(null);
      return;
    }
    if (confirmId !== b.id) {
      setConfirmId(b.id);
      return;
    }
    setBusy(true);
    try {
      await removeTaskBucket(b.id);
      setConfirmId(null);
    } catch (err) {
      logClientError('[mutation · remove task bucket cascade]', err);
    } finally {
      setBusy(false);
    }
  };

  const fieldCls = 'w-full rounded-none border border-line bg-bg px-2 py-1 text-sm text-ink font-mono';
  const dangerArmedBtn =
    'rounded-none border border-danger bg-danger px-2 py-0.5 text-xs text-bg font-mono hover:opacity-90 disabled:opacity-50';
  const dangerOutlineBtn =
    'rounded-none border border-danger bg-panel px-2 py-0.5 text-xs text-danger font-mono hover:bg-[rgba(224,108,117,0.1)] disabled:opacity-50';
  const neutralRmBtn =
    'rounded-none border border-line bg-panel px-2 py-0.5 text-xs text-txt font-mono hover:bg-bg disabled:opacity-50';
  const saveBtn =
    'rounded-none border border-ink bg-ink px-2 py-0.5 text-xs text-bg font-mono hover:opacity-90 disabled:opacity-50';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.75)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-none border border-line bg-panel p-6"
        onClick={e => e.stopPropagation()}
        data-testid="task-bucket-manager"
      >
        <h2 className="mb-4 text-sm font-semibold text-success font-mono">{t('taskBucket.header')}</h2>

        <ul className="mb-4 space-y-2 max-h-72 overflow-y-auto">
          {taskBuckets.map(b => {
            const d = draftOf(b);
            const count = taskCountByBucket(b.id);
            const armed = confirmId === b.id;
            return (
              <li key={b.id} className="rounded-none border border-line px-2 py-2">
                <input
                  type="text"
                  value={d.name}
                  placeholder={bucketDisplay(b)}
                  onChange={e => setDraft(b.id, {name: e.target.value})}
                  className={`${fieldCls} mb-2`}
                  aria-label={t('taskBucket.fieldName')}
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1 text-xs text-txt font-mono">
                    <input
                      type="checkbox"
                      checked={d.isCountBased}
                      onChange={e => setDraft(b.id, {isCountBased: e.target.checked})}
                    />
                    {t('taskBucket.countBased')}
                  </label>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => handleSave(b)} disabled={busy} className={saveBtn}>
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(b)}
                      disabled={busy}
                      className={armed ? dangerArmedBtn : count > 0 ? dangerOutlineBtn : neutralRmBtn}
                    >
                      {armed ? t('taskBucket.confirmRemove', {count}) : t('taskBucket.remove')}
                    </button>
                  </div>
                </div>
                {count > 0 && (
                  <p className="mt-1 text-[10px] text-muted font-mono">
                    {t('taskBucket.taskCountSuffix', {count})}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className="space-y-2 border-t border-line pt-4">
          <span className="block text-sm text-txt font-mono">{t('taskBucket.addHeading')}</span>
          <input
            type="text"
            value={newName}
            placeholder={t('taskBucket.fieldName')}
            onChange={e => setNewName(e.target.value)}
            className={fieldCls}
          />
          <label className="flex items-center gap-1 text-xs text-txt font-mono">
            <input
              type="checkbox"
              checked={newCountBased}
              onChange={e => setNewCountBased(e.target.checked)}
            />
            {t('taskBucket.countBased')}
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="w-full rounded-none border border-ink bg-ink px-4 py-2 text-sm text-bg font-mono hover:opacity-90 disabled:opacity-50"
          >
            {t('common.add')}
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-none border border-line bg-panel px-4 py-2 text-sm text-txt font-mono hover:bg-bg"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
