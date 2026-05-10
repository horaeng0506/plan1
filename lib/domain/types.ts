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
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q25): splitFrom 폐기 (split 메커니즘 자체 폐기 · S12 column drop).
  chainedToPrev?: boolean;
  createdAt: number;
  updatedAt: number;
}
// PLAN1-TASKS-FEATURE-20260509 — task domain type (client-side · createdAt: number ms).
// schema.ts 의 plan1Tasks row type (Date) → store rowToDomain 영영 변환 박음 정합.
export type TaskId = string;
export interface Task {
  id: TaskId;
  title: string | null;
  durationMin: number | null;
  categoryId: CategoryId | null;
  createdAt: number;
}

export type Theme = 'light' | 'dark' | 'system';
export interface AppSettings {
  theme: Theme;
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 — 집중 보기 모드. default 12h(720).
  // 옵션 [4·6·8·10·12·16·20·24h] · null 폐기 · DailyTimeline view = HOUR floor [(h-1)*60, ...].
  // S12 portal repo schema migration 후 NOT NULL DEFAULT 720. 그 전에는 store ?? 720 fallback.
  focusViewMin: number;
  // PLAN1-ZOOM-PX-PER-HOUR-20260509 — DailyTimeline 시간 간격 줌 (1시간 height px). default 50.
  // 사용자 +/- 버튼으로 ±20 조정. min 50 (default · - 비활성) · max 200 (10분 슬롯 가독성).
  // pxPerHour ≥ 120 시 slotDuration 30분 → 10분 자동 변환.
  zoomPxPerHour: number;
  // PLAN1-FOCUS-VIEW-REDESIGN-20260506 (Q23): pinnedActiveId 폐기 (MAX_OVERLAP=2 정책 후 사용 영역 거의 없음 · S12 column drop).
}
