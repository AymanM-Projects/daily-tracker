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
  DayPause,
  JournalEntry,
  McpEntityCreated,
  PrayerSettings,
  Priority,
  Project,
  RecurringTask,
  Routine,
  ScheduleBlock,
  Settings
} from '@shared/types'
import type { Anchor } from '@shared/schedule'
import { defaultAppData, getDay } from '@shared/defaults'
import { blockEnd, blockMinutes } from '@shared/blocks'
import {
  bankSpilled,
  extendBlock as extendGeometry,
  removeBlock,
  shiftAfter,
  spill,
  truncate as truncateGeometry
} from '@shared/reschedule'
import { elapsedMinutes } from '@shared/timer'
import { resolveRecurring, ruleFromTask } from '@shared/recurrence'
import { PLAN_DEFAULTS, planBacklog } from '@shared/plan'
import { dayAnchors } from '@shared/anchors'
import { alreadyCarried, carryForward, daysToSweep } from '@shared/carry'
import { minutesNow, parseHM, shiftDateKey, todayKey } from '@shared/time'

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
      dueDate: DateKey | null
      projectId: string | null
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
      projectId: string | null
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
  | { type: 'convertTaskToRecurring'; taskId: string; date: DateKey }
  | { type: 'addRoutine'; routine: Omit<Routine, 'id' | 'createdAt'> }
  | { type: 'updateRoutine'; routine: Routine }
  | { type: 'deleteRoutine'; id: string }
  | { type: 'addProject'; project: Omit<Project, 'id' | 'createdAt' | 'archived'> }
  | { type: 'updateProject'; project: Project }
  /**
   * Hard delete. Unlinks rather than blocks: any Activity or BacklogTask still
   * pointing at this project gets `projectId: null` in the same commit, so
   * nothing is left holding a dangling id — the same dangling-reference handling
   * the rest of the app already uses.
   */
  | { type: 'deleteProject'; id: string }
  | { type: 'addJournalEntry'; date: DateKey; text: string }
  /**
   * Rewrite an entry's text. An auto entry becomes `manual` and loses its link:
   * `syncBlockJournal` deletes and recreates a block's entry on every status
   * change, so a link kept here would let the next tick of a checkbox silently
   * destroy what the user wrote.
   */
  | { type: 'updateJournalEntry'; date: DateKey; id: string; text: string }
  | { type: 'deleteJournalEntry'; date: DateKey; id: string }
  | { type: 'setSchedule'; date: DateKey; blocks: ScheduleBlock[]; unscheduled: string[] }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  | { type: 'updatePrayer'; patch: Partial<PrayerSettings> }
  /**
   * `startedAt` lets autopilot count from the block's own start rather than
   * from the tick that noticed it. That is what makes `actualMinutes` mean
   * "time from the block beginning until you said done", which is exactly what
   * the early-finish check measures against.
   */
  | { type: 'startTimer'; date: DateKey; blockId: string; startedAt?: string }
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
  /**
   * Finished early. `fill: 'free'` protects the released span; `fill: 'pull'`
   * hands it back to the day and drags the rest of it earlier.
   */
  | {
      type: 'truncateBlock'
      date: DateKey
      blockId: string
      actualMinutes: number
      fill: 'free' | 'pull'
    }
  /** "something came up" — freeze the day and the running block together */
  | { type: 'pauseDay'; date: DateKey }
  | { type: 'resumeDay' }
  /**
   * An external Claude session created this through the embedded MCP server.
   * Pure append, the same shape `addActivity`/`addBacklogTask` already use —
   * this is what lets the renderer's in-memory copy absorb an MCP-originated
   * write instead of silently erasing it on its own next `saveData`. See
   * `src/main/mcp-server.ts` for the other half of this fix.
   */
  | { type: 'externalEntityCreated'; event: McpEntityCreated }

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
  const resolutions = resolveRecurring(
    data.recurringTasks,
    data.backlog,
    date,
    getDay(data, date).recurringApplied
  )
  if (resolutions.length === 0) return data

  const now = new Date().toISOString()
  // rules now feed the standing backlog, due on the day they fire, rather than a
  // per-day list. `recurringApplied` stays the idempotency record either way.
  const created: BacklogTask[] = resolutions
    .filter((r) => r.existing === null)
    .map(({ rule }) => ({
      id: crypto.randomUUID(),
      text: rule.text,
      priority: 2,
      estimateMinutes: rule.estimateMinutes,
      dueDate: date,
      projectId: null, // recurring rules aren't given project linkage in this phase
      done: false,
      completedAt: null,
      createdAt: now,
      recurringTaskId: rule.id
    }))

  // an undone instance from an earlier firing is still open — pull it forward
  // to today instead of minting a duplicate. Only dueDate moves; the user's
  // own edits to text/estimate/priority/project on that instance survive.
  const refreshIds = new Set(
    resolutions.filter((r) => r.existing !== null).map((r) => r.existing!.id)
  )
  const backlog = data.backlog.map((t) => (refreshIds.has(t.id) ? { ...t, dueDate: date } : t))

  return withDay({ ...data, backlog: [...backlog, ...created] }, date, (day) => ({
    ...day,
    recurringApplied: [...day.recurringApplied, ...resolutions.map((r) => r.rule.id)]
  }))
}

