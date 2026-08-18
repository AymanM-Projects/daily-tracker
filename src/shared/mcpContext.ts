import type {
  Activity,
  ActivityMode,
  AppData,
  BacklogTask,
  DateKey,
  JournalEntry,
  Project,
  RecurringTask,
  Routine
} from './types'
import { shiftDateKey } from './time'

/** A journal entry with the day it belongs to attached — `JournalEntry` itself is stored per-day. */
export interface JournalEntryView extends JournalEntry {
  date: DateKey
}

const DEFAULT_CONTEXT_DAYS = 7

/** Entries across every day in `[from, to]`, inclusive on both ends, oldest first. */
export function listJournalEntries(data: AppData, from: DateKey, to: DateKey): JournalEntryView[] {
  const entries: JournalEntryView[] = []
  for (const [date, day] of Object.entries(data.days)) {
    if (date < from || date > to) continue
    for (const entry of day.journal) entries.push({ ...entry, date })
  }
  return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export interface ListBacklogTasksOptions {
  /** Include already-completed tasks. Defaults to false. */
  includeDone?: boolean
  /** Only tasks linked to this project id, or `null` for unlinked tasks. Omit for no filter. */
  projectId?: string | null
}

export function listBacklogTasks(
  data: AppData,
  options: ListBacklogTasksOptions = {}
): BacklogTask[] {
  return data.backlog.filter((task) => {
    if (!options.includeDone && task.done) return false
    if (options.projectId !== undefined && task.projectId !== options.projectId) return false
    return true
  })
}

export interface ListProjectsOptions {
  /** Include archived projects. Defaults to false. */
  includeArchived?: boolean
}

export function listProjects(data: AppData, options: ListProjectsOptions = {}): Project[] {
  return data.projects.filter((p) => options.includeArchived || !p.archived)
}

export interface ListActivitiesOptions {
  mode?: ActivityMode
  /** Only activities linked to this project id, or `null` for unlinked activities. Omit for no filter. */
  projectId?: string | null
}

export function listActivities(data: AppData, options: ListActivitiesOptions = {}): Activity[] {
  return data.activities.filter((a) => {
    if (options.mode !== undefined && a.mode !== options.mode) return false
    if (options.projectId !== undefined && a.projectId !== options.projectId) return false
    return true
  })
}

export interface ContextBundleOptions {
  /** How many days back, inclusive of `today`, the journal window covers. Defaults to 7. */
  days?: number
  /** Include already-completed backlog tasks. Defaults to false. */
  includeCompleted?: boolean
}

export interface ContextBundle {
  journal: JournalEntryView[]
  backlogTasks: BacklogTask[]
  projects: Project[]
  activities: Activity[]
  routines: Routine[]
  recurringTasks: RecurringTask[]
}

/**
 * The primary "what should I work on" entry point for an external Claude
 * session: recent journal entries, open backlog tasks, active projects,
 * activities, and standing routines/recurring tasks as light context.
 *
 * Deliberately excludes internal state — `activeTimer`, `dayPause`,
 * `settings`, `prayer`, and raw `ScheduleBlock` geometry are none of an
 * external assistant's business and would just be noise it has to filter back
 * out itself. `today` is passed in rather than read from a clock, the same
 * seam `effectivePriority` and `generateSchedule` already use, so this stays
 * testable without one.
 */
export function getContextBundle(
  data: AppData,
  today: DateKey,
  options: ContextBundleOptions = {}
): ContextBundle {
  const span = options.days ?? DEFAULT_CONTEXT_DAYS
  const from = shiftDateKey(today, -(span - 1))
  return {
    journal: listJournalEntries(data, from, today),
    backlogTasks: listBacklogTasks(data, { includeDone: options.includeCompleted ?? false }),
    projects: listProjects(data),
    activities: listActivities(data),
    // only rules currently in effect are "standing" context — a disabled one
    // is not something the assistant should factor into what to suggest
    routines: data.routines.filter((r) => r.active),
    recurringTasks: data.recurringTasks.filter((r) => r.active)
  }
}
