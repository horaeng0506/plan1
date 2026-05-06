/**
 * 클라이언트 store — Zustand 유지, persist 제거.
 *
 * PLAN1-WH-FOCUS-20260504 — workingHours state + setWorkingHours/bulkSetWorkingHours/
 * setDefaultWorkingHours 폐기 (working hours 기능 자체 제거). focusViewMin 추가.
 *
 * 데이터 source-of-truth = server (Neon DB). 클라이언트는 in-memory cache 역할.
 * 각 mutation action 이 server action 을 호출하고 결과(또는 fetched list)로 state 갱신.
 *
 * 초기 로드: components 가 mount 시 useAppStore.getState().init() 1회 호출.
 */

'use client';

import {create} from 'zustand';
import type {
  AppSettings,
  Category,
  CategoryId,
  Schedule,
  ScheduleId,
  ScheduleStatus
} from './domain/types';
import * as categoriesApi from '@/app/actions/categories';
import * as schedulesApi from '@/app/actions/schedules';
import * as settingsApi from '@/app/actions/settings';
import {unwrapServerActionResult as unwrap, ServerActionError} from './server-action';
import {armUndo} from './undo-store';

// PLAN1-FOCUS-VIEW-REDESIGN-20260506: weekViewSpan / weeklyPanelHidden 폐기. focusViewMin 720 default.
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  focusViewMin: 720
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
  settings: AppSettings;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #13: 등록 confirmation modal — 새 schedule 추가 시 set, 2초 후 PlanApp 가 clear.
  lastAddedSchedule: Schedule | null;
  // PLAN1-LOGIN-START-OPT-20260504 #5: unauthorized 식별 (ServerActionError.errorKey).
  // PlanApp 분기 — `serverError.unauthorized` 면 로그인 화면 (SignInPrompt) 표시.
  // 일반 error (network · DB · 기타) 는 retry 버튼 유지.
  errorKey: string | null;

  init(): Promise<void>;
  refreshSchedules(): Promise<void>;
  clearLastAddedSchedule(): void;

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

  updateSettings(patch: Partial<AppSettings>): Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  schedules: [],
  categories: DEFAULT_CATEGORIES,
  settings: DEFAULT_SETTINGS,
  loaded: false,
  loading: false,
  error: null,
  errorKey: null,
  lastAddedSchedule: null,

  clearLastAddedSchedule() {
    set({lastAddedSchedule: null});
  },

  async init() {
    if (get().loaded) return;
    if (initInflight) return initInflight;
    set({loading: true, error: null, errorKey: null});
    initInflight = (async () => {
      try {
        const [schedulesR, categoriesR, settingsR] = await Promise.all([
          schedulesApi.listSchedules(),
          categoriesApi.listCategories(),
          settingsApi.getSettings()
        ]);
        const schedules = unwrap(schedulesR);
        const categories = unwrap(categoriesR);
        const settings = unwrap(settingsR);
        set({
          schedules,
          categories: categories.length > 0 ? categories : DEFAULT_CATEGORIES,
          settings,
          loaded: true,
          loading: false
        });
      } catch (e) {
        // PLAN1-LOGIN-START-OPT-20260504 #5: ServerActionError 면 errorKey 분리 저장 → PlanApp 가
        // 'serverError.unauthorized' 검사 후 SignInPrompt 분기. 일반 error 는 message 만 저장 (기존 동작).
        const isSae = e instanceof ServerActionError;
        set({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          errorKey: isSae ? e.errorKey : null
        });
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
    // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #17·#13: undo arm + lastAddedSchedule 박음
    const prevIds = new Set(get().schedules.map(s => s.id));
    const next = unwrap(await schedulesApi.createSchedule({
      title: input.title,
      categoryId: input.categoryId,
      startAt: input.startAt,
      durationMin: input.durationMin,
      timerType: input.timerType,
      chainedToPrev: input.chainedToPrev
    }));
    const newSchedule = next.find(s => !prevIds.has(s.id));
    set({schedules: next, lastAddedSchedule: newSchedule ?? null});
    if (newSchedule) {
      armUndo({type: 'add', scheduleId: newSchedule.id, ts: Date.now()});
    }
  },

  async updateSchedule(id, patch) {
    // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #17: undo arm — prev schedule snapshot
    const prev = get().schedules.find(s => s.id === id);
    const next = unwrap(await schedulesApi.updateSchedule({id, ...patch}));
    set({schedules: next});
    if (prev) {
      armUndo({type: 'edit', scheduleId: id, prev, ts: Date.now()});
    }
  },

  async removeSchedule(id) {
    // PLAN1-FOCUS-VIEW-REDESIGN-V2-20260506 #17: undo arm — 삭제 직전 schedule snapshot
    const deleted = get().schedules.find(s => s.id === id);
    unwrap(await schedulesApi.deleteSchedule(id));
    await get().refreshSchedules();
    if (deleted) {
      armUndo({type: 'delete', schedule: deleted, ts: Date.now()});
    }
  },

  async setScheduleStatus(id, status) {
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
    set({categories: get().categories.filter(c => c.id !== id)});
    if (force) await get().refreshSchedules();
  },

  async updateSettings(patch) {
    const updated = unwrap(await settingsApi.updateSettings(patch));
    set({settings: updated});
  }
}));
