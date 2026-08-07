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
  BlockStatus,
  ChecklistItem,
  DateKey,
  DayData,
  JournalEntry,
  Priority,
  RecurringTask,
  ScheduleBlock,
  Settings
} from '@shared/types'
import { defaultAppData, getDay } from '@shared/defaults'
import { elapsedMinutes } from '@shared/timer'
import { pendingRules } from '@shared/recurrence'
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
  | { type: 'addChecklistItem'; date: DateKey; text: string; estimateMinutes: number | null }
  | { type: 'toggleChecklistItem'; date: DateKey; id: string }
  | { type: 'deleteChecklistItem'; date: DateKey; id: string }
  | {
      type: 'addRecurringTask'
      task: Omit<RecurringTask, 'id' | 'createdAt'>
      date: DateKey
    }
  | { type: 'updateRecurringTask'; task: RecurringTask }
  | { type: 'deleteRecurringTask'; id: string }
  | { type: 'addJournalEntry'; date: DateKey; text: string }
  | { type: 'setSchedule'; date: DateKey; blocks: ScheduleBlock[]; unscheduled: string[] }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'startTimer'; date: DateKey; blockId: string }
  | { type: 'pauseTimer' }
  | { type: 'resumeTimer' }
  | { type: 'cancelTimer' }
  | { type: 'completeTimer' }
  | { type: 'setBlockStatus'; date: DateKey; blockId: string; status: BlockStatus }
  | { type: 'setBlockActualMinutes'; date: DateKey; blockId: string; minutes: number | null }

function withDay(data: AppData, date: DateKey, mutate: (day: DayData) => DayData): AppData {
  return { ...data, days: { ...data.days, [date]: mutate(getDay(data, date)) } }
}

function mapBlock(
  day: DayData,
  blockId: string,
  mutate: (block: ScheduleBlock) => ScheduleBlock
): DayData {
  if (!day.schedule) return day
  return { ...day, schedule: day.schedule.map((b) => (b.id === blockId ? mutate(b) : b)) }
}

/**
 * The block auto-journal rule, mirroring `toggleChecklistItem`: marking a block
 * done logs it, and moving it back to planned retracts exactly that entry.
 * Manual entries and checklist-linked entries are never touched.
 */
function syncBlockJournal(
  day: DayData,
  block: ScheduleBlock,
  status: BlockStatus,
  actualMinutes: number | null
): JournalEntry[] {
  const without = day.journal.filter((e) => e.scheduleBlockId !== block.id)
  if (status !== 'done') return without
  const took = actualMinutes !== null ? ` (${actualMinutes}m)` : ''
  return [
    ...without,
    {
      id: crypto.randomUUID(),
      kind: 'auto' as const,
      text: `Completed: ${block.name}${took}`,
      timestamp: new Date().toISOString(),
      scheduleBlockId: block.id
    }
  ]
}

/** Apply a status change plus its journal consequence in one place. */
function applyBlockStatus(
  data: AppData,
  date: DateKey,
  blockId: string,
  status: BlockStatus,
  actualMinutes?: number | null
): AppData {
  return withDay(data, date, (day) => {
    const block = day.schedule?.find((b) => b.id === blockId)
    // breaks are not markable
    if (!block || block.kind === 'break') return day
    const actual = actualMinutes === undefined ? block.actualMinutes : actualMinutes
    const withStatus = mapBlock(day, blockId, (b) => ({ ...b, status, actualMinutes: actual }))
    return { ...withStatus, journal: syncBlockJournal(day, block, status, actual) }
  })
}

/**
 * Drop in the checklist items for every recurring rule due on `date` that this
 * day hasn't already had applied.
 *
 * The applied-rule ids are recorded on the day rather than as a global "last
 * run" marker, so deleting a generated task makes it stay gone. Saying "not
 * today" has to stick, or the app argues with the user on every launch.
 *
 * Only ever called for the real current date — never when browsing history.
 */
