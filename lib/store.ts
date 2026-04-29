/**
 * 클라이언트 store — Zustand 유지, persist 제거.
 *
 * 데이터 source-of-truth = server (Neon DB). 클라이언트는 in-memory cache 역할.
 * 각 mutation action 이 server action 을 호출하고 결과(또는 fetched list)로 state 갱신.
 *
 * 초기 로드: components 가 mount 시 useAppStore.getState().init() 1회 호출.
 *
 * 마이그 전 src/domain/store.ts 의 동기 API → async 화. zustand 자체는 sync 인 것 OK.
 * components 는 action 호출 시 await 가능하지만 fire-and-forget 도 동작 (state 는 server action 후 set).
 */

'use client';

import {create} from 'zustand';
import type {
  AppSettings,
  Category,
  CategoryId,
  Schedule,
  ScheduleId,
  ScheduleStatus,
  WorkingHours
} from './domain/types';
import * as categoriesApi from '@/app/actions/categories';
import * as schedulesApi from '@/app/actions/schedules';
import * as workingHoursApi from '@/app/actions/working-hours';
import * as settingsApi from '@/app/actions/settings';
import {unwrapServerActionResult as unwrap, ServerActionError} from './server-action';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  weekViewSpan: 1,
  weeklyPanelHidden: false,
  defaultWorkingHours: {startMin: 540, endMin: 1080}
};

// Stage 5 i18n: name='default' 영어 base. 표시 시 useCategoryDisplay() 가 name 매칭으로
// t('category.defaultName') locale 매핑.
//
// Track 1 fix (2026-04-29 · logic-critic 채택): DEFAULT_CATEGORY_ID + 가짜 id fallback
// 모두 제거. listCategories 가 user별 unique id (`cat-${randomUUID()}`) 로 시드 → 클라이언트
// 가 받는 id 가 캐노니컬. 빈 배열 fallback 은 init 실패 시점 modal 캡처 회귀(가짜 id 가
// useState 초기값으로 박혀 다시 categoryNotFound throw) 를 영구 차단.
// PlanApp 의 "+ 새 스케줄" 버튼이 `categories.length === 0` 시 disabled 처리해 사용자
// 인지 명확 + modal 진입 자체 차단.
export const DEFAULT_CATEGORIES: Category[] = [];

// Strict Mode 이중 mount race 가드용 inflight promise 캐시 (init 만 사용).
let initInflight: Promise<void> | null = null;

interface AppState {
  schedules: Schedule[];
  categories: Category[];
  workingHours: Record<string, WorkingHours>;
  settings: AppSettings;
  loaded: boolean;
  loading: boolean;
  error: string | null;

  init(): Promise<void>;
  refreshSchedules(): Promise<void>;

