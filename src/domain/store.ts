import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { idbStorage } from './storage'
import type { Category, CategoryId, Schedule, ScheduleId, ScheduleStatus, WorkingHours, AppSettings } from './types'

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
    (set) => ({
      schedules: [],
      categories: DEFAULT_CATEGORIES,
      workingHours: {},
      settings: DEFAULT_SETTINGS,

      addSchedule(input) {
        const id = generateScheduleId()
        const createdAt = Date.now()
        const updatedAt = createdAt
        const status = 'pending'
        const newSchedule: Schedule = {
          id,
          createdAt,
          updatedAt,
          status,
          ...input
        }
        set(state => ({
          schedules: [...state.schedules, newSchedule]
        }))
        return id
      },

      updateSchedule(id, patch) {
        set(state => ({
          schedules: state.schedules.map(schedule => {
            if (schedule.id === id) {
              return {
                ...schedule,
                ...patch,
                updatedAt: Date.now()
              }
            }
            return schedule
          })
        }))
      },

      removeSchedule(id) {
        set(state => ({
          schedules: state.schedules.filter(schedule => schedule.id !== id)
        }))
      },

      setScheduleStatus(id, status) {
        set(state => ({
          schedules: state.schedules.map(schedule => {
            if (schedule.id === id) {
              return {
                ...schedule,
                status,
                updatedAt: Date.now()
              }
            }
            return schedule
          })
        }))
      },

      addCategory(input) {
        const id = generateCategoryId()
        const createdAt = Date.now()
        const newCategory: Category = {
          id,
          createdAt,
          ...input
        }
        set(state => ({
          categories: [...state.categories, newCategory]
        }))
        return id
      },

      removeCategory(id) {
        set(state => ({
          categories: state.categories.filter(category => category.id !== id)
        }))
      },

      setWorkingHours(date, hours) {
        set(state => ({
          workingHours: {
            ...state.workingHours,
            [date]: { date, ...hours }
          }
        }))
      },

      bulkSetWorkingHours(dates, hours) {
        const newWorkingHours: Record<string, WorkingHours> = {}
        dates.forEach(date => {
          newWorkingHours[date] = { date, ...hours }
        })
        set(state => ({
          workingHours: {
            ...state.workingHours,
            ...newWorkingHours
          }
        }))
      },

      setDefaultWorkingHours(hours) {
        set(state => ({
          settings: {
            ...state.settings,
            defaultWorkingHours: hours
          }
        }))
      },

      updateSettings(patch) {
        set(state => ({
          settings: {
            ...state.settings,
            ...patch
          }
        }))
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