function applyRecurring(data: AppData, date: DateKey): AppData {
  const due = pendingRules(data.recurringTasks, date, getDay(data, date).recurringApplied)
  if (due.length === 0) return data

  const now = new Date().toISOString()
  return withDay(data, date, (day) => ({
    ...day,
    checklist: [
      ...day.checklist,
      ...due.map((rule) => ({
        id: crypto.randomUUID(),
        text: rule.text,
        done: false,
        createdAt: now,
        completedAt: null,
        estimateMinutes: rule.estimateMinutes,
        source: 'recurring' as const,
        recurringTaskId: rule.id
      }))
    ],
    recurringApplied: [...day.recurringApplied, ...due.map((r) => r.id)]
  }))
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        data: applyRecurring(action.data, state.activeDate),
        hydrated: true
      }
    case 'setActiveDate':
      // dispatched only by the rollover interval, so this is always the real
      // new day — browsing history in the Journal uses local state instead
      return {
        ...state,
        activeDate: action.date,
        data: applyRecurring(state.data, action.date)
      }
    case 'addActivity': {
      const activity: Activity = {
        id: crypto.randomUUID(),
        name: action.name,
        durationMinutes: action.durationMinutes,
        priority: action.priority,
        mode: action.mode,
        projectId: null, // wired to the UI in Phase 2
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
        completedAt: null,
        estimateMinutes: action.estimateMinutes,
        source: 'manual'
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
    case 'addRecurringTask': {
      const task: RecurringTask = {
        ...action.task,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      }
      const withTask = { ...state.data, recurringTasks: [...state.data.recurringTasks, task] }
      // run it straight away so a rule due today shows up without waiting for midnight
      return { ...state, data: applyRecurring(withTask, action.date) }
    }
    case 'updateRecurringTask':
      return {
        ...state,
        data: {
          ...state.data,
          recurringTasks: state.data.recurringTasks.map((t) =>
            t.id === action.task.id ? action.task : t
          )
        }
      }
    case 'deleteRecurringTask':
      // tasks it already created stay put — they are part of the day's record now
      return {
        ...state,
        data: {
          ...state.data,
          recurringTasks: state.data.recurringTasks.filter((t) => t.id !== action.id)
        }
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
    case 'startTimer':
      // starting a new block abandons any previous run rather than stacking timers
      return {
        ...state,
        data: {
          ...state.data,
          activeTimer: {
            dateKey: action.date,
            blockId: action.blockId,
            startedAt: new Date().toISOString(),
            accumulatedMs: 0,
            paused: false
          }
        }
      }
    case 'pauseTimer': {
      const t = state.data.activeTimer
      if (!t || t.paused) return state
      // bank the running segment, then freeze
      return {
        ...state,
        data: {
          ...state.data,
          activeTimer: {
            ...t,
            accumulatedMs: t.accumulatedMs + Math.max(0, Date.now() - Date.parse(t.startedAt)),
            paused: true
          }
        }
      }
    }
    case 'resumeTimer': {
      const t = state.data.activeTimer
      if (!t || !t.paused) return state
      return {
        ...state,
        data: {
          ...state.data,
          activeTimer: { ...t, startedAt: new Date().toISOString(), paused: false }
        }
      }
    }
    case 'cancelTimer':
      // discard the measurement; the block keeps whatever status it had
      return { ...state, data: { ...state.data, activeTimer: null } }
    case 'completeTimer': {
      const t = state.data.activeTimer
      if (!t) return state
      const data = applyBlockStatus(state.data, t.dateKey, t.blockId, 'done', elapsedMinutes(t))
      return { ...state, data: { ...data, activeTimer: null } }
    }
    case 'setBlockStatus': {
      const data = applyBlockStatus(state.data, action.date, action.blockId, action.status)
      // a block being marked by hand shouldn't keep running in the background
      const t = state.data.activeTimer
      const clears = t && t.blockId === action.blockId && t.dateKey === action.date
      return { ...state, data: clears ? { ...data, activeTimer: null } : data }
    }
    case 'setBlockActualMinutes':
      return {
        ...state,
        data: withDay(state.data, action.date, (day) =>
          mapBlock(day, action.blockId, (b) => ({ ...b, actualMinutes: action.minutes }))
        )
      }
  }
}

interface DataContextValue {
  state: State
  dispatch: Dispatch<Action>
  today: DayData
  activities: Activity[]
  recurringTasks: RecurringTask[]
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
      recurringTasks: state.data.recurringTasks,
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
