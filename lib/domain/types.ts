export type CategoryId = string;
export type ScheduleId = string;
export interface Category { id: CategoryId; name: string; color: string; createdAt: number; }
export type TimerType = 'countup' | 'timer1' | 'countdown';
export type ScheduleStatus = 'pending' | 'active' | 'done';
export interface Schedule {
  id: ScheduleId;
  title: string;
  categoryId: CategoryId;
  startAt: number;
  durationMin: number;
  actualDurationMin?: number;
  timerType: TimerType;
  status: ScheduleStatus;
  splitFrom?: ScheduleId;
  chainedToPrev?: boolean;
  createdAt: number;
  updatedAt: number;
}
export type Theme = 'light' | 'dark' | 'system';
export interface AppSettings {
  theme: Theme;
  weekViewSpan: 1 | 2 | 3;
  weeklyPanelHidden: boolean;
  // PLAN1-WH-FOCUS-20260504 — 집중 보기 모드. null = 전체 보기 (default).
  // 값 N (분) 일 때 시계/timeline view 가 [now-N/2, now+N/2] 구간만 렌더.
  focusViewMin: number | null;
  pinnedActiveId?: ScheduleId | null;
}
