'use client';

import {useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {useTranslations} from 'next-intl';
import {useAppStore} from '@/lib/store';
import {useRunMutation} from '@/lib/use-run-mutation';
import {decideFlow} from '@/lib/decideFlow';
import {nowMs} from '@/lib/now';
import {formatDurationHm} from '@/lib/format-duration';
import {afterLastPlus10} from '@/lib/after-last';
import {useTaskBucketDisplay} from '@/lib/task-bucket-display';
import type {Task, TaskBucketInfo} from '@/lib/domain/types';

/**
 * PLAN1-TASKS-FEATURE-20260509 — sidebar 안 task list + 변환 chain.
 * PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 사용자 정의 버킷 그룹.
 *   - 버킷별 group (sortOrder 순). 이름 = useTaskBucketDisplay (default 는 i18n).
 *   - 횟수차감형 task: priority 오른쪽·제목 왼쪽에 [count] 표시.
 *   - '관리' 버튼('+' 왼쪽) → 버킷 관리 modal.
 *   - default 'later' 버킷은 디폴트 접힘. 각 버킷 collapse 개별 저장(localStorage override map).
 *   - 변환 in-flight 잠금 (logic-critic Critical — 횟수차감 double-click race 차단).
 * PLAN1-LAST-PLUS-10-20260531 — "마지막+10" (마지막 종료 +10분).
 */

const COLLAPSE_STORAGE_KEY = 'plan1.taskBucketCollapse';

function subscribeCollapse(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getCollapseRaw(): string {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) ?? '{}';
  } catch {
    return '{}';
  }
}

function getCollapseServerSnapshot(): string {
  return '{}';
}

interface TaskListProps {
  onNewTask: () => void;
  onEditTask: (task: Task) => void;
  onManageBuckets: () => void;
}

