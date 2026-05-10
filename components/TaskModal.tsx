'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {useEscapeKey} from '@/lib/use-escape-key';

export function TaskModal({onClose}: {onClose: () => void}) {
  const t = useTranslations();
  const runMutation = useRunMutation();
  const categories = useAppStore(s => s.categories);
  const addTask = useAppStore(s => s.addTask);

  const [title, setTitle] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  useEscapeKey(onClose, !busy);

  const handleAdd = async () => {
    if (busy) return;
    setBusy(true);
    const trimmedTitle = title.trim();
    const dur = durationMin === '' ? null : Number(durationMin);
    try {
      await runMutation(
        addTask({
          title: trimmedTitle === '' ? null : trimmedTitle,
          durationMin: dur === null || Number.isNaN(dur) ? null : dur,
          categoryId: categoryId === '' ? null : categoryId
        }),
        'addTask'
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-none border border-line bg-panel p-6 font-mono">
        <h2 className="mb-4 text-sm font-medium text-ink">{t('task.modalHeading')}</h2>
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
            className="w-full rounded-none border border-line bg-bg px-2 py-1 text-sm text-txt focus:border-ink focus:outline-none"
          />
        </div>
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted" htmlFor="task-duration">
            {t('task.fieldDuration')}
          </label>
          <input
            id="task-duration"
            type="number"
            min="0"
            value={durationMin}
            onChange={e => setDurationMin(e.target.value)}
            disabled={busy}
            className="w-full rounded-none border border-line bg-bg px-2 py-1 text-sm text-txt focus:border-ink focus:outline-none"
          />
        </div>
        <div className="mb-4">
          <label className="mb-1 block text-xs text-muted" htmlFor="task-category">
            {t('task.fieldCategory')}
          </label>
          <select
            id="task-category"
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
            disabled={busy}
            className="w-full rounded-none border border-line bg-bg px-2 py-1 text-sm text-txt focus:border-ink focus:outline-none"
          >
            <option value="">—</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
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
            onClick={handleAdd}
            disabled={busy}
            className="rounded-none border border-ink bg-ink px-3 py-1 text-xs text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('task.actionAdd')}
          </button>
        </div>
      </div>
    </div>
  );
}