export type DateKey = string // 'YYYY-MM-DD', local time

/** 1 = high, 2 = medium, 3 = low */
export type Priority = 1 | 2 | 3

/** 'background' activities run mostly unattended (AI coding, 3D prints) and fill the Parallel lane */
export type ActivityMode = 'focus' | 'background'

export interface Activity {
  id: string
  name: string
  durationMinutes: number
  priority: Priority
  mode: ActivityMode
  projectId: string | null // null = not tied to any project
  createdAt: string // ISO, sort tiebreaker
}

/** A long-horizon goal that activities can feed into (a competition, a build, an exam) */
export interface Project {
  id: string
  name: string
  deadline: DateKey | null
  targetHoursPerWeek: number | null
  archived: boolean
  createdAt: string // ISO
}

/**
 * A named group of activities that owns its own day window, so a weekday
 * afternoon and a weekend morning don't share one set of times.
 */
export interface ActivitySet {
  id: string
  name: string
  activityIds: string[]
  dayStart: string // 'HH:mm'
  dayEnd: string // 'HH:mm'
  breaksEnabled: boolean
  isDefault: boolean
  createdAt: string // ISO
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  createdAt: string // ISO
  completedAt: string | null // ISO, set when checked
  estimateMinutes: number | null // optional guess; null means "didn't say"
  /** where the item came from. 'schedule' is reserved for the block↔checklist link. */
  source: 'manual' | 'recurring' | 'schedule'
  recurringTaskId?: string // only on source 'recurring' — the rule that created it
  scheduleBlockId?: string // only on source 'schedule'
}

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly'

/**
 * A standing rule that drops a checklist item into a day when it comes due.
 * Rules only ever fill in today — a missed occurrence is simply missed, so the
 * journal never claims the user saw a task they never did.
 */
export interface RecurringTask {
  id: string
  text: string
  estimateMinutes: number | null
  freq: RecurrenceFreq
  weekdays: number[] // 'weekly' only, 0 = Sunday
  dayOfMonth: number // 'monthly' only, 1-31, clamped in short months
  active: boolean
  createdAt: string // ISO
}

export interface JournalEntry {
  id: string
  kind: 'auto' | 'manual'
  text: string
  timestamp: string // ISO
  checklistItemId?: string // only on kind 'auto' — links to the checklist item
  scheduleBlockId?: string // only on kind 'auto' — links to the schedule block
}

export type ScheduleLane = 'focus' | 'parallel'

/**
 * 'anchor' is a fixed-time obligation (a prayer) that activities route around.
 * 'free' is protected buffer time: the planner may never place work into it,
 * but it is the first place an overrun or an extension borrows minutes from.
 */
export type BlockKind = 'activity' | 'break' | 'anchor' | 'free'

/**
 * 'partial' means the slot was worked but the task isn't finished. It exists
 * because the alternative — recording an unfinished task as 'done' — would make
 * the auto-journal claim work was completed when it wasn't.
 */
export type BlockStatus = 'planned' | 'done' | 'skipped' | 'partial'

export interface ScheduleBlock {
  id: string
  kind: BlockKind
  lane: ScheduleLane
  activityId: string | null // null for breaks, anchors, free time and backlog work
  /** set when this block is placed work from the backlog rather than a generated activity */
  backlogTaskId: string | null
  name: string // snapshot of the name at generation time
  start: string // 'HH:mm'
  end: string // 'HH:mm'
  overflow: boolean // true if the block runs past settings.dayEnd
  status: BlockStatus
  actualMinutes: number | null // measured by the timer or typed in — never inferred
  /**
   * True when the user created or edited this block by hand. Regeneration is
   * handed these as anchors and flows around them, so pressing Regenerate never
   * silently discards a hand edit.
   */
  manual: boolean
  /**
   * ISO stamp of when the end-of-block prompt was answered or explicitly waived.
   * Deferring a prompt is held in memory and never written here — a dismissal
   * must never be readable as an answer.
   */
  promptedAt: string | null
  /**
   * The length this block was planned for, recorded only when a mutation moves
   * the geometry away from the plan (an early finish, an extension, a spill).
   * null means the geometry still IS the plan.
   */
  plannedMinutes: number | null
}

/**
 * The running timer. Only committed on start/pause/resume/stop/complete —
 * the ticking value is derived, never persisted (see shared/timer.ts).
 */
export interface ActiveTimer {
  dateKey: DateKey
  blockId: string
  startedAt: string // ISO, start of the current running segment
  accumulatedMs: number // banked from previous segments
  paused: boolean
}

/**
 * The day-wide freeze — "something came up". Mirrors ActiveTimer: at most one at
 * a time, carrying its own dateKey so the main process can find it without
 * knowing which day is active. It lives here rather than on DayData because a
 * pause is a live condition, not a property of the day's record.
 *
 * Only the start is stored. Resuming shifts the rest of the day by
 * (now - pausedAt) and clears the pause in one step, so nothing accumulates.
 */
