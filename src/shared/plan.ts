import type { BacklogTask, DateKey, ScheduleBlock, Settings } from './types'
import type { Anchor } from './schedule'
import { blockMinutes, blockSpan, freeIntervals, type Interval } from './blocks'
import { formatHM, parseHM, shiftDateKey } from './time'

export const PLAN_DEFAULTS = {
  horizonDays: 14,
  /** a ten-minute sliver of an essay is useless, so work is never split below this */
  minChunkMinutes: 30
}

export interface PlanInput {
  backlog: BacklogTask[]
  /** what already occupies each day — inputs only, never rewritten */
  days: Record<DateKey, ScheduleBlock[]>
  /** resolved by the caller, so this module stays free of any notion of prayer */
  anchorsByDate: Record<DateKey, Anchor[]>
  settings: Settings
  fromDate: DateKey
  /** today is only free from now onward; earlier hours are already spent */
  fromMinute: number
  horizonDays?: number
  minChunkMinutes?: number
}

export interface PlanResult {
  /** blocks to ADD, keyed by day. Existing blocks are never included. */
  placements: Record<DateKey, ScheduleBlock[]>
  /** tasks with work that did not fit inside the horizon */
  unplaced: string[]
}

/**
 * Priority outranks the deadline: an urgent task with no due date should still
 * beat a low-priority one due next week.
 */
function sortForPlanning(tasks: BacklogTask[]): BacklogTask[] {
  return [...tasks].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
      a.createdAt.localeCompare(b.createdAt)
  )
}

/**
 * Distributes unfinished backlog work into whatever free time exists over the
 * coming days.
 *
 * Only ever writes into gaps — every existing block is an input, never an
 * output. That is what lets this run automatically on each add without breaking
 * the rule that nothing silently rewrites a day you are already inside.
 *
 * Re-running is a no-op: a task's remaining work is its estimate minus what is
 * already placed for it, so a second pass finds nothing left to do.
 */
export function planBacklog(input: PlanInput): PlanResult {
  const horizonDays = input.horizonDays ?? PLAN_DEFAULTS.horizonDays
  const minChunk = input.minChunkMinutes ?? PLAN_DEFAULTS.minChunkMinutes
  const windowStart = parseHM(input.settings.dayStart)
  const windowEnd = parseHM(input.settings.dayEnd)

  // minutes already committed per task, across every day we know about
  const placedByTask = new Map<string, number>()
  for (const blocks of Object.values(input.days)) {
    for (const b of blocks) {
      // a skipped block bought no time. Counting it would silently shrink the
      // task's remaining work, and the task would never be re-placed — skipping
      // something would quietly delete it instead of deferring it.
      if (!b.backlogTaskId || b.status === 'skipped') continue
      placedByTask.set(b.backlogTaskId, (placedByTask.get(b.backlogTaskId) ?? 0) + blockMinutes(b))
    }
  }

  // tasks with no estimate are never placed — the app would be guessing at how
  // much of your day to spend, which is worse than leaving them on the list
  const pending = sortForPlanning(
    input.backlog.filter((t) => !t.done && t.estimateMinutes !== null && t.estimateMinutes > 0)
  ).map((task) => ({
    task,
    remaining: Math.max(0, (task.estimateMinutes ?? 0) - (placedByTask.get(task.id) ?? 0))
  }))

  const placements: Record<DateKey, ScheduleBlock[]> = {}
  const gaps = new Map<DateKey, Interval[]>()

  for (let offset = 0; offset < horizonDays; offset++) {
    const date = shiftDateKey(input.fromDate, offset)
    const existing = input.days[date] ?? []
    const taken: Interval[] = [
      ...existing
        // work is placed into the focus lane, so a 3D print running all day in
        // the parallel lane must not make the whole day look occupied
        .filter((b) => b.lane === 'focus')
        // blockSpan unwraps a block that runs past midnight; reading the stored
        // end raw yields an inverted interval that freeIntervals discards, and
        // the planner would schedule straight over it
        .map(blockSpan),
      ...(input.anchorsByDate[date] ?? [])
    ]
    const start = offset === 0 ? Math.max(windowStart, input.fromMinute) : windowStart
    gaps.set(date, freeIntervals(taken, start, windowEnd))
  }

  for (const entry of pending) {
    if (entry.remaining <= 0) continue
    const parts: { date: DateKey; start: number; length: number }[] = []

    for (let offset = 0; offset < horizonDays && entry.remaining > 0; offset++) {
      const date = shiftDateKey(input.fromDate, offset)
      // never scheduled past its own deadline
      if (entry.task.dueDate !== null && date > entry.task.dueDate) break

      const dayGaps = gaps.get(date) ?? []
      for (const gap of dayGaps) {
        if (entry.remaining <= 0) break
        const room = gap.end - gap.start
        if (room < Math.min(minChunk, entry.remaining)) continue

        const length = Math.min(room, entry.remaining)
        parts.push({ date, start: gap.start, length })
        entry.remaining -= length
        gap.start += length
      }
      gaps.set(
        date,
        dayGaps.filter((g) => g.end > g.start)
      )
    }

    // a task already partly placed counts as one earlier piece, so the numbering
    // a user sees stays honest across repeated runs
    const priorParts = (placedByTask.get(entry.task.id) ?? 0) > 0 ? 1 : 0
    const totalParts = parts.length + priorParts

    parts.forEach((part, index) => {
      const name =
        totalParts > 1
          ? `${entry.task.text} (${index + 1 + priorParts} of ${totalParts})`
          : entry.task.text
      const block: ScheduleBlock = {
        id: crypto.randomUUID(),
        kind: 'activity',
        lane: 'focus',
        activityId: null,
        backlogTaskId: entry.task.id,
        name,
        start: formatHM(part.start),
        end: formatHM(part.start + part.length),
        overflow: false,
        status: 'planned',
        actualMinutes: null,
        manual: false,
        promptedAt: null,
        plannedMinutes: null
      }
      placements[part.date] = [...(placements[part.date] ?? []), block]
    })
  }

  return {
    placements,
    unplaced: pending.filter((e) => e.remaining > 0).map((e) => e.task.text)
  }
}
