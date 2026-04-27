'use client';

import {useEffect, useState} from 'react';
import {useAppStore} from '@/lib/store';
import {runMutation} from '@/lib/run-mutation';

export function CategoryManager({onClose}: {onClose: () => void}) {
  const categories = useAppStore(s => s.categories);
  const schedules = useAppStore(s => s.schedules);
  const addCategory = useAppStore(s => s.addCategory);
  const removeCategory = useAppStore(s => s.removeCategory);

  const [name, setName] = useState('');
  const [color, setColor] = useState('#6b7280');
  const [busy, setBusy] = useState(false);
  // 카테고리별 confirm armed state. id 가 들어있으면 다음 클릭 = 실제 삭제 (force=true).
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Stage 3f logic-critic Critical fix: confirmId 잠금 누수 차단.
  useEffect(() => {
    if (confirmId && !categories.find(c => c.id === confirmId)) setConfirmId(null);
  }, [categories, confirmId]);

  const canAdd = name.trim().length > 0 && !busy;

  const scheduleCountByCat = (id: string) =>
    schedules.filter(s => s.categoryId === id).length;

  const handleAdd = async () => {
    if (!canAdd) return;
    setBusy(true);
    try {
      await addCategory({name: name.trim(), color});
      setName('');
      setColor('#6b7280');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (busy) return;
    if (confirmId && confirmId !== id) {
      setConfirmId(null);
    }
    const count = scheduleCountByCat(id);
    if (count === 0) {
      runMutation(removeCategory(id, false), 'remove category');
      if (confirmId === id) setConfirmId(null);
      return;
    }
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setBusy(true);
    try {
      await removeCategory(id, true);
      setConfirmId(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[mutation · remove category cascade]', err);
    } finally {
      setBusy(false);
    }
  };

  // Stage 4a 4채널 토큰화.
  const fieldCls =
    'w-full rounded-none border border-line bg-bg px-3 py-2 text-ink font-mono';
  const dangerArmedBtn =
    'rounded-none border border-danger bg-danger px-2 py-0.5 text-xs text-bg font-mono hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
  const dangerOutlineBtn =
    'rounded-none border border-danger bg-panel px-2 py-0.5 text-xs text-danger font-mono hover:bg-[rgba(224,108,117,0.1)] disabled:cursor-not-allowed disabled:opacity-50';
  const neutralRmBtn =
    'rounded-none border border-line bg-panel px-2 py-0.5 text-xs text-txt font-mono hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.75)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-none border border-line bg-panel p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-ink">
          <span className="text-success">$ </span>category --manage
        </h2>

        <ul className="mb-4 space-y-1 max-h-64 overflow-y-auto">
          {categories.length === 0 && (
            <li className="text-sm text-muted">카테고리가 없습니다.</li>
          )}
          {categories.map(c => {
            const count = scheduleCountByCat(c.id);
            const armed = confirmId === c.id;
            return (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-none px-2 py-1 hover:bg-bg"
              >
                <span className="flex items-center gap-2 text-sm text-ink font-mono">
                  <span className="text-muted">▸</span>
                  <span
                    className="inline-block h-3 w-3 rounded-none"
                    style={{backgroundColor: c.color}}
                  />
                  {c.name}
                  {count > 0 && (
                    <span className="text-[10px] text-muted">· {count} 스케줄</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(c.id)}
                  disabled={busy}
                  className={armed ? dangerArmedBtn : count > 0 ? dangerOutlineBtn : neutralRmBtn}
                >
                  {armed ? `confirm rm (${count})` : 'rm'}
                </button>
              </li>
            );
          })}
        </ul>
        {confirmId && (
          <div className="mb-4 border border-danger bg-[rgba(224,108,117,0.1)] px-3 py-2 text-xs font-mono text-danger">
            <span className="font-semibold">! </span>
            {scheduleCountByCat(confirmId)}개 스케줄이 함께 삭제됩니다. 다시 클릭하면 즉시 실행.
            <button
              type="button"
              onClick={() => setConfirmId(null)}
              className="ml-2 underline"
            >
              cancel
            </button>
          </div>
        )}

        <div className="space-y-3 border-t border-line pt-4">
          <label className="block">
            <span className="mb-1 block text-sm text-txt">--name</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className={fieldCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-txt">--color</span>
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="h-10 w-20 rounded-none border border-line"
            />
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="w-full rounded-none border border-ink bg-ink px-4 py-2 text-sm text-bg font-mono hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="opacity-70">$ </span>add
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-none border border-line bg-panel px-4 py-2 text-sm text-txt font-mono hover:bg-bg"
          >
            close
          </button>
        </div>
      </div>
    </div>
  );
}
