import type { ScheduleBlock, ScheduleLane } from './types'
import { formatHM, parseHM } from './time'

/** A half-open span of minutes since midnight. */
export interface Interval {
  start: number
  end: number
}

/** Mints ids. Injectable so the reschedule tests can assert on identity. */
export type IdFactory = () => string

const uuid: IdFactory = () => crypto.randomUUID()

/**
 * A block's span in minutes since midnight, with a past-midnight end unwrapped
 * forward.
 *
 * Overflow blocks can be generated past midnight, where `formatHM` has wrapped
 * the stored end below the start. Reading `parseHM(end)` raw produces an
 * inverted interval that every sweep in this codebase silently discards, so a
 * 23:00–00:30 block becomes invisible and gets scheduled straight over. This is
 * the single definition of the unwrap; nothing should re-derive it.
 */
export function blockSpan(block: ScheduleBlock): Interval & { minutes: number } {
  const start = parseHM(block.start)
  const end = parseHM(block.end)
  const unwrapped = end <= start ? end + 1440 : end
  return { start, end: unwrapped, minutes: unwrapped - start }
}

export function blockMinutes(block: ScheduleBlock): number {
  return blockSpan(block).minutes
}

/** Minutes since midnight for a block's end, unwrapped past midnight. */
export function blockEnd(block: ScheduleBlock): number {
  return blockSpan(block).end
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Free stretches of a window: the window, minus everything already occupying it.
 * Moved here from plan.ts so the generator can use it to materialise end-of-day
 * leftover without importing the planner.
 */
export function freeIntervals(
  taken: Interval[],
  windowStart: number,
  windowEnd: number
): Interval[] {
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
 * The canonical order every schedule mutation returns: chronological, focus lane
 * before parallel at the same minute, then by id so the sort is total and
 * results are directly comparable in tests.
 */
export function byStart(a: ScheduleBlock, b: ScheduleBlock): number {
  return (
    blockSpan(a).start - blockSpan(b).start ||
    (a.lane === b.lane ? 0 : a.lane === 'focus' ? -1 : 1) ||
    a.id.localeCompare(b.id)
  )
}

/**
 * Blocks that never move under any reschedule. Anchors are fixed obligations
 * regenerated from prayer settings — moving one would be a lie about when
 * Maghrib is. Settled blocks are history.
 */
export function isImmovable(block: ScheduleBlock): boolean {
  return block.kind === 'anchor' || block.status === 'done' || block.status === 'partial'
}

/**
 * A skipped block records a decision, not work. It never moves — but unlike a
 * settled block it also never acts as a barrier, because nothing happened in it.
 */
export function isTransparent(block: ScheduleBlock): boolean {
  return block.status === 'skipped'
}

/** Kinds a shift may shorten to pay for itself before pushing real work later. */
export function isConsumable(block: ScheduleBlock): boolean {
  return (block.kind === 'free' || block.kind === 'break') && block.status === 'planned'
}

export function makeFreeBlock(
  lane: ScheduleLane,
  start: number,
  end: number,
  options: { makeId?: IdFactory; manual?: boolean } = {}
): ScheduleBlock {
  return {
    id: (options.makeId ?? uuid)(),
    kind: 'free',
    lane,
    activityId: null,
    backlogTaskId: null,
    anchorSource: null,
    name: 'Free',
    start: formatHM(start),
    end: formatHM(end),
    overflow: false,
    status: 'planned',
    actualMinutes: null,
    manual: options.manual ?? false,
    promptedAt: null,
    plannedMinutes: null
  }
}

/**
 * Merges free blocks that touch or overlap within a lane. Without this, repeated
 * pause/extend/truncate cycles accumulate one-minute slivers that are impossible
 * to tap and meaningless to look at.
 */
export function coalesceFree(blocks: ScheduleBlock[]): ScheduleBlock[] {
  const free = blocks.filter((b) => b.kind === 'free')
  if (free.length < 2) return [...blocks].sort(byStart)

  const merged: ScheduleBlock[] = blocks.filter((b) => b.kind !== 'free')

  for (const lane of ['focus', 'parallel'] as ScheduleLane[]) {
    const laneFree = free.filter((b) => b.lane === lane).sort(byStart)
    let run: { block: ScheduleBlock; end: number } | null = null

    for (const block of laneFree) {
      const span = blockSpan(block)
      if (run !== null && span.start <= run.end) {
        run.end = Math.max(run.end, span.end)
        continue
      }
      if (run !== null) merged.push({ ...run.block, end: formatHM(run.end) })
      run = { block, end: span.end }
    }
    if (run !== null) merged.push({ ...run.block, end: formatHM(run.end) })
  }

  return merged.sort(byStart)
}
