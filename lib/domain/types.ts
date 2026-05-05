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
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 — 집중 보기 모드. default 12h(720).
  // 옵션 [4·6·8·10·12·16·20·24h] · null 폐기 · DailyTimeline view = HOUR floor [(h-1)*60, ...].
  // S12 portal repo schema migration 후 NOT NULL DEFAULT 720. 그 전에는 store ?? 720 fallback.
  focusViewMin: number;
  pinnedActiveId?: ScheduleId | null;
}
