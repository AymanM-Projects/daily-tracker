import type { BacklogTask, DateKey, ScheduleBlock, Settings } from './types'
import type { Anchor } from './schedule'
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

interface Interval {
  start: number
  end: number
}

/** Free stretches of a day: the window, minus everything already occupying it. */
function freeIntervals(taken: Interval[], windowStart: number, windowEnd: number): Interval[] {
  if (windowEnd <= windowStart) return []
  const sorted = [...taken].sort((a, b) => a.start - b.start)
  const free: Interval[] = []
  let cursor = windowStart

  for (const t of sorted) {
    if (t.end <= cursor) continue
    if (t.start > cursor) free.push({ start: cursor, end: Math.min(t.start, windowEnd) })
    cursor = Math.max(cursor, t.end)
    if (cursor >= windowEnd) break
  }
  if (cursor < windowEnd) free.push({ start: cursor, end: windowEnd })

  return free.filter((f) => f.end > f.start)
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

function blockMinutes(block: ScheduleBlock): number {
  const start = parseHM(block.start)
  let end = parseHM(block.end)
  if (end <= start) end += 1440 // wrapped past midnight
  return end - start
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
      if (!b.backlogTaskId) continue
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
      ...existing.map((b) => ({ start: parseHM(b.start), end: parseHM(b.end) })),
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
        actualMinutes: null
      }
      placements[part.date] = [...(placements[part.date] ?? []), block]
    })
  }

  return {
    placements,
    unplaced: pending.filter((e) => e.remaining > 0).map((e) => e.task.text)
  }
}
