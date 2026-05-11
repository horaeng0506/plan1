'use client';

import {useState, useSyncExternalStore} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {decideFlow} from '@/lib/decideFlow';
import {nowMs} from '@/lib/now';
import {formatDurationHm} from '@/lib/format-duration';
import type {Task} from '@/lib/domain/types';

/**
 * PLAN1-TASKS-FEATURE-20260509 — sidebar 안 task list + 변형 chain.
 * PLAN1-TASKS-PRIORITY-20260510 — 변형 chain 위치 · + 정사각형 박스 · 편집 모달 진입 등.
 * PLAN1-TASKS-BUCKET-20260511 — 두 bucket 분할 ('당장 할일' / '나중 할일').
 *   - row priority 숫자 prefix ("1. 제목")
 *   - bucket 별 group 분리 (두 group 동일 모양)
 *   - 나중 할일 collapse 디폴트 = 접힘 (localStorage 저장)
 *   - 시간 표시 h:mm format (formatDurationHm util)
 */

const LATER_COLLAPSED_STORAGE_KEY = 'plan1.tasksLaterCollapsed';

// PLAN1-TASKS-BUCKET-20260511 — useSyncExternalStore 패턴 (eslint react-hooks/set-state-in-effect 정합).
// SSR snapshot 디폴트 = true (접힘 · 사용자 첫 진입 시 일치 · flash 차단).
function subscribeLaterCollapsed(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getLaterCollapsedSnapshot(): boolean {
  try {
    return localStorage.getItem(LATER_COLLAPSED_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function getLaterCollapsedServerSnapshot(): boolean {
  return true;
}

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
  const laterCollapsed = useSyncExternalStore(
    subscribeLaterCollapsed,
    getLaterCollapsedSnapshot,
    getLaterCollapsedServerSnapshot
  );

  const toggleLaterCollapsed = () => {
    const next = !laterCollapsed;
    try {
      localStorage.setItem(LATER_COLLAPSED_STORAGE_KEY, String(next));
      // storage event 는 다른 탭만 trigger — 현 탭 동일 trigger 의무.
      window.dispatchEvent(new StorageEvent('storage', {key: LATER_COLLAPSED_STORAGE_KEY}));
    } catch {
      // 무시
    }
  };

  // 사양 2번 — 오늘 스케줄 0개 시 "마지막 다음" 박지 X.
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

  const renderRow = (task: Task) => {
    const armed = armedTaskId === task.id;
    const durationStr = task.durationMin !== null ? formatDurationHm(task.durationMin) : '';
    return (
      <li
        key={task.id}
        onClick={() => handleRowClick(task)}
        className="cursor-pointer border-l-4 bg-bg px-2 py-1 text-xs text-txt hover:bg-panel"
        style={{borderLeftColor: categoryColor(task.categoryId)}}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">
            {/* PLAN1-TASKS-BUCKET-20260511 — priority 숫자 prefix (사양 1번). */}
            <span className="text-muted">{task.priority}.</span>{' '}
            {task.title ?? <span className="text-muted">—</span>}
            {durationStr !== '' && (
              <span className="ml-2 text-muted">{durationStr}</span>
            )}
          </span>
          {!armed ? (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={e => handleConvertClick(e, task)}
                aria-label={t('task.convertToSchedule')}
                className={actionBtn}
              >
                ✓
              </button>
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
  };

  // PLAN1-TASKS-BUCKET-20260511 — bucket 별 client filter (env-critic M2 정합 · DB orderBy 제외).
  const nowTasks = tasks.filter(task => task.bucket === 'now');
  const laterTasks = tasks.filter(task => task.bucket === 'later');

  return (
    <div className="font-mono">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted">{t('task.heading')}</span>
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
      {/* 당장 할일 group */}
      {nowTasks.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] text-muted">{t('task.bucketNow')}</div>
          <ul className="flex flex-col gap-2">
            {nowTasks.map(renderRow)}
          </ul>
        </div>
      )}
      {/* 나중 할일 group (collapsible · 디폴트 접힘) */}
      {laterTasks.length > 0 && (
        <div>
          <button
            type="button"
            onClick={toggleLaterCollapsed}
            aria-expanded={!laterCollapsed}
            className="mb-1 flex w-full items-center gap-1 text-[10px] text-muted hover:text-txt"
          >
            <span aria-hidden="true">{laterCollapsed ? '▶' : '▼'}</span>
            <span>{t('task.bucketLater')} ({laterTasks.length})</span>
          </button>
          {!laterCollapsed && (
            <ul className="flex flex-col gap-2">
              {laterTasks.map(renderRow)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
