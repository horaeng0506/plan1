'use client';

import {useState} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {decideFlow} from '@/lib/decideFlow';
import type {Task} from '@/lib/domain/types';

/**
 * PLAN1-TASKS-FEATURE-20260509 — sidebar 안 task list + 변형 chain.
 *
 * 본 사이클 단순화 (편집 모드 X · 다음 사이클 영역):
 *   - decideFlow.type === 'modal' → toast 영영 무시 (사용자 직접 task 삭제 후 재추가 박음)
 *   - decideFlow.type === 'atomic' → 변형 chain 박음 (지금 / 마지막 다음 / 취소 3 버튼)
 */

interface TaskListProps {
  onNewTask: () => void;
}

export function TaskList({onNewTask}: TaskListProps) {
  const t = useTranslations();
  const runMutation = useRunMutation();
  const tasks = useAppStore(s => s.tasks);
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);
  const removeTask = useAppStore(s => s.removeTask);
  const convertTaskToSchedule = useAppStore(s => s.convertTaskToSchedule);

  const [armedTaskId, setArmedTaskId] = useState<string | null>(null);

  const findLastEndAt = (): number => {
    const now = Date.now();
    let maxEnd = now;
    schedules.forEach(s => {
      if (s.status === 'done') return;
      const endAt = s.startAt + s.durationMin * 60_000;
      if (endAt > now && endAt > maxEnd) maxEnd = endAt;
    });
    return maxEnd === now ? now : maxEnd + 1;
  };

  const handleConvertClick = (task: Task) => {
    const flow = decideFlow(
      {categoryId: task.categoryId, durationMin: task.durationMin},
      categories
    );
    if (flow.type === 'modal') {
      // 본 사이클 단순화 — 편집 모드 다음 사이클 영역. 자, armed 영역 박지 X.
      return;
    }
    setArmedTaskId(task.id);
  };

  const handleConvertNow = async (task: Task) => {
    setArmedTaskId(null);
    await runMutation(convertTaskToSchedule(task.id, Date.now(), true), 'convertTaskToSchedule');
  };

  const handleConvertAfterLast = async (task: Task) => {
    setArmedTaskId(null);
    await runMutation(
      convertTaskToSchedule(task.id, findLastEndAt(), true),
      'convertTaskToSchedule'
    );
  };

  const handleDelete = async (task: Task) => {
    await runMutation(removeTask(task.id), 'removeTask');
  };

  const categoryColor = (id: string | null): string => {
    if (id === null) return 'transparent';
    return categories.find(c => c.id === id)?.color ?? 'transparent';
  };

  return (
    <div className="font-mono">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted">{t('task.heading')}</span>
        <button
          type="button"
          onClick={onNewTask}
          className="rounded-none border border-line bg-panel px-2 py-1 text-xs text-txt hover:bg-bg"
        >
          {t('task.newTask')}
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
              className="border-l-4 bg-bg px-2 py-1 text-xs text-txt"
              style={{borderLeftColor: categoryColor(task.categoryId)}}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {task.title ?? <span className="text-muted">—</span>}
                  {task.durationMin !== null && (
                    <span className="ml-2 text-muted">{task.durationMin}m</span>
                  )}
                </span>
                {!armed && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleConvertClick(task)}
                      className="rounded-none border border-line bg-panel px-1 py-0.5 text-[10px] text-txt hover:bg-bg"
                    >
                      {t('task.convertToSchedule')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(task)}
                      className="rounded-none border border-line bg-panel px-1 py-0.5 text-[10px] text-danger hover:bg-bg"
                    >
                      {t('task.delete')}
                    </button>
                  </div>
                )}
              </div>
              {armed && (
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleConvertNow(task)}
                    className="rounded-none border border-ink bg-ink px-2 py-0.5 text-[10px] text-bg hover:opacity-90"
                  >
                    {t('task.convertNow')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConvertAfterLast(task)}
                    className="rounded-none border border-ink bg-ink px-2 py-0.5 text-[10px] text-bg hover:opacity-90"
                  >
                    {t('task.convertAfterLast')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setArmedTaskId(null)}
                    className="rounded-none border border-line bg-panel px-2 py-0.5 text-[10px] text-txt hover:bg-bg"
                  >
                    {t('task.convertCancel')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}