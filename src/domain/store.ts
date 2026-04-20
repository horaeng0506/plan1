import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { idbStorage } from './storage'
import type { Category, CategoryId, Schedule, ScheduleId, ScheduleStatus, WorkingHours, AppSettings } from './types'
import { cascade } from './cascade'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  weekViewSpan: 1,
  weeklyPanelHidden: false,
  defaultWorkingHours: { startMin: 540, endMin: 1080 }
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-default', name: '기본', color: '#6b7280', createdAt: 0 }
]

interface AppState {
  schedules: Schedule[]
  categories: Category[]
  workingHours: Record<string, WorkingHours>
  settings: AppSettings

  addSchedule(input: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt' | 'status'>): ScheduleId
  updateSchedule(id: ScheduleId, patch: Partial<Omit<Schedule, 'id' | 'createdAt'>>): void
  removeSchedule(id: ScheduleId): void
  setScheduleStatus(id: ScheduleId, status: ScheduleStatus): void

  extendScheduleBy(id: ScheduleId, addMin: number): void
  completeSchedule(id: ScheduleId, completeAtMs: number): void

  addCategory(input: Omit<Category, 'id' | 'createdAt'>): CategoryId
  removeCategory(id: CategoryId): void

  setWorkingHours(date: string, hours: { startMin: number; endMin: number }): void
  bulkSetWorkingHours(dates: string[], hours: { startMin: number; endMin: number }): void
  setDefaultWorkingHours(hours: { startMin: number; endMin: number }): void

  updateSettings(patch: Partial<AppSettings>): void
}

const generateScheduleId = (): ScheduleId => `sch-${crypto.randomUUID()}`
const generateCategoryId = (): CategoryId => `cat-${crypto.randomUUID()}`

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      schedules: [],
      categories: DEFAULT_CATEGORIES,
      workingHours: {},
      settings: DEFAULT_SETTINGS,

      addSchedule(input) {
        const newSchedule: Schedule = {
          ...input,
          id: generateScheduleId(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: 'pending'
        }
        set({ schedules: [...get().schedules, newSchedule] })
        return newSchedule.id
      },

      updateSchedule(id, patch) {
        set({
          schedules: get().schedules.map((sch) =>
            sch.id === id ? { ...sch, ...patch, updatedAt: Date.now() } : sch
          )
        })
      },

      removeSchedule(id) {
        set({ schedules: get().schedules.filter((sch) => sch.id !== id) })
      },

      setScheduleStatus(id, status) {
        set({
          schedules: get().schedules.map((sch) =>
            sch.id === id ? { ...sch, status, updatedAt: Date.now() } : sch
          )
        })
      },

      extendScheduleBy(id, addMin) {
        const state = get()
        const sch = state.schedules.find((s) => s.id === id)
        if (!sch) return
        const newDuration = Math.max(1, sch.durationMin + addMin)
        const next = cascade(state.schedules, id, sch.startAt, newDuration, 'extend')
        set({ schedules: next })
      },

      completeSchedule(id, completeAtMs) {
        const state = get()
        const sch = state.schedules.find((s) => s.id === id)
        if (!sch) return
        const elapsedMin = Math.max(0, Math.floor((completeAtMs - sch.startAt) / 60_000))
        const next = cascade(state.schedules, id, sch.startAt, elapsedMin, 'complete')
        const final = next.map((s) =>
          s.id === id ? { ...s, status: 'done' as ScheduleStatus, updatedAt: Date.now() } : s
        )
        set({ schedules: final })
      },

      addCategory(input) {
        const newCategory: Category = {
          ...input,
          id: generateCategoryId(),
          createdAt: Date.now()
        }
        set({ categories: [...get().categories, newCategory] })
        return newCategory.id
      },

      removeCategory(id) {
        set({ categories: get().categories.filter((cat) => cat.id !== id) })
      },

      setWorkingHours(date, hours) {
        set({
          workingHours: {
            ...get().workingHours,
            [date]: { ...hours, date }
          }
        })
      },

      bulkSetWorkingHours(dates, hours) {
        const newWorkingHours = { ...get().workingHours }
        for (const date of dates) {
          newWorkingHours[date] = { ...hours, date }
        }
        set({ workingHours: newWorkingHours })
      },

      setDefaultWorkingHours(hours) {
        set({
          settings: {
            ...get().settings,
            defaultWorkingHours: hours
          }
        })
      },

      updateSettings(patch) {
        set({
          settings: { ...get().settings, ...patch }
        })
      }
    }),
    {
      name: 'plan1-store',
      storage: createJSONStorage(() => idbStorage),
      version: 1,
      partialize: (state) => ({
        schedules: state.schedules,
        categories: state.categories,
        workingHours: state.workingHours,
        settings: state.settings
      })
    }
  )
)