  addSchedule(input: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<void>;
  updateSchedule(
    id: ScheduleId,
    patch: {
      title?: string;
      categoryId?: CategoryId;
      startAt?: number;
      durationMin?: number;
      timerType?: Schedule['timerType'];
      chainedToPrev?: boolean;
    }
  ): Promise<void>;
  removeSchedule(id: ScheduleId): Promise<void>;
  setScheduleStatus(id: ScheduleId, status: ScheduleStatus): Promise<void>;
  extendScheduleBy(id: ScheduleId, addMin: number): Promise<void>;
  completeSchedule(id: ScheduleId, completeAtMs: number): Promise<void>;

  addCategory(input: Omit<Category, 'id' | 'createdAt'>): Promise<void>;
  removeCategory(id: CategoryId, force?: boolean): Promise<void>;

  setWorkingHours(date: string, hours: {startMin: number; endMin: number}): Promise<void>;
  bulkSetWorkingHours(dates: string[], hours: {startMin: number; endMin: number}): Promise<void>;
  setDefaultWorkingHours(hours: {startMin: number; endMin: number}): Promise<void>;

  updateSettings(patch: Partial<AppSettings>): Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  schedules: [],
  categories: DEFAULT_CATEGORIES,
  workingHours: {},
  settings: DEFAULT_SETTINGS,
  loaded: false,
  loading: false,
  error: null,

  async init() {
    // Stage 3f env-critic Critical: React Strict Mode 이중 mount 환경에서 동일 tick 내
    // useEffect 두 번 실행 → set({loading: true}) batching 전에 두 번째 호출이 가드 통과
    // 가능. inflight promise 캐싱으로 중복 server action 호출 차단.
    if (get().loaded) return;
    if (initInflight) return initInflight;
    set({loading: true, error: null});
    initInflight = (async () => {
      try {
        const [schedulesR, categoriesR, whListR, settingsR] = await Promise.all([
          schedulesApi.listSchedules(),
          categoriesApi.listCategories(),
          workingHoursApi.listWorkingHours(),
          settingsApi.getSettings()
        ]);
        const schedules = unwrap(schedulesR);
        const categories = unwrap(categoriesR);
        const whList = unwrap(whListR);
        const settings = unwrap(settingsR);
        const workingHours: Record<string, WorkingHours> = {};
        for (const wh of whList) workingHours[wh.date] = wh;
        set({
          schedules,
          categories: categories.length > 0 ? categories : DEFAULT_CATEGORIES,
          workingHours,
          settings,
          loaded: true,
          loading: false
        });
      } catch (e) {
        set({loading: false, error: e instanceof Error ? e.message : String(e)});
        throw e;
      } finally {
        initInflight = null;
      }
    })();
    return initInflight;
  },

  async refreshSchedules() {
    const schedules = unwrap(await schedulesApi.listSchedules());
    set({schedules});
  },

  async addSchedule(input) {
    const next = unwrap(await schedulesApi.createSchedule({
      title: input.title,
      categoryId: input.categoryId,
      startAt: input.startAt,
      durationMin: input.durationMin,
      timerType: input.timerType,
      chainedToPrev: input.chainedToPrev
    }));
    set({schedules: next});
  },

  async updateSchedule(id, patch) {
    const next = unwrap(await schedulesApi.updateSchedule({id, ...patch}));
    set({schedules: next});
  },

  async removeSchedule(id) {
    unwrap(await schedulesApi.deleteSchedule(id));
    await get().refreshSchedules();
  },

  async setScheduleStatus(id, status) {
    // server actions 에 setScheduleStatus 없음 → updateSchedule 로 대체 안 됨 (status 미수용).
    // 'done' 인 경우 completeSchedule 호출. 다른 status 변경은 별도 server action 추가 필요.
    // ship-gate code-review High: prod redact 회피 위해 ServerActionError 로 i18n key 화 (Stage 8.G).
    if (status === 'done') {
      await get().completeSchedule(id, Date.now());
      return;
    }
    throw new ServerActionError('error.featureUnavailable', {feature: `setScheduleStatus.${status}`});
  },

  async extendScheduleBy(id, addMin) {
    const sch = get().schedules.find(s => s.id === id);
    if (!sch) return;
    const newDuration = Math.max(1, sch.durationMin + addMin);
    await get().updateSchedule(id, {durationMin: newDuration});
  },

  async completeSchedule(id, completeAtMs) {
    const next = unwrap(await schedulesApi.completeSchedule({id, completeAtMs}));
    set({schedules: next});
  },

  async addCategory(input) {
    const created = unwrap(await categoriesApi.createCategory({name: input.name, color: input.color}));
    set({categories: [...get().categories, created]});
  },

  async removeCategory(id, force) {
    unwrap(await categoriesApi.deleteCategory({id, force}));
    // cascade DELETE 로 schedules 도 영향 → schedules 도 refresh
    set({categories: get().categories.filter(c => c.id !== id)});
    if (force) await get().refreshSchedules();
  },

  async setWorkingHours(date, hours) {
    unwrap(await workingHoursApi.setWorkingHours({date, ...hours}));
    // split 재계산 결과 반영 위해 schedules·workingHours refresh
    const whList = unwrap(await workingHoursApi.listWorkingHours());
    const wh: Record<string, WorkingHours> = {};
    for (const w of whList) wh[w.date] = w;
    set({workingHours: wh});
    await get().refreshSchedules();
  },

  async bulkSetWorkingHours(dates, hours) {
    unwrap(await workingHoursApi.bulkSetWorkingHours({dates, ...hours}));
    const whList = unwrap(await workingHoursApi.listWorkingHours());
    const wh: Record<string, WorkingHours> = {};
    for (const w of whList) wh[w.date] = w;
    set({workingHours: wh});
    await get().refreshSchedules();
  },

  async setDefaultWorkingHours(hours) {
    const updated = unwrap(await settingsApi.updateSettings({defaultWorkingHours: hours}));
    set({settings: updated});
    await get().refreshSchedules();
  },

  async updateSettings(patch) {
    const updated = unwrap(await settingsApi.updateSettings(patch));
    set({settings: updated});
  }
}));
