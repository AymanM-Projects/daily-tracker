import type { DateKey, RecurringTask } from './types'
import { daysInMonth, weekdayOf } from './time'

/**
 * Whether a rule comes due on a given day.
 *
 * Deliberately answers only "is it due on this date" — it has no notion of when
 * the rule last fired. Missed occurrences are never recovered, so a rule the
 * user didn't see on Sunday leaves no trace in the record.
 */
export function dueOn(rule: RecurringTask, date: DateKey): boolean {
  if (!rule.active) return false

  switch (rule.freq) {
    case 'daily':
      return true
    case 'weekly':
      return rule.weekdays.includes(weekdayOf(date))
    case 'monthly': {
      const day = Number(date.split('-')[2])
      const last = daysInMonth(date)
      // A rule set to the 31st has to land on the 28th in February, or it would
      // silently skip four months a year. Clamp to the last day of short months.
      return day === Math.min(rule.dayOfMonth, last)
    }
  }
}

/** Rules due on `date` that this day has not already had applied. */
export function pendingRules(
  rules: RecurringTask[],
  date: DateKey,
  applied: string[]
): RecurringTask[] {
  const seen = new Set(applied)
  return rules.filter((rule) => !seen.has(rule.id) && dueOn(rule, date))
}
