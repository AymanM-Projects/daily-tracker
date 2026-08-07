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
  BacklogTask,
  BlockStatus,
  DateKey,
  DayData,
  JournalEntry,
  PrayerSettings,
  Priority,
  RecurringTask,
  ScheduleBlock,
  Settings
} from '@shared/types'
import type { Anchor } from '@shared/schedule'
import { defaultAppData, getDay } from '@shared/defaults'
import { blockMinutes } from '@shared/blocks'
import { extendBlock as extendGeometry } from '@shared/reschedule'
import { elapsedMinutes } from '@shared/timer'
import { pendingRules } from '@shared/recurrence'
import { PLAN_DEFAULTS, planBacklog } from '@shared/plan'
import { prayerTimes } from '@shared/prayer'
import { minutesNow, shiftDateKey, todayKey } from '@shared/time'

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
  | {
      type: 'addBacklogTask'
      date: DateKey
      text: string
      estimateMinutes: number | null
      priority: Priority
      dueDate: DateKey | null
    }
  | { type: 'toggleBacklogTask'; date: DateKey; id: string }
  | { type: 'updateBacklogTask'; date: DateKey; task: BacklogTask }
  | { type: 'deleteBacklogTask'; date: DateKey; id: string }
  | { type: 'replan'; date: DateKey }
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
  | { type: 'updatePrayer'; patch: Partial<PrayerSettings> }
  | { type: 'startTimer'; date: DateKey; blockId: string }
  | { type: 'pauseTimer' }
  | { type: 'resumeTimer' }
  | { type: 'cancelTimer' }
  | { type: 'completeTimer' }
  | { type: 'setBlockStatus'; date: DateKey; blockId: string; status: BlockStatus }
  | { type: 'setBlockActualMinutes'; date: DateKey; blockId: string; minutes: number | null }
  /**
   * Replace a day's blocks, keeping `unscheduled` (unlike `setSchedule`, which
   * replaces the day wholesale after a regeneration).
   *
   * Geometry is computed by the caller through `shared/reschedule.ts` and only
   * the result is dispatched — the same seam `SchedulePane.generate()` already
   * uses for `generateSchedule`. That keeps every action plain serialisable
   * data: an edit that collides is refused in the component, where the sheet can
   * actually name what is in the way, rather than failing silently in here.
   */
  | { type: 'setDaySchedule'; date: DateKey; blocks: ScheduleBlock[] }
  /** "more time now" — grow the block, letting free time absorb what it can */
  | { type: 'extendBlock'; date: DateKey; blockId: string; minutes: number }
  /**
   * "keep it for later" — the slot was spent but the work is not done, so the
   * block settles as `partial` and the unfinished minutes go back to the planner.
   */
  | { type: 'bankBlockTime'; date: DateKey; blockId: string; minutes: number }
  /** the prompt was answered or explicitly waived; a dismissal never lands here */
  | { type: 'markBlockPrompted'; date: DateKey; blockId: string }

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
  if (status !== 'done' && status !== 'partial') return without
  const took = actualMinutes !== null ? ` (${actualMinutes}m)` : ''
  return [
    ...without,
    {
      id: crypto.randomUUID(),
      kind: 'auto' as const,
      // 'partial' exists so this line can stay true. Without it, "keep for later"
      // would have to record `done`, and the journal would claim an essay was
      // finished that is not — the one thing it must never do.
      text: `${status === 'done' ? 'Completed' : 'Worked on'}: ${block.name}${took}`,
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
    // neither breaks nor prayer anchors are the user's to mark done or skip
    if (!block || block.kind !== 'activity') return day
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
  // rules now feed the standing backlog, due on the day they fire, rather than a
  // per-day list. `recurringApplied` stays the idempotency record either way.
  const created: BacklogTask[] = due.map((rule) => ({
    id: crypto.randomUUID(),
    text: rule.text,
    priority: 2,
    estimateMinutes: rule.estimateMinutes,
    dueDate: date,
    done: false,
    completedAt: null,
    createdAt: now,
    recurringTaskId: rule.id
  }))

  return withDay({ ...data, backlog: [...data.backlog, ...created] }, date, (day) => ({
    ...day,
    recurringApplied: [...day.recurringApplied, ...due.map((r) => r.id)]
  }))
}

/**
 * Re-run placement for everything still outstanding in the backlog.
 *
 * Additive by construction: `planBacklog` only ever returns blocks for free
 * time, so calling this on every backlog change can never disturb work already
 * scheduled or a day the user is partway through.
 */
function replan(data: AppData, from: DateKey): AppData {
  const days: Record<DateKey, ScheduleBlock[]> = {}
  for (const [date, day] of Object.entries(data.days)) {
    if (day.schedule) days[date] = day.schedule
  }

  // prayer times are resolved here so shared/plan.ts stays prayer-agnostic
  const anchorsByDate: Record<DateKey, Anchor[]> = {}
  if (data.prayer.enabled) {
    for (let i = 0; i < PLAN_DEFAULTS.horizonDays; i++) {
      const date = shiftDateKey(from, i)
      anchorsByDate[date] = prayerTimes(date, data.prayer)
        .filter((t) => data.prayer.include.includes(t.name))
        .map((t) => ({ name: t.name, start: t.minutes, end: t.minutes + data.prayer.blockMinutes }))
    }
  }

  const { placements } = planBacklog({
    backlog: data.backlog,
    days,
    anchorsByDate,
    settings: data.settings,
    fromDate: from,
    fromMinute: minutesNow()
  })

  if (Object.keys(placements).length === 0) return data

  const nextDays = { ...data.days }
  for (const [date, blocks] of Object.entries(placements)) {
    const day = getDay(data, date)
    // a day that was never generated becomes a real schedule here — that is what
    // lets work spill forward into days the user has not planned yet
    nextDays[date] = { ...day, schedule: [...(day.schedule ?? []), ...blocks] }
  }
  return { ...data, days: nextDays }
}

/**
 * Drop a task's *future* placements so the time frees up. Blocks already in the
 * past stay: they are a record of what the day looked like, not a plan any more.
 */
function releaseTask(data: AppData, taskId: string, from: DateKey): AppData {
  const nextDays: Record<DateKey, DayData> = {}
  let changed = false
  for (const [date, day] of Object.entries(data.days)) {
    if (date < from || !day.schedule) {
      nextDays[date] = day
      continue
    }
    const kept = day.schedule.filter((b) => b.backlogTaskId !== taskId)
    if (kept.length !== day.schedule.length) changed = true
    nextDays[date] = { ...day, schedule: kept }
  }
  return changed ? { ...data, days: nextDays } : data
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
    case 'addBacklogTask': {
      const task: BacklogTask = {
        id: crypto.randomUUID(),
        text: action.text,
        priority: action.priority,
        estimateMinutes: action.estimateMinutes,
        dueDate: action.dueDate,
        done: false,
        completedAt: null,
        createdAt: new Date().toISOString()
      }
      // place it immediately — safe on every add because placement only fills gaps
      return {
        ...state,
        data: replan({ ...state.data, backlog: [...state.data.backlog, task] }, action.date)
      }
    }
    case 'toggleBacklogTask': {
      const task = state.data.backlog.find((t) => t.id === action.id)
      if (!task) return state
      const now = new Date().toISOString()
      const done = !task.done

      const backlog = state.data.backlog.map((t) =>
        t.id === action.id ? { ...t, done, completedAt: done ? now : null } : t
      )
      // the auto-journal rule, unchanged: finishing logs it, un-finishing retracts it
      const journal = done
        ? [
            ...getDay(state.data, action.date).journal,
            {
              id: crypto.randomUUID(),
              kind: 'auto' as const,
              text: `Completed: ${task.text}`,
              timestamp: now,
              checklistItemId: task.id
            }
          ]
        : getDay(state.data, action.date).journal.filter((e) => e.checklistItemId !== action.id)

      const withJournal = withDay({ ...state.data, backlog }, action.date, (day) => ({
        ...day,
        journal
      }))
      // finishing frees the time it was holding; un-finishing asks for it back
      const released = releaseTask(withJournal, action.id, action.date)
      return { ...state, data: done ? released : replan(released, action.date) }
    }
    case 'updateBacklogTask': {
      const backlog = state.data.backlog.map((t) => (t.id === action.task.id ? action.task : t))
      // the estimate or deadline may have moved, so drop its future slots and re-place
      const released = releaseTask({ ...state.data, backlog }, action.task.id, action.date)
      return { ...state, data: replan(released, action.date) }
    }
    case 'deleteBacklogTask':
      // journal entries are kept — completed work stays in history
      return {
        ...state,
        data: releaseTask(
          { ...state.data, backlog: state.data.backlog.filter((t) => t.id !== action.id) },
          action.id,
          action.date
        )
      }
    case 'replan':
      return { ...state, data: replan(state.data, action.date) }
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
    case 'updatePrayer':
      return {
        ...state,
        data: { ...state.data, prayer: { ...state.data.prayer, ...action.patch } }
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
        data: withDay(state.data, action.date, (day) => {
          // free time and prayers have no "how long did it take" — the same guard
          // applyBlockStatus carries, now that free blocks are tappable
          const block = day.schedule?.find((b) => b.id === action.blockId)
          if (!block || block.kind !== 'activity') return day
          return mapBlock(day, action.blockId, (b) => ({ ...b, actualMinutes: action.minutes }))
        })
      }
    case 'setDaySchedule':
      return {
        ...state,
        data: withDay(state.data, action.date, (day) => ({ ...day, schedule: action.blocks }))
      }
    case 'extendBlock': {
      const day = getDay(state.data, action.date)
      if (!day.schedule) return state
      const grown = extendGeometry(day.schedule, action.blockId, action.minutes)
      const withBlocks = withDay(state.data, action.date, (d) => ({ ...d, schedule: grown.blocks }))
      // extending can push work past the day end, which frees nothing but may
      // change what still fits; replanning keeps the backlog honest either way
      return { ...state, data: replan(withBlocks, action.date) }
    }
    case 'bankBlockTime': {
      const day = getDay(state.data, action.date)
      const block = day.schedule?.find((b) => b.id === action.blockId)
      if (!block || block.kind !== 'activity') return state

      const spent = blockMinutes(block)
      const settled = applyBlockStatus(state.data, action.date, action.blockId, 'partial', spent)
      const stamped = withDay(settled, action.date, (d) =>
        mapBlock(d, action.blockId, (b) => ({ ...b, promptedAt: new Date().toISOString() }))
      )

      // `planBacklog` derives remaining work as estimate minus minutes already
      // placed, so raising the estimate IS "give me N more minutes, somewhere".
      let backlog = stamped.backlog
      if (block.backlogTaskId !== null) {
        backlog = backlog.map((t) =>
          t.id === block.backlogTaskId
            ? { ...t, estimateMinutes: (t.estimateMinutes ?? spent) + action.minutes }
            : t
        )
      } else {
        // A generated activity block has no task to raise. Minting one is the only
        // bridge from the activity world into the planner, which has no notion of
        // `Activity` at all — without it the unfinished work has no way to move.
        const source = stamped.activities.find((a) => a.id === block.activityId)
        backlog = [
          ...backlog,
          {
            id: crypto.randomUUID(),
            text: block.name,
            priority: source?.priority ?? 2,
            estimateMinutes: action.minutes,
            dueDate: null,
            done: false,
            completedAt: null,
            createdAt: new Date().toISOString()
          }
        ]
      }
      return { ...state, data: replan({ ...stamped, backlog }, action.date) }
    }
    case 'markBlockPrompted':
      return {
        ...state,
        data: withDay(state.data, action.date, (day) =>
          mapBlock(day, action.blockId, (b) => ({
            ...b,
            promptedAt: new Date().toISOString()
          }))
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
  backlog: BacklogTask[]
  settings: Settings
  prayer: PrayerSettings
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
      backlog: state.data.backlog,
      settings: state.data.settings,
      prayer: state.data.prayer
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