/**
 * Turn work left unfinished on days that have passed into standing backlog
 * tasks, so it reappears on the days ahead instead of vanishing with the date.
 *
 * The past is never rewritten. Yesterday's blocks keep exactly the shape the
 * user last saw — a day that has happened is a record, and tidying it after the
 * fact would claim a history that never occurred. All that changes is that the
 * outstanding minutes become new tasks; `replan` then places them.
 *
 * `carriedForward` is stamped on each swept day, which is what makes this run
 * once. Deleting a carried task must leave it deleted, exactly as with
 * `recurringApplied`.
 */
function applyCarryForward(data: AppData, today: DateKey): AppData {
  const stale = daysToSweep(data.days, today)
  if (stale.length === 0) return data

  const now = new Date().toISOString()
  const created: BacklogTask[] = []
  const days = { ...data.days }

  for (const date of stale) {
    for (const work of carryForward(days[date], date, today)) {
      // second guard behind `carriedForward`: even if a day were somehow swept
      // twice, a block can only ever mint one task
      if (alreadyCarried([...data.backlog, ...created], work.sourceBlockId)) continue
      created.push({
        id: crypto.randomUUID(),
        text: work.text,
        priority: work.priority,
        estimateMinutes: work.estimateMinutes,
        dueDate: work.dueDate,
        projectId: null, // same deliberate drop as priority/dueDate above
        done: false,
        completedAt: null,
        createdAt: now,
        carriedFromBlockId: work.sourceBlockId
      })
    }
    days[date] = { ...days[date], carriedForward: true }
  }

  const swept = { ...data, days, backlog: [...data.backlog, ...created] }
  // nothing outstanding, but the days are still marked so they are not re-read
  return created.length === 0 ? swept : replan(swept, today)
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

  // Prayers and routines are resolved here so shared/plan.ts stays ignorant of
  // both. `dayAnchors` is the same function SchedulePane.generate() uses, so the
  // day the button builds and the day the planner sees agree on what is fixed.
  const anchorsByDate: Record<DateKey, Anchor[]> = {}
  for (let i = 0; i < PLAN_DEFAULTS.horizonDays; i++) {
    const date = shiftDateKey(from, i)
    anchorsByDate[date] = dayAnchors(data, date)
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

/** Quitting while paused and reopening days later must not drag the day by thousands of minutes. */
const MAX_PAUSE_MINUTES = 8 * 60

const minutesOfISO = (iso: string): number => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * How long the pause has run, or null if it is no longer a pause we may act on.
 *
 * A pause is a **within-day** device. Crossing midnight or running absurdly long
 * both mean "clear it, shift nothing" — each otherwise moves the day by hundreds
 * of minutes with no undo, so both are checked on `hydrate` and `setActiveDate`
 * as well as on resume.
 */
function pauseElapsed(pause: DayPause | null): number | null {
  if (!pause) return null
  if (pause.dateKey !== todayKey()) return null
  const minutes = Math.round((Date.now() - Date.parse(pause.pausedAt)) / 60_000)
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_PAUSE_MINUTES) return null
  return minutes
}

/** Drop a pause that is no longer actionable, without shifting anything. */
function clearStalePause(data: AppData): AppData {
  if (!data.dayPause) return data
  return pauseElapsed(data.dayPause) === null ? { ...data, dayPause: null } : data
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        data: clearStalePause(
          applyCarryForward(applyRecurring(action.data, state.activeDate), state.activeDate)
        ),
        hydrated: true
      }
    case 'setActiveDate':
      // dispatched only by the rollover interval, so this is always the real
      // new day — browsing history in the Journal uses local state instead
      return {
        ...state,
        activeDate: action.date,
        data: clearStalePause(
          applyCarryForward(applyRecurring(state.data, action.date), action.date)
        )
      }
    case 'addActivity': {
      const activity: Activity = {
        id: crypto.randomUUID(),
        name: action.name,
        durationMinutes: action.durationMinutes,
        priority: action.priority,
        mode: action.mode,
        dueDate: action.dueDate,
        projectId: action.projectId,
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
        projectId: action.projectId,
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
    // Routines only take effect on the next Regenerate. A day already underway
    // is never rewritten from a settings change — the same rule the schedule
    // generator follows, and the reason regeneration is a button.
    case 'addRoutine': {
      const routine: Routine = {
        ...action.routine,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      }
      return { ...state, data: { ...state.data, routines: [...state.data.routines, routine] } }
    }
    case 'updateRoutine':
      return {
        ...state,
        data: {
          ...state.data,
          routines: state.data.routines.map((r) =>
            r.id === action.routine.id ? action.routine : r
          )
        }
      }
    case 'deleteRoutine':
      return {
        ...state,
        data: { ...state.data, routines: state.data.routines.filter((r) => r.id !== action.id) }
      }
    case 'addProject': {
      const project: Project = {
        ...action.project,
        id: crypto.randomUUID(),
        archived: false,
        createdAt: new Date().toISOString()
      }
      return { ...state, data: { ...state.data, projects: [...state.data.projects, project] } }
    }
    // Full-record replace, exactly like updateRoutine — this is also how
    // archiving/unarchiving happens, by flipping `archived` on the same object.
    case 'updateProject':
      return {
        ...state,
        data: {
          ...state.data,
          projects: state.data.projects.map((p) =>
            p.id === action.project.id ? action.project : p
          )
        }
      }
    case 'deleteProject':
      return {
        ...state,
        data: {
          ...state.data,
          projects: state.data.projects.filter((p) => p.id !== action.id),
          activities: state.data.activities.map((a) =>
            a.projectId === action.id ? { ...a, projectId: null } : a
          ),
          backlog: state.data.backlog.map((t) =>
            t.projectId === action.id ? { ...t, projectId: null } : t
          )
        }
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
    case 'convertTaskToRecurring': {
      const task = state.data.backlog.find((t) => t.id === action.taskId)
      // deleted or finished between the click and this dispatch — nothing to convert
      if (!task || task.done) return state

      const rule: RecurringTask = {
        ...ruleFromTask(task),
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      }
      const withRule = {
        ...state.data,
        recurringTasks: [...state.data.recurringTasks, rule],
        backlog: state.data.backlog.map((t) =>
          t.id === action.taskId ? { ...t, recurringTaskId: rule.id } : t
        )
      }
      // the link must exist before this runs, or today's own instance isn't
      // recognised as the rule's "existing" task and gets duplicated on the spot
      return { ...state, data: applyRecurring(withRule, action.date) }
    }
    case 'updateJournalEntry':
      return {
        ...state,
        data: withDay(state.data, action.date, (day) => ({
          ...day,
          journal: day.journal.map((e) =>
            e.id === action.id
              ? // Editing takes ownership of the words. The link is dropped by
                // rebuilding the entry without it — that is what stops
                // `syncBlockJournal` rewriting them, and equally stops
                // un-marking the block from deleting a sentence the app never wrote.
                {
                  id: e.id,
                  kind: 'manual' as const,
                  text: action.text,
                  timestamp: e.timestamp
                }
              : e
          )
        }))
      }
    case 'deleteJournalEntry':
      return {
        ...state,
        data: withDay(state.data, action.date, (day) => ({
          ...day,
          journal: day.journal.filter((e) => e.id !== action.id)
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
            startedAt: action.startedAt ?? new Date().toISOString(),
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
            projectId: source?.projectId ?? null,
            done: false,
            completedAt: null,
            createdAt: new Date().toISOString()
          }
        ]
      }
      return { ...state, data: replan({ ...stamped, backlog }, action.date) }
    }
    case 'truncateBlock': {
      const day = getDay(state.data, action.date)
      if (!day.schedule) return state
      const cut = truncateGeometry(day.schedule, action.blockId, action.actualMinutes)

      // 'free' protects the span: without it the very next replan reclaims the
      // minutes just liberated, and "I finished early" silently resolves to
      // "here is more work".
      let blocks = cut.blocks
      if (action.fill === 'pull' && cut.freeBlockId !== null) {
        const releasedAt = minutesNow()
        blocks = shiftAfter(
          removeBlock(blocks, cut.freeBlockId, { vacate: 'gap' }),
          releasedAt,
          -cut.freedMinutes
        )
      }

      const stamped = withDay(state.data, action.date, (d) => ({ ...d, schedule: blocks })).days
      const next = withDay({ ...state.data, days: stamped }, action.date, (d) =>
        mapBlock(d, action.blockId, (b) => ({ ...b, promptedAt: new Date().toISOString() }))
      )
      // pulling opens time at the tail, so the backlog gets another look;
      // protecting the span deliberately does not
      return { ...state, data: action.fill === 'pull' ? replan(next, action.date) : next }
    }
    case 'pauseDay': {
      const t = state.data.activeTimer
      const running = t !== null && !t.paused
      // Both facts land in ONE commit. Two dispatches would mean two renders and
      // two whole-document writes, and a block timer left running through the
      // freeze would record the pause as work.
      return {
        ...state,
        data: {
          ...state.data,
          dayPause: {
            dateKey: action.date,
            pausedAt: new Date().toISOString(),
            pausedTimer: running
          },
          activeTimer: running
            ? {
                ...t,
                accumulatedMs: t.accumulatedMs + Math.max(0, Date.now() - Date.parse(t.startedAt)),
                paused: true
              }
            : t
        }
      }
    }
    case 'resumeDay': {
      const pause = state.data.dayPause
      if (!pause) return state
      const t = state.data.activeTimer
      const activeTimer =
        pause.pausedTimer && t ? { ...t, startedAt: new Date().toISOString(), paused: false } : t
      const cleared = { ...state.data, dayPause: null, activeTimer }

      const elapsed = pauseElapsed(pause)
      const day = getDay(state.data, pause.dateKey)
      if (elapsed === null || !day.schedule) return { ...state, data: cleared }

      const dayEnd = parseHM(state.data.settings.dayEnd)
      // free and break blocks absorb first, so a short pause during free time
      // costs the rest of the day nothing
      const shifted = shiftAfter(day.schedule, minutesOfISO(pause.pausedAt), elapsed)
      const { blocks, spilled } = spill(
        shifted.map((b) => (b.kind === 'activity' ? { ...b, overflow: blockEnd(b) > dayEnd } : b)),
        dayEnd,
        { minChunk: PLAN_DEFAULTS.minChunkMinutes }
      )
      const backlog = bankSpilled(spilled, cleared.backlog, {
        priorityOf: (id) => cleared.activities.find((a) => a.id === id)?.priority ?? 2,
        projectIdOf: (id) => cleared.activities.find((a) => a.id === id)?.projectId ?? null
      })

      const next = withDay({ ...cleared, backlog }, pause.dateKey, (d) => ({
        ...d,
        schedule: blocks
      }))
      // inline rather than a second dispatch, following addBacklogTask
      return { ...state, data: replan(next, pause.dateKey) }
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
    case 'externalEntityCreated': {
      const { event } = action
      switch (event.kind) {
        case 'backlogTask':
          return {
            ...state,
            data: { ...state.data, backlog: [...state.data.backlog, event.task] }
          }
        case 'activity':
          return {
            ...state,
            data: { ...state.data, activities: [...state.data.activities, event.activity] }
          }
        case 'project':
          return {
            ...state,
            data: { ...state.data, projects: [...state.data.projects, event.project] }
          }
      }
    }
  }
}

interface DataContextValue {
  state: State
  dispatch: Dispatch<Action>
  today: DayData
  activities: Activity[]
  recurringTasks: RecurringTask[]
  routines: Routine[]
  backlog: BacklogTask[]
  projects: Project[]
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

  // MCP-originated creates — absorbed as a pure append so an external
  // Claude session's write survives the renderer's next `saveData`, whether
  // it lands before or after this window has hydrated
  useEffect(() => {
    return window.api.onMcpEntityCreated((event) =>
      dispatch({ type: 'externalEntityCreated', event })
    )
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
      routines: state.data.routines,
      backlog: state.data.backlog,
      projects: state.data.projects,
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
