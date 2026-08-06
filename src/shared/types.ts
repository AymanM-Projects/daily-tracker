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
}

export interface JournalEntry {
  id: string
  kind: 'auto' | 'manual'
  text: string
  timestamp: string // ISO
  checklistItemId?: string // only on kind 'auto' — links to the checklist item
}

export type ScheduleLane = 'focus' | 'parallel'

export interface ScheduleBlock {
  id: string
  kind: 'activity' | 'break'
  lane: ScheduleLane
  activityId: string | null // null for breaks
  name: string // snapshot of activity name at generation time
  start: string // 'HH:mm'
  end: string // 'HH:mm'
  overflow: boolean // true if the block runs past settings.dayEnd
}

export interface Settings {
  dayStart: string // 'HH:mm'
  dayEnd: string // 'HH:mm'
  breaksEnabled: boolean
  breakMinutes: number
  alwaysOnTop: boolean
}

export interface DayData {
  checklist: ChecklistItem[]
  journal: JournalEntry[]
  schedule: ScheduleBlock[] | null // null = never generated for this day
  unscheduled: string[] | null // activity names that didn't fit
  activitySetId: string | null // which set generated this day's schedule
}

export interface AppData {
  version: 2
  projects: Project[]
  activitySets: ActivitySet[]
  activities: Activity[]
  /** Fallback day window, used when no activity set is active. Kept for compatibility. */
  settings: Settings
  days: Record<DateKey, DayData>
}
