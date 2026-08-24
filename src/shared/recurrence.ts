import type { BacklogTask, DateKey, RecurringTask } from './types'
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

export interface RecurringResolution {
  rule: RecurringTask
  /** The still-open task this rule already created, if one exists. */
  existing: BacklogTask | null
}

/**
 * What each pending rule needs: a fresh `BacklogTask` when nothing is
 * outstanding, or — if an earlier undone instance of the same rule is still
 * sitting in the backlog — that instance, so the caller can bring it forward
 * to today instead of minting a duplicate.
 */
export function resolveRecurring(
  rules: RecurringTask[],
  backlog: BacklogTask[],
  date: DateKey,
  applied: string[]
): RecurringResolution[] {
  return pendingRules(rules, date, applied).map((rule) => ({
    rule,
    existing: backlog.find((t) => t.recurringTaskId === rule.id && !t.done) ?? null
  }))
}

/**
 * The rule a one-off task turns into when marked recurring inline. Daily,
 * because the checklist toggle has no UI for picking weekly/monthly — the
 * Repeating sheet can fine-tune it afterward since it's the same record.
 */
export function ruleFromTask(
  task: Pick<BacklogTask, 'text' | 'estimateMinutes'>
): Omit<RecurringTask, 'id' | 'createdAt'> {
  return {
    text: task.text,
    estimateMinutes: task.estimateMinutes,
    freq: 'daily',
    weekdays: [],
    dayOfMonth: 1,
    active: true
  }
}
