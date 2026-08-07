import type { DateKey, Priority } from './types'
import { daysUntil } from './time'

/**
 * Anything carrying either a hand-set priority or a deadline. Structural rather
 * than a union of Activity | BacklogTask so this module never has to know which
 * of the two it is looking at.
 */
export interface Prioritised {
  priority: Priority
  dueDate: DateKey | null
}

/** Due today or already past. */
export const URGENT_DAYS = 1
/** Close enough that it should outrank undated work, but not yet urgent. */
export const SOON_DAYS = 4

/**
 * Urgency ladder: how important a deadline makes something, on the day you ask.
 *
 * A plain distance-to-deadline ladder rather than anything that reasons about
 * how much work is left. Estimates are optional and frequently wrong, and a
 * priority the user cannot predict is worse than one that is merely coarse —
 * "it goes High the day before it is due" is a rule you can hold in your head.
 */
export function derivePriority(dueDate: DateKey, today: DateKey): Priority {
  const days = daysUntil(today, dueDate)
  if (days <= URGENT_DAYS) return 1
  if (days <= SOON_DAYS) return 2
  return 3
}

/**
 * The priority that actually governs scheduling.
 *
 * A deadline OVERRIDES the manual priority — setting one is the user saying
 * "work out the urgency for me", so leaving the old manual value in charge would
 * make the deadline decorative. Nothing is written back: this is derived on
 * every read, which is what lets a task escalate as its date approaches without
 * anything having to rewrite the document.
 */
export function effectivePriority(item: Prioritised, today: DateKey): Priority {
  return item.dueDate === null ? item.priority : derivePriority(item.dueDate, today)
}

/** 'High' | 'Medium' | 'Low' — the label the panes already use for these levels. */
export function priorityLabel(priority: Priority): string {
  return priority === 1 ? 'High' : priority === 2 ? 'Medium' : 'Low'
}
