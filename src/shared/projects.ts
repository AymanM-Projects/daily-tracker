import type { Activity, BacklogTask, DateKey, DayData, Project } from './types'
import { daysUntil, shiftDateKey } from './time'

export interface ProjectProgress {
  daysUntilDeadline: number | null
  tasksDone: number
  tasksTotal: number
  minutesLoggedThisWeek: number
  targetMinutesPerWeek: number | null
}

/** How many days the rolling "this week" window covers, ending on `today`. */
const ROLLING_WINDOW_DAYS = 7

/**
 * A project's status at a glance: how close its deadline is, how much of its
 * linked backlog is done, and how much time has actually been logged against it
 * recently.
 *
 * Nothing here is stored — like `effectivePriority`, it is derived fresh from
 * `today` on every read, so a project's standing shifts on its own as the
 * deadline approaches or new work is logged against it.
 *
 * "This week" is a rolling 7-day window ending on `today`, not a calendar week —
 * the app has no notion of "week starts on X" anywhere else, and inventing one
 * just for this would be scope the user didn't ask for.
 */
export function projectProgress(
  project: Project,
  activities: Activity[],
  backlog: BacklogTask[],
  days: Record<DateKey, DayData>,
  today: DateKey
): ProjectProgress {
  const daysUntilDeadline = project.deadline === null ? null : daysUntil(today, project.deadline)

  const tasks = backlog.filter((t) => t.projectId === project.id)
  const tasksDone = tasks.filter((t) => t.done).length
  const tasksTotal = tasks.length

  // resolved once per call rather than per block, so a day with many blocks
  // doesn't re-scan the whole activity/backlog list for each one
  const activityIds = new Set(activities.filter((a) => a.projectId === project.id).map((a) => a.id))
  const taskIds = new Set(tasks.map((t) => t.id))

  let minutesLoggedThisWeek = 0
  for (let offset = 0; offset < ROLLING_WINDOW_DAYS; offset++) {
    const date = shiftDateKey(today, -offset)
    for (const block of days[date]?.schedule ?? []) {
      if (block.actualMinutes === null) continue
      const belongsToProject =
        (block.activityId !== null && activityIds.has(block.activityId)) ||
        (block.backlogTaskId !== null && taskIds.has(block.backlogTaskId))
      if (belongsToProject) minutesLoggedThisWeek += block.actualMinutes
    }
  }

  return {
    daysUntilDeadline,
    tasksDone,
    tasksTotal,
    minutesLoggedThisWeek,
    targetMinutesPerWeek:
      project.targetHoursPerWeek === null ? null : project.targetHoursPerWeek * 60
  }
}
