import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode
} from 'react'
import type {
  Activity,
  ActivityMode,
  AppData,
  ChecklistItem,
  DateKey,
  DayData,
  Priority,
  ScheduleBlock,
  Settings
} from '@shared/types'
import { defaultAppData, getDay } from '@shared/defaults'
import { todayKey } from '@shared/time'

export interface State {
  data: AppData
  activeDate: DateKey
  hydrated: boolean
}

export type Action =
  | { type: 'hydrate'; data: AppData }
  | { type: 'setActiveDate'; date: DateKey }
  | {
      type: 'addActivity'
      name: string
      durationMinutes: number
      priority: Priority
      mode: ActivityMode
    }
  | { type: 'updateActivity'; activity: Activity }
  | { type: 'deleteActivity'; id: string }
  | { type: 'addChecklistItem'; date: DateKey; text: string }
  | { type: 'toggleChecklistItem'; date: DateKey; id: string }
  | { type: 'deleteChecklistItem'; date: DateKey; id: string }
  | { type: 'addJournalEntry'; date: DateKey; text: string }
  | { type: 'setSchedule'; date: DateKey; blocks: ScheduleBlock[]; unscheduled: string[] }
  | { type: 'updateSettings'; patch: Partial<Settings> }

function withDay(data: AppData, date: DateKey, mutate: (day: DayData) => DayData): AppData {
  return { ...data, days: { ...data.days, [date]: mutate(getDay(data, date)) } }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return { ...state, data: action.data, hydrated: true }
    case 'setActiveDate':
      return { ...state, activeDate: action.date }
    case 'addActivity': {
      const activity: Activity = {
        id: crypto.randomUUID(),
        name: action.name,
        durationMinutes: action.durationMinutes,
        priority: action.priority,
        mode: action.mode,
        createdAt: new Date().toISOString()
      }
      return {
        ...state,
        data: { ...state.data, activities: [...state.data.activities, activity] }
      }
    }
    case 'updateActivity':
      return {
        ...state,
        data: {
          ...state.data,
          activities: state.data.activities.map((a) =>
            a.id === action.activity.id ? action.activity : a
          )
        }
      }
    case 'deleteActivity':
      return {
        ...state,
        data: {
          ...state.data,
          activities: state.data.activities.filter((a) => a.id !== action.id)
        }
      }
    case 'addChecklistItem': {
      const item: ChecklistItem = {
        id: crypto.randomUUID(),
        text: action.text,
        done: false,
        createdAt: new Date().toISOString(),
        completedAt: null
      }
      return {
        ...state,
        data: withDay(state.data, action.date, (day) => ({
          ...day,
          checklist: [...day.checklist, item]
        }))
      }
    }
    case 'toggleChecklistItem':
      return {
        ...state,
        data: withDay(state.data, action.date, (day) => {
          const item = day.checklist.find((i) => i.id === action.id)
          if (!item) return day
          const now = new Date().toISOString()
          const toggled: ChecklistItem = {
            ...item,
            done: !item.done,
            completedAt: item.done ? null : now
          }
          // the auto-journal rule: checking logs an entry, unchecking retracts it
          const journal = toggled.done
            ? [
                ...day.journal,
                {
                  id: crypto.randomUUID(),
                  kind: 'auto' as const,
                  text: `Completed: ${item.text}`,
                  timestamp: now,
                  checklistItemId: item.id
                }
              ]
            : day.journal.filter((e) => e.checklistItemId !== action.id)
          return {
            ...day,
            checklist: day.checklist.map((i) => (i.id === action.id ? toggled : i)),
            journal
          }
        })
      }
    case 'deleteChecklistItem':
      // journal entries are kept — completed work stays in history
      return {
        ...state,
        data: withDay(state.data, action.date, (day) => ({
          ...day,
          checklist: day.checklist.filter((i) => i.id !== action.id)
        }))
      }
    case 'addJournalEntry':
      return {
        ...state,
        data: withDay(state.data, action.date, (day) => ({
          ...day,
          journal: [
            ...day.journal,
            {
              id: crypto.randomUUID(),
              kind: 'manual' as const,
              text: action.text,
              timestamp: new Date().toISOString()
            }
          ]
        }))
      }
    case 'setSchedule':
      return {
        ...state,
        data: withDay(state.data, action.date, (day) => ({
          ...day,
          schedule: action.blocks,
          unscheduled: action.unscheduled
        }))
      }
    case 'updateSettings':
      return {
        ...state,
        data: { ...state.data, settings: { ...state.data.settings, ...action.patch } }
      }
  }
}

interface DataContextValue {
  state: State
  dispatch: Dispatch<Action>
  today: DayData
  activities: Activity[]
  settings: Settings
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, {
    data: defaultAppData(),
    activeDate: todayKey(),
    hydrated: false
  })

  useEffect(() => {
    window.api.loadData().then((data) => dispatch({ type: 'hydrate', data }))
  }, [])

  // persist every committed change after hydration (skip the hydrate commit itself)
  const skippedHydrateCommit = useRef(false)
  useEffect(() => {
    if (!state.hydrated) return
    if (!skippedHydrateCommit.current) {
      skippedHydrateCommit.current = true
      return
    }
    void window.api.saveData(state.data)
  }, [state.data, state.hydrated])

  // day rollover: swap to the new day's data shortly after midnight
  const activeDateRef = useRef(state.activeDate)
  useEffect(() => {
    activeDateRef.current = state.activeDate
  }, [state.activeDate])
  useEffect(() => {
    const interval = setInterval(() => {
      const key = todayKey()
      if (key !== activeDateRef.current) {
        dispatch({ type: 'setActiveDate', date: key })
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  const value = useMemo<DataContextValue>(
    () => ({
      state,
      dispatch,
      today: getDay(state.data, state.activeDate),
      activities: state.data.activities,
      settings: state.data.settings
    }),
    [state]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- standard context hook pattern
export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}
