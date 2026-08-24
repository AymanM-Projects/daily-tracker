import type { BacklogTask, DateKey, DayData, Priority, ScheduleBlock } from './types'
import { blockMinutes } from './blocks'

/** The minimum worth carrying. Below this the leftover is noise, not a task. */
export const MIN_CARRY_MINUTES = 5

/**
 * A task the sweep wants created. Ids and timestamps are minted by the caller so
 * this module stays pure — the same seam the rest of shared/ uses.
 */
export interface CarriedWork {
  text: string
  estimateMinutes: number
  priority: Priority
  dueDate: DateKey | null
  /** the block this came from, so a day can never harvest the same block twice */
  sourceBlockId: string
}

/** Strips a trailing "(Part 2 of 3)" so re-carrying doesn't stack suffixes. */
function baseName(name: string): string {
  return name.replace(/\s*\(Part \d+(?: of \d+)?\)\s*$/, '').trim()
}

/**
 * How many minutes of a block never happened.
 *
 * 'planned' means nobody ever touched it, so all of it is outstanding.
 * 'partial' means it was worked but not finished — `actualMinutes` is what
 * actually got done, and the rest is still owed. 'done' and 'skipped' are both
 * decisions the user made and owe nothing: skipping is deferring by hand, and
 * re-carrying it would override that.
 */
function outstandingMinutes(block: ScheduleBlock): number {
  if (block.status === 'planned') return blockMinutes(block)
  if (block.status !== 'partial') return 0
  const planned = block.plannedMinutes ?? blockMinutes(block)
  return Math.max(0, planned - (block.actualMinutes ?? 0))
}

/**
 * Work a past day left on the table.
 *
 * Only reports; it never touches the day it read. The original blocks keep their
 * shape as history — a day that has happened is a record, and rewriting it to
 * make the numbers tidy would be inventing a past the user never saw. What comes
 * back is new backlog work, which `planBacklog` then places into the free time
 * of the days ahead.
 *
 * Blocks carrying a `backlogTaskId` are deliberately skipped: that task is still
 * on the backlog and the planner already derives its remaining minutes as
 * estimate-minus-placed. Minting more work for it would double-count the same
 * hours. Only generated activity blocks, which have no standing task behind
 * them, need a task minted here.
 */
export function carryForward(day: DayData, date: DateKey, today: DateKey): CarriedWork[] {
  if (day.carriedForward || day.schedule === null || date >= today) return []

  return day.schedule
    .filter((b) => b.kind === 'activity' && b.activityId !== null && b.backlogTaskId === null)
    .map((block) => ({ block, minutes: outstandingMinutes(block) }))
    .filter(({ minutes }) => minutes >= MIN_CARRY_MINUTES)
    .map(({ block, minutes }) => ({
      text: baseName(block.name),
      estimateMinutes: minutes,
      // Carried work has no deadline of its own. The activity it came from may
      // have one, but that date is resolved against the activity — inventing a
      // due date here would make missing a day silently harden into urgency.
      priority: 2 as Priority,
      dueDate: null,
      sourceBlockId: block.id
    }))
}

/**
 * Every day older than `today` that has not been swept yet, oldest first.
 *
 * Ordered so that a run of missed days carries in the order they happened, which
 * is the order the resulting tasks should be worked.
 */
export function daysToSweep(days: Record<DateKey, DayData>, today: DateKey): DateKey[] {
  return Object.keys(days)
    .filter((date) => date < today && days[date].schedule !== null && !days[date].carriedForward)
    .sort()
}

/** True when a task already exists for this block — the idempotency backstop. */
export function alreadyCarried(backlog: BacklogTask[], sourceBlockId: string): boolean {
  return backlog.some((t) => t.carriedFromBlockId === sourceBlockId)
}

/**
 * An already-open task this carried work should fold into, rather than mint a
 * sibling copy of the same missed activity. A daily activity left unfinished for
 * three days running used to leave three near-identical "Quran activity" entries
 * on the backlog; this makes it one entry whose estimate grows instead.
 *
 * Only matches undone tasks — a task marked done is a decision already made, not
 * something to reopen by piling more minutes onto it.
 */
export function carryTarget(backlog: BacklogTask[], work: CarriedWork): BacklogTask | null {
  const key = baseName(work.text).toLowerCase()
  return backlog.find((t) => !t.done && baseName(t.text).toLowerCase() === key) ?? null
}
