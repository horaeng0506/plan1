'use client';

import {useEffect, useState} from 'react';
import {useTranslations} from 'next-intl';
import {logClientError} from '@/lib/log';
import {useAppStore} from '@/lib/store';
import {clearUndo, useUndo, UNDO_TTL_MS} from '@/lib/undo-store';

/**
 * 화면 최하단 중앙 fixed bar — 5초 progress + "실행 취소" 버튼.
 * (PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #17 · Q-NEW8 a · Q-NEW9 a)
 *
 * 동작:
 *   - useUndo 가 pending entry 받음
 *   - mount 시 progress=100% → 5초간 0% 까지 줄어듦 (CSS transition)
 *   - 클릭 시 clearUndo + store action 호출 (revert)
 *   - 5초 자동 commit 시 자연 사라짐
 *
 * Q-NEW9 a 정합: prevState 1건만. cascade 자연 정합 (server action 가 cascade 재계산).
 */
export function UndoBar() {
  const t = useTranslations();
  const undo = useUndo();
  const addSchedule = useAppStore(s => s.addSchedule);
  const updateSchedule = useAppStore(s => s.updateSchedule);
  const removeSchedule = useAppStore(s => s.removeSchedule);

  // progress bar 0~100% (mount 시 100 → 0)
  // React 19 react-hooks/set-state-in-effect 와 충돌하지만 진입 시점에 100% 보장 + transition 으로 0% 자연 이동.
  const [progress, setProgress] = useState(100);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!undo) {
      setProgress(100);
      return;
    }
    setProgress(100);
    const tick = setTimeout(() => setProgress(0), 50);
    return () => clearTimeout(tick);
  }, [undo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!undo) return null;

  const handleRevert = () => {
    if (!undo) return;
    clearUndo();
    const action = (async () => {
      if (undo.type === 'add') {
        await removeSchedule(undo.scheduleId);
      } else if (undo.type === 'edit') {
        await updateSchedule(undo.scheduleId, {
          title: undo.prev.title,
          categoryId: undo.prev.categoryId,
          startAt: undo.prev.startAt,
          durationMin: undo.prev.durationMin,
          timerType: undo.prev.timerType,
          chainedToPrev: undo.prev.chainedToPrev
        });
      } else if (undo.type === 'delete') {
        await addSchedule({
          title: undo.schedule.title,
          categoryId: undo.schedule.categoryId,
          startAt: undo.schedule.startAt,
          durationMin: undo.schedule.durationMin,
          timerType: undo.schedule.timerType,
          chainedToPrev: undo.schedule.chainedToPrev
        });
      }
    })();
    action.catch(err => logClientError('[UndoBar revert]', err));
  };

  return (
    <div
      className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-none border border-line bg-panel px-4 py-2 shadow-lg"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-txt">{t('undo.actionLabel')}</span>
        <button
          type="button"
          onClick={handleRevert}
          className="rounded-none border border-ink bg-ink px-3 py-1 text-xs font-mono text-bg hover:opacity-90"
        >
          {t('undo.button')}
        </button>
      </div>
      {/* progress bar — 5초 안 100% → 0% */}
      <div className="mt-1 h-0.5 w-full overflow-hidden bg-line">
        <div
          className="h-full bg-success"
          style={{
            width: `${progress}%`,
            transition: progress === 100 ? 'none' : `width ${UNDO_TTL_MS}ms linear`
          }}
        />
      </div>
    </div>
  );
}