export interface DayPause {
  dateKey: DateKey
  pausedAt: string // ISO
  /** true when pausing the day also paused a running block timer, so resume restores it */
  pausedTimer: boolean
}

export type PrayerName = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha'

/**
 * Where and how prayer times are computed. Angles live here rather than being
 * looked up from the method name at render time, so changing method is a plain
 * data edit and a custom angle stays possible.
 */
export interface PrayerSettings {
  enabled: boolean
  latitude: number
  longitude: number
  /** key into PRAYER_METHODS, kept for the UI to show which preset is active */
  method: string
  fajrAngle: number
  /** null when the method uses a fixed interval after Maghrib instead */
  ishaAngle: number | null
  ishaInterval: number | null // minutes after Maghrib
  /** 1 = Shafi'i/Maliki/Hanbali, 2 = Hanafi */
  asrFactor: number
  /** how long each prayer blocks out of the focus lane */
  blockMinutes: number
  /** prayers the user wants blocked; others are computed but not scheduled */
  include: PrayerName[]
}

export interface Settings {
  dayStart: string // 'HH:mm'
  dayEnd: string // 'HH:mm'
  breaksEnabled: boolean
  breakMinutes: number
  alwaysOnTop: boolean
  /**
   * Protected free time. Deliberately distinct from breaks: a break is a short
   * gap BETWEEN two activities, a free buffer is a longer protected block after
   * a given amount of accumulated focus work. It also mops up whatever is left
   * at the end of the day, so leftover time is visible rather than implied — and
   * therefore safe from the backlog planner, which fills anything it can see.
   */
  freeBufferEnabled: boolean
  freeBufferMinutes: number // length of each inserted buffer
  freeBufferEveryMinutes: number // insert one after this much focus work
}

export interface DayData {
  checklist: ChecklistItem[]
  journal: JournalEntry[]
  schedule: ScheduleBlock[] | null // null = never generated for this day
  unscheduled: string[] | null // activity names that didn't fit
  activitySetId: string | null // which set generated this day's schedule
  /**
   * Recurring rule ids already applied to this day. Per-day rather than a global
   * "last run" marker so that deleting a generated task doesn't resurrect it on
   * the next launch — saying "not today" has to stick.
   */
  recurringApplied: string[]
}

/**
 * What the renderer is allowed to know about the stored API key. The key itself
 * never crosses the IPC boundary — only whether one exists and its last 4 chars.
 */
export interface AiStatus {
  configured: boolean
  source: 'keychain' | 'env' | 'none'
  hint: string | null
  encryptionAvailable: boolean
}

export type AiTestResult = { ok: true; data: { model: string } } | { ok: false; error: string }

/** A single pending completion notification, owned by the main process. */
export interface TimerAlarm {
  at: number // epoch ms
  title: string
  body: string
}

/** One schedule block, flattened for the menu bar popover. */
export interface WidgetBlock {
  id: string
  name: string
  lane: ScheduleLane
  /** anchors flow through too — during Maghrib, "now" should say Maghrib */
  kind: BlockKind
  start: string // 'HH:mm'
  end: string // 'HH:mm'
  /** whole minutes until this block ends (if running) or starts (if upcoming) */
  minutesAway: number
  /** 0..1 through the block; 0 for anything not yet started */
  progress: number
  overflow: boolean
}

/**
 * Everything the menu bar popover renders, derived in the main process so the
 * widget keeps working while the app window is closed. Rebuilt on every tick —
 * it is a snapshot, never stored.
 */
export interface WidgetSummary {
  /** bumped each time the popover is shown, so the renderer can replay its entry animation */
  revision: number
  clock: string // 'h:mm', 12-hour
  meridiem: string // 'AM' | 'PM'
  dateLabel: string
  /** false when today has no generated schedule at all */
  hasSchedule: boolean
  /** in progress right now — up to one per lane, since the two lanes overlap by design */
  now: WidgetBlock[]
  next: WidgetBlock | null
  /** true when a schedule exists but everything in it is behind us */
  dayComplete: boolean
  timer: { blockId: string; name: string; display: string; paused: boolean } | null
  checklist: { done: number; total: number }
}

/**
 * A standing task with no fixed day. Placed into free time by the planner
 * rather than owned by a date — this is the "forever list" the checklist becomes.
 * Declared here in v5 but not populated until the backlog phase.
 */
export interface BacklogTask {
  id: string
  text: string
  priority: Priority
  estimateMinutes: number | null
  dueDate: DateKey | null // null = no deadline, do it whenever there's room
  done: boolean
  completedAt: string | null
  createdAt: string
  recurringTaskId?: string
}

export interface AppData {
  version: 7
  activeTimer: ActiveTimer | null
  dayPause: DayPause | null
  projects: Project[]
  activitySets: ActivitySet[]
  activities: Activity[]
  recurringTasks: RecurringTask[]
  backlog: BacklogTask[]
  prayer: PrayerSettings
  /** Fallback day window, used when no activity set is active. Kept for compatibility. */
  settings: Settings
  days: Record<DateKey, DayData>
}
