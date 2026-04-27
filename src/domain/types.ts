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
export interface WorkingHours { date: string; startMin: number; endMin: number; }
export type Theme = 'light' | 'dark' | 'system';
export interface AppSettings {
  theme: Theme;
  weekViewSpan: 1 | 2 | 3;
  weeklyPanelHidden: boolean;
  defaultWorkingHours: { startMin: number; endMin: number };
  pinnedActiveId?: ScheduleId | null;
}
