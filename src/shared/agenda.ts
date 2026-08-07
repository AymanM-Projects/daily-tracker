import type { ScheduleBlock } from './types'
import { blockSpan, byStart } from './blocks'
import { formatClock, formatMinutes } from './time'

/**
 * What the day does next, and what is happening now.
 *
 * Read by BOTH the main process (which arms the OS notification) and the
 * renderer (which runs the timer). They must never disagree about which block
 * is current — a notification announcing one task while the timer counts
 * another is worse than either alone — so the answer is computed once, here,
 * from the schedule and a minute.
 *
 * Pure and clock-free: `nowMin` is minutes since midnight, passed in.
 */

export type TransitionKind = 'start' | 'end'

export interface Transition {
  kind: TransitionKind
  block: ScheduleBlock
  /** minutes since midnight, may exceed 1440 for a block running past midnight */
  atMinute: number
  title: string
  body: string
}

/**
 * The block that should be running at `nowMin`.
 *
 * Focus wins over parallel: both lanes run concurrently by design, but only one
 * timer exists, and the focus lane is the one that is actually being attended.
 * Anchors and breaks are eligible — the user asked to be told about those too —
 * but a `free` block is not: protected rest is the absence of a task, and
 * counting it down would turn resting into something you can fall behind on.
 */
export function blockAt(schedule: ScheduleBlock[], nowMin: number): ScheduleBlock | null {
  const live = schedule
    .filter((b) => b.kind !== 'free')
    // a settled or skipped block is history even if the clock is still inside it
    .filter((b) => b.status === 'planned')
    .filter((b) => {
      const span = blockSpan(b)
      return span.start <= nowMin && nowMin < span.end
    })
    .sort(byStart)

  return live.find((b) => b.lane === 'focus') ?? live[0] ?? null
}

function startText(block: ScheduleBlock): { title: string; body: string } {
  const span = blockSpan(block)
  const length = formatMinutes(span.minutes)
  if (block.kind === 'break') {
    return { title: 'Break', body: `${length} until ${formatClock(block.end)}.` }
  }
  if (block.kind === 'anchor') {
    return { title: block.name, body: `Now, for ${length}.` }
  }
  return { title: block.name, body: `Starting now — ${length}, until ${formatClock(block.end)}.` }
}

function endText(block: ScheduleBlock): { title: string; body: string } {
  if (block.kind === 'break') return { title: 'Break over', body: 'Back to it.' }
  if (block.kind === 'anchor') return { title: `${block.name} done`, body: 'Back to it.' }
  return { title: `${block.name} — time's up`, body: 'Did you finish, or do you need longer?' }
}

/**
 * The next boundary strictly after `nowMin`, and what to say when it arrives.
 *
 * Only one is returned rather than a queue: the caller re-asks on every tick, so
 * re-arming a single alarm can never drift out of step with a day that was
 * edited underneath it.
 *
 * A block's own end is not announced when another block starts on the same
 * minute — back-to-back work would otherwise fire two notifications at once,
 * and the arriving task is the more useful of the two.
 */
export function nextTransition(schedule: ScheduleBlock[], nowMin: number): Transition | null {
  const events: Transition[] = []

  for (const block of schedule) {
    if (block.kind === 'free' || block.status !== 'planned') continue
    const span = blockSpan(block)

    if (span.start > nowMin) {
      events.push({ kind: 'start', block, atMinute: span.start, ...startText(block) })
    }
    if (span.end > nowMin) {
      events.push({ kind: 'end', block, atMinute: span.end, ...endText(block) })
    }
  }

  if (events.length === 0) return null

  const soonest = Math.min(...events.map((e) => e.atMinute))
  const atSoonest = events.filter((e) => e.atMinute === soonest)
  return atSoonest.find((e) => e.kind === 'start') ?? atSoonest[0]
}
