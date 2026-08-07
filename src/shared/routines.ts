import type { DateKey, Routine } from './types'
import type { Anchor } from './schedule'
import { parseHM, weekdayOf } from './time'

/** Whether a routine applies on a given day. An empty weekday list means every day. */
export function appliesOn(routine: Routine, date: DateKey): boolean {
  if (!routine.active) return false
  return routine.weekdays.length === 0 || routine.weekdays.includes(weekdayOf(date))
}

/**
 * The routines that apply on `date`, as plain anchors.
 *
 * Mirrors how prayer times reach the generator: resolved by the caller into
 * `{name, start, end}` data, so `schedule.ts` never learns that lunch is a
 * different sort of thing from Maghrib. Sorted by start because the generator
 * expects anchors in order.
 *
 * A zero- or negative-length routine is dropped rather than emitted — an anchor
 * that occupies no time would still cost a break at that boundary and show up
 * as an unclickable sliver on the timeline.
 */
export function routineAnchors(routines: Routine[], date: DateKey): Anchor[] {
  return routines
    .filter((r) => appliesOn(r, date) && r.durationMinutes > 0)
    .map((r) => {
      const start = parseHM(r.start)
      return { name: r.name, start, end: start + r.durationMinutes, source: 'routine' as const }
    })
    .sort((a, b) => a.start - b.start)
}
