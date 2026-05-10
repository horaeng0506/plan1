'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {decideFlow} from '@/lib/decideFlow';
import {nowMs} from '@/lib/now';
import type {Task} from '@/lib/domain/types';

/**
 * PLAN1-TASKS-FEATURE-20260509 — sidebar 안 task list + 변형 chain.
 * PLAN1-TASKS-PRIORITY-20260510 — 사양 1·2·3·4·7번:
 *   1. 변형 chain 위치 = 기존 + 스케줄 / 삭제 자리 영역 (한 row 안 toggle 박음)
 *   2. schedule 0개 시 "마지막 다음" 박지 X
 *   3. + 할일 → + 단순 박음 (정사각형 box · `+ 할일` 본문 X)
 *   4. task row 클릭 → onEditTask 호출 (편집 모달 PlanApp 안 박음)
 *   7. + 스케줄 → ✓ · 삭제 → ×
 */

interface TaskListProps {
  onNewTask: () => void;
  onEditTask: (task: Task) => void;
}

export function TaskList({onNewTask, onEditTask}: TaskListProps) {
  const t = useTranslations();
  const runMutation = useRunMutation();
  const tasks = useAppStore(s => s.tasks);
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);
  const removeTask = useAppStore(s => s.removeTask);
  const convertTaskToSchedule = useAppStore(s => s.convertTaskToSchedule);

  const [armedTaskId, setArmedTaskId] = useState<string | null>(null);

  // 사양 2번 — 오늘 스케줄 0개 시 "마지막 다음" 박지 X.
  // 본 영영 = pending/active 박음 (done 박지 X · 종결 schedule 박지 X 영역).
  const hasActiveSchedule = schedules.some(s => s.status !== 'done');

  const findLastEndAt = (): number => {
    const now = nowMs();
    let maxEnd = now;
    schedules.forEach(s => {
      if (s.status === 'done') return;
      const endAt = s.startAt + s.durationMin * 60_000;
      if (endAt > now && endAt > maxEnd) maxEnd = endAt;
    });
    return maxEnd === now ? now : maxEnd + 1;
  };

  const handleConvertClick = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    const flow = decideFlow(
      {categoryId: task.categoryId, durationMin: task.durationMin},
      categories
    );
    if (flow.type === 'modal') {
      // 본 사이클 단순화 — modal 분기 박지 X (편집 모달 박음).
      onEditTask(task);
      return;
    }
    setArmedTaskId(task.id);
  };

  const handleConvertNow = async (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    setArmedTaskId(null);
    await runMutation(convertTaskToSchedule(task.id, nowMs(), true), 'convertTaskToSchedule');
  };

  const handleConvertAfterLast = async (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    setArmedTaskId(null);
    await runMutation(
      convertTaskToSchedule(task.id, findLastEndAt(), true),
      'convertTaskToSchedule'
    );
  };

  const handleConvertCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setArmedTaskId(null);
  };

  const handleDelete = async (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    await runMutation(removeTask(task.id), 'removeTask');
  };

  const handleRowClick = (task: Task) => {
    if (armedTaskId === task.id) return;
    onEditTask(task);
  };

  const categoryColor = (id: string | null): string => {
    if (id === null) return 'transparent';
    return categories.find(c => c.id === id)?.color ?? 'transparent';
  };

  const actionBtn =
    'rounded-none border border-line bg-panel px-1 py-0.5 text-[10px] text-txt hover:bg-bg';
  const armedBtn =
    'rounded-none border border-ink bg-ink px-2 py-0.5 text-[10px] text-bg hover:opacity-90';
  const armedCancelBtn =
    'rounded-none border border-line bg-panel px-2 py-0.5 text-[10px] text-txt hover:bg-bg';

  return (
    <div className="font-mono">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted">{t('task.heading')}</span>
        {/* 사양 3번 — + 정사각형 박스 (지금 행 높이 박힘 영영). */}
        <button
          type="button"
          onClick={onNewTask}
          aria-label={t('task.newTask')}
          className="flex h-7 w-7 items-center justify-center rounded-none border border-line bg-panel text-base text-txt hover:bg-bg"
        >
          +
        </button>
      </div>
      {tasks.length === 0 && (
        <p className="text-xs text-muted">{t('task.empty')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {tasks.map(task => {
          const armed = armedTaskId === task.id;
          return (
            <li
              key={task.id}
              onClick={() => handleRowClick(task)}
              className="cursor-pointer border-l-4 bg-bg px-2 py-1 text-xs text-txt hover:bg-panel"
              style={{borderLeftColor: categoryColor(task.categoryId)}}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {task.title ?? <span className="text-muted">—</span>}
                  {task.durationMin !== null && (
                    <span className="ml-2 text-muted">{task.durationMin}m</span>
                  )}
                </span>
                {/* 사양 1번 — 변형 chain 박힌 영영 + 스케줄/삭제 자리 영역 박음 (한 row 안 toggle). */}
                {!armed ? (
                  <div className="flex gap-1">
                    {/* 사양 7번 — + 스케줄 → ✓ */}
                    <button
                      type="button"
                      onClick={e => handleConvertClick(e, task)}
                      aria-label={t('task.convertToSchedule')}
                      className={actionBtn}
                    >
                      ✓
                    </button>
                    {/* 사양 7번 — 삭제 → × */}
                    <button
                      type="button"
                      onClick={e => handleDelete(e, task)}
                      aria-label={t('task.delete')}
                      className={`${actionBtn} text-danger`}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={e => handleConvertNow(e, task)}
                      className={armedBtn}
                    >
                      {t('task.convertNow')}
                    </button>
                    {/* 사양 2번 — schedule 0개 시 "마지막 다음" 박지 X. */}
                    {hasActiveSchedule && (
                      <button
                        type="button"
                        onClick={e => handleConvertAfterLast(e, task)}
                        className={armedBtn}
                      >
                        {t('task.convertAfterLast')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleConvertCancel}
                      className={armedCancelBtn}
                    >
                      {t('task.convertCancel')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
