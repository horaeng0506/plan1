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
  // schedules 변경(다른 모달에서 add/remove) → armed 카테고리의 count 가 바뀌면 confirm 무효화.
  // categories 변경(이미 다른 경로로 삭제됨) 시에도 reset.
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
    // 다른 카테고리 클릭 시 이전 armed reset (한 번에 하나만 armed).
    if (confirmId && confirmId !== id) {
      setConfirmId(null);
    }
    const count = scheduleCountByCat(id);
    if (count === 0) {
      // 안전한 삭제 — force 불필요. 다른 카테고리가 armed 상태였다면 위에서 이미 reset.
      runMutation(removeCategory(id, false), 'remove category');
      if (confirmId === id) setConfirmId(null);
      return;
    }
    // schedules 가 연결돼 있음 — 1차 클릭은 confirm armed, 2차 클릭은 force=true 삭제.
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(7,8,10,0.75)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-none border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <span className="text-[#98c379]">$ </span>category --manage
        </h2>

        <ul className="mb-4 space-y-1 max-h-64 overflow-y-auto">
          {categories.length === 0 && (
            <li className="text-sm text-gray-500 dark:text-gray-400">카테고리가 없습니다.</li>
          )}
          {categories.map(c => {
            const count = scheduleCountByCat(c.id);
            const armed = confirmId === c.id;
            return (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-none px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <span className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 font-mono">
                  <span className="text-[#5c6370]">▸</span>
                  <span
                    className="inline-block h-3 w-3 rounded-none"
                    style={{backgroundColor: c.color}}
                  />
                  {c.name}
                  {count > 0 && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      · {count} 스케줄
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(c.id)}
                  disabled={busy}
                  className={
                    armed
                      ? 'rounded-none border border-red-600 bg-red-600 px-2 py-0.5 text-xs text-white font-mono hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400 dark:bg-red-400 dark:text-gray-900 dark:hover:bg-red-300'
                      : count > 0
                      ? 'rounded-none border border-red-600 bg-white px-2 py-0.5 text-xs text-red-600 font-mono hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-400/10'
                      : 'rounded-none border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 font-mono hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
                  }
                >
                  {armed ? `confirm rm (${count})` : 'rm'}
                </button>
              </li>
            );
          })}
        </ul>
        {confirmId && (
          <div className="mb-4 border border-red-600 bg-red-50 px-3 py-2 text-xs font-mono text-red-700 dark:border-red-400 dark:bg-red-400/10 dark:text-red-300">
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

        <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800">
          <label className="block">
            <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">--name</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-none border border-gray-300 bg-white px-3 py-2 text-gray-900 font-mono dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-700 dark:text-gray-300">--color</span>
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="h-10 w-20 rounded-none border border-gray-300 dark:border-gray-700"
            />
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className="w-full rounded-none border border-gray-900 bg-gray-900 px-4 py-2 text-sm text-white font-mono hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          >
            <span className="opacity-70">$ </span>add
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-none border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 font-mono hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            close
          </button>
        </div>
      </div>
    </div>
  );
}
