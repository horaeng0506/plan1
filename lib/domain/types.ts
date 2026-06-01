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
// schema.ts 의 plan1Tasks row type (Date) → store rowToDomain 변환 정합.
export type TaskId = string;
// 레거시 enum (bucketId 마이그레이션 동안 보존). 신규 단일 원천 = bucketId.
export type TaskBucket = 'now' | 'later';
export type TaskBucketId = string;
export type TaskBucketKind = 'now' | 'later';

// PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 사용자 정의 할일 카테고리(버킷) 도메인 타입.
export interface TaskBucketInfo {
  id: TaskBucketId;
  name: string;
  isCountBased: boolean;
  sortOrder: number;
  // 'now'|'later' = 시드된 기본 버킷 (편집 전 i18n 렌더). null = 사용자 생성 또는 이름 편집됨.
  defaultKind: TaskBucketKind | null;
  createdAt: number;
}

export interface Task {
  id: TaskId;
  title: string | null;
  durationMin: number | null;
  categoryId: CategoryId | null;
  // PLAN1-TASKS-PRIORITY-20260510 — 우선순위 (1 = 최우선 · 1~N).
  // PLAN1-TASKS-BUCKET-20260511 — bucket priority namespace 독립 (레거시 enum).
  priority: number;
  bucket: TaskBucket;
  // PLAN1-TASKS-BUCKET-CUSTOM-20260531 — 사용자 정의 버킷 FK (신규 단일 원천 · lazy backfill 동안 null 가능).
  bucketId: TaskBucketId | null;
  // 횟수차감형 잔여 횟수. null = 일반 task. (버킷 isCountBased 와 동기)
  count: number | null;
  createdAt: number;
}

// PLAN1-FUTURE-DATE-MARKS-20260601 — 달력 미래 날짜 색 마킹.
// 무색은 별도 상태 X (마크 부재로 표현). 클릭 순환: 무색→red→green→blue→무색.
export type DateMarkColor = 'red' | 'green' | 'blue';
export interface DateMark {
  dateKey: string; // 'YYYY-MM-DD' (클라이언트 로컬 날짜)
  color: DateMarkColor;
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
