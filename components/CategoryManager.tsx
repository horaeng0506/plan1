'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {useEscapeKey} from '@/lib/use-escape-key';
import {useCategoryDisplay} from '@/lib/category-display';

export function CategoryManager({onClose}: {onClose: () => void}) {
  const t = useTranslations();
  const runMutation = useRunMutation();
  const categoryDisplay = useCategoryDisplay();
  const categories = useAppStore(s => s.categories);
  const addCategory = useAppStore(s => s.addCategory);
  const removeCategory = useAppStore(s => s.removeCategory);

  // 소프트 삭제(대장 2026-07-03): 목록/선택엔 활성만. 삭제분은 색 렌더용으로 store 에만 유지.
  const visibleCategories = categories.filter(c => !c.deletedAt);

  const [name, setName] = useState('');
  const [color, setColor] = useState('#6b7280');
  const [busy, setBusy] = useState(false);

  // Stage 4d-C a11y: Esc → close. busy 중에는 비활성 (mid-mutation 회피).
  useEscapeKey(onClose, !busy);

  const canAdd = name.trim().length > 0 && !busy;

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

  const handleRemove = (id: string) => {
    // 소프트 삭제 — 스케줄 보존(그 카테고리 색 유지). 마지막 활성 1개는 삭제 불가.
    // busy 락: 삭제 mutation in-flight 동안 버튼 disable → double-click 동시 삭제(활성 0) 봉쇄.
    if (busy || visibleCategories.length <= 1) return;
    setBusy(true);
    const p = removeCategory(id, false);
    runMutation(p, 'removeCategory');
    void p.then(
      () => {},
      () => {}
    ).finally(() => setBusy(false));
  };

  const fieldCls =
    'w-full rounded-none border border-line bg-bg px-3 py-2 text-ink font-mono';
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
        <h2 className="mb-4 text-sm font-semibold text-success font-mono">
          {t('category.header')}
        </h2>

        <ul className="mb-4 space-y-1 max-h-64 overflow-y-auto">
          {visibleCategories.length === 0 && (
            <li className="text-sm text-muted">{t('category.empty')}</li>
          )}
          {visibleCategories.map(c => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-none px-2 py-1 hover:bg-bg"
            >
              <span className="flex items-center gap-2 text-sm text-ink font-mono">
                <span
                  className="inline-block h-3 w-3 rounded-none"
                  style={{backgroundColor: c.color}}
                />
                {categoryDisplay(c)}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(c.id)}
                disabled={busy || visibleCategories.length <= 1}
                className={neutralRmBtn}
              >
                {t('category.removeButton')}
              </button>
            </li>
          ))}
        </ul>

        <div className="space-y-3 border-t border-line pt-4">
          <label className="block">
            <span className="mb-1 block text-sm text-txt font-mono">{t('category.fieldName')}</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className={fieldCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-txt font-mono">{t('category.fieldColor')}</span>
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