export function TaskList({onNewTask, onEditTask, onManageBuckets}: TaskListProps) {
  const t = useTranslations();
  const runMutation = useRunMutation();
  const tasks = useAppStore(s => s.tasks);
  const schedules = useAppStore(s => s.schedules);
  const categories = useAppStore(s => s.categories);
  const taskBuckets = useAppStore(s => s.taskBuckets);
  // PLAN1-TASKS-NEWBTN-LOADED-GUARD-20260614 — schedule '+ 새 스케줄'(canOpenNew = loaded &&
  // categories>0)과 동일하게, 버킷 로드 전 task 모달 진입 차단. 미가드 시 init() 완료 전 모달이
  // 열려 effectiveBucketId='' → 추가 버튼 disabled race (cold load · qa-gate task spec 실패 원인).
  const loaded = useAppStore(s => s.loaded);
  const removeTask = useAppStore(s => s.removeTask);
  const convertTaskToSchedule = useAppStore(s => s.convertTaskToSchedule);
  const bucketDisplay = useTaskBucketDisplay();

  const [armedTaskId, setArmedTaskId] = useState<string | null>(null);
  const convertInFlight = useRef(false);

  const collapseRaw = useSyncExternalStore(
    subscribeCollapse,
    getCollapseRaw,
    getCollapseServerSnapshot
  );
  // override map: {bucketId: true|false}. 부재 시 default = (defaultKind === 'later').
  const collapseMap = useMemo<Record<string, boolean>>(() => {
    try {
      return JSON.parse(collapseRaw) as Record<string, boolean>;
    } catch {
      return {};
    }
  }, [collapseRaw]);

  const isCollapsed = (b: TaskBucketInfo): boolean =>
    b.id in collapseMap ? collapseMap[b.id] : b.defaultKind === 'later';

  const toggleCollapsed = (b: TaskBucketInfo) => {
    const next = {...collapseMap, [b.id]: !isCollapsed(b)};
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new StorageEvent('storage', {key: COLLAPSE_STORAGE_KEY}));
    } catch {
      // 무시
    }
  };

  // 마지막+10 — 활성(지금 이후 종료) 스케줄 있을 때만.
  const lastPlus10 = afterLastPlus10(schedules, nowMs());

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

  const runConvert = async (task: Task, startAt: number) => {
    // in-flight 잠금 — 횟수차감 double-click race + 일반 변환 중복 차단.
    if (convertInFlight.current) return;
    convertInFlight.current = true;
    setArmedTaskId(null);
    try {
      await runMutation(convertTaskToSchedule(task.id, startAt, true), 'convertTaskToSchedule');
    } finally {
      convertInFlight.current = false;
    }
  };

  const handleConvertNow = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    void runConvert(task, nowMs());
  };

  const handleConvertAfterLast = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    if (lastPlus10 === null) return;
    void runConvert(task, lastPlus10);
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
    // PLAN1-TASKS-BUCKET-KIND-20260602 — 무제한형 식별 (count null 이라 횟수차감과 별개 · 버킷 kind 기준).
    const isUnlimited = taskBuckets.find(b => b.id === task.bucketId)?.kind === 'unlimited';
    return (
      <li
        key={task.id}
        onClick={() => handleRowClick(task)}
        data-testid={`task-item-${task.id}`}
        className="cursor-pointer border-l-4 bg-bg px-2 py-1 text-xs text-txt hover:bg-panel"
        style={{borderLeftColor: categoryColor(task.categoryId)}}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">
            <span className="text-muted">{task.priority}.</span>{' '}
            {/* 횟수차감형 → [count] · 무제한형 → [∞] (우선순위 오른쪽·제목 왼쪽). */}
            {task.count !== null && (
              <span className="text-success" data-testid={`task-count-${task.id}`}>[{task.count}]</span>
            )}
            {isUnlimited && (
              <span className="text-success" data-testid={`task-unlimited-${task.id}`}>[∞]</span>
            )}
            {(task.count !== null || isUnlimited) && ' '}
            {task.title ?? <span className="text-muted">—</span>}
            {durationStr !== '' && <span className="ml-2 text-muted">{durationStr}</span>}
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
              <button type="button" onClick={e => handleConvertNow(e, task)} className={armedBtn}>
                {t('task.convertNow')}
              </button>
              {lastPlus10 !== null && (
                <button type="button" onClick={e => handleConvertAfterLast(e, task)} className={armedBtn}>
                  {t('task.convertAfterLast')}
                </button>
              )}
              <button type="button" onClick={handleConvertCancel} className={armedCancelBtn}>
                {t('task.convertCancel')}
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

  // 버킷별 그룹 (sortOrder 순). bucketId 미매칭 task 는 첫 버킷에 표시 (backfill 전 안전망).
  const orderedBuckets = useMemo(
    () => [...taskBuckets].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt),
    [taskBuckets]
  );

  return (
    <div className="font-mono" data-testid="task-list">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-muted">{t('task.heading')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onManageBuckets}
            aria-label={t('task.manageBuckets')}
            data-testid="task-manage-button"
            className="flex h-7 items-center justify-center rounded-none border border-line bg-panel px-2 text-xs text-txt hover:bg-bg"
          >
            {t('task.manageBuckets')}
          </button>
          <button
            type="button"
            onClick={onNewTask}
            disabled={!loaded || taskBuckets.length === 0}
            aria-label={t('task.newTask')}
            data-testid="task-new-button"
            className="flex h-7 w-7 items-center justify-center rounded-none border border-line bg-panel text-base text-txt hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
          >
            +
          </button>
        </div>
      </div>
      {tasks.length === 0 && <p className="text-xs text-muted">{t('task.empty')}</p>}
      {orderedBuckets.map(bucket => {
        const bucketTasks = tasks.filter(task => task.bucketId === bucket.id);
        if (bucketTasks.length === 0) return null;
        const collapsed = isCollapsed(bucket);
        return (
          <div key={bucket.id} className="mb-3" data-testid={`task-bucket-${bucket.id}`}>
            <button
              type="button"
              onClick={() => toggleCollapsed(bucket)}
              aria-expanded={!collapsed}
              className="mb-1 flex w-full items-center gap-1 text-[10px] text-muted hover:text-txt"
            >
              <span aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
              <span>{bucketDisplay(bucket)} ({bucketTasks.length})</span>
            </button>
            {!collapsed && (
              <ul className="flex flex-col gap-2">{bucketTasks.map(renderRow)}</ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
