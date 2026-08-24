import { describe, expect, it } from 'vitest'
import type { BacklogTask, RecurringTask } from './types'
import { dueOn, pendingRules, resolveRecurring, ruleFromTask } from './recurrence'

function rule(over: Partial<RecurringTask> = {}): RecurringTask {
  return {
    id: 'r1',
    text: 'Take out the bins',
    estimateMinutes: 10,
    freq: 'daily',
    weekdays: [],
    dayOfMonth: 1,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over
  }
}

function task(over: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: 't1',
    text: 'Take out the bins',
    priority: 2,
    estimateMinutes: 10,
    dueDate: null,
    projectId: null,
    done: false,
    completedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

// 2026-08-06 is a Thursday (weekday 4); 2026-08-09 is a Sunday (0)
describe('dueOn', () => {
  it('fires a daily rule on any date', () => {
    expect(dueOn(rule(), '2026-08-06')).toBe(true)
    expect(dueOn(rule(), '2026-12-25')).toBe(true)
  })

  it('fires a weekly rule only on its weekdays', () => {
    const sundays = rule({ freq: 'weekly', weekdays: [0] })
    expect(dueOn(sundays, '2026-08-09')).toBe(true) // Sunday
    expect(dueOn(sundays, '2026-08-06')).toBe(false) // Thursday
  })

  it('supports several weekdays at once', () => {
    const mwf = rule({ freq: 'weekly', weekdays: [1, 3, 5] })
    expect(dueOn(mwf, '2026-08-05')).toBe(true) // Wednesday
    expect(dueOn(mwf, '2026-08-07')).toBe(true) // Friday
    expect(dueOn(mwf, '2026-08-06')).toBe(false) // Thursday
  })

  it('fires a monthly rule on its day only', () => {
    const fifteenth = rule({ freq: 'monthly', dayOfMonth: 15 })
    expect(dueOn(fifteenth, '2026-08-15')).toBe(true)
    expect(dueOn(fifteenth, '2026-08-14')).toBe(false)
    expect(dueOn(fifteenth, '2026-09-15')).toBe(true)
  })

  it('clamps a 31st rule to the last day of a short month', () => {
    const last = rule({ freq: 'monthly', dayOfMonth: 31 })
    expect(dueOn(last, '2026-02-28')).toBe(true) // February has 28 days in 2026
    expect(dueOn(last, '2026-02-27')).toBe(false)
    expect(dueOn(last, '2026-04-30')).toBe(true) // April has 30
    expect(dueOn(last, '2026-08-31')).toBe(true) // August has 31
    expect(dueOn(last, '2026-08-30')).toBe(false)
  })

  it('clamps to 29 February in a leap year', () => {
    const last = rule({ freq: 'monthly', dayOfMonth: 31 })
    expect(dueOn(last, '2028-02-29')).toBe(true)
    expect(dueOn(last, '2028-02-28')).toBe(false)
  })

  it('never fires a paused rule', () => {
    expect(dueOn(rule({ active: false }), '2026-08-06')).toBe(false)
    expect(dueOn(rule({ freq: 'weekly', weekdays: [4], active: false }), '2026-08-06')).toBe(false)
  })

  it('never fires a weekly rule with no days picked', () => {
    expect(dueOn(rule({ freq: 'weekly', weekdays: [] }), '2026-08-06')).toBe(false)
  })
})

describe('pendingRules', () => {
  it('returns the due rules a day has not had applied', () => {
    const a = rule({ id: 'a' })
    const b = rule({ id: 'b', freq: 'weekly', weekdays: [4] })
    const c = rule({ id: 'c', freq: 'weekly', weekdays: [0] })
    expect(pendingRules([a, b, c], '2026-08-06', []).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('excludes rules already applied to that day', () => {
    const a = rule({ id: 'a' })
    const b = rule({ id: 'b' })
    expect(pendingRules([a, b], '2026-08-06', ['a']).map((r) => r.id)).toEqual(['b'])
  })

  it('is empty once every due rule has been applied — the idempotency guarantee', () => {
    const a = rule({ id: 'a' })
    expect(pendingRules([a], '2026-08-06', ['a'])).toEqual([])
  })

  it('handles an empty rule set', () => {
    expect(pendingRules([], '2026-08-06', [])).toEqual([])
  })
})

describe('resolveRecurring', () => {
  it('resolves a due rule with no matching task as a fresh instance', () => {
    const a = rule({ id: 'a' })
    const resolved = resolveRecurring([a], [], '2026-08-06', [])
    expect(resolved).toEqual([{ rule: a, existing: null }])
  })

  it('resolves a due rule with an undone instance as that instance, not a new one', () => {
    const a = rule({ id: 'a' })
    const open = task({ id: 't-open', recurringTaskId: 'a', dueDate: '2026-08-01' })
    const resolved = resolveRecurring([a], [open], '2026-08-06', [])
    expect(resolved).toEqual([{ rule: a, existing: open }])
  })

  it('treats a done instance as nothing outstanding — mints fresh rather than reusing it', () => {
    const a = rule({ id: 'a' })
    const finished = task({ id: 't-done', recurringTaskId: 'a', done: true })
    const resolved = resolveRecurring([a], [finished], '2026-08-06', [])
    expect(resolved).toEqual([{ rule: a, existing: null }])
  })

  it('does not match a task belonging to a different rule', () => {
    const a = rule({ id: 'a' })
    const otherRulesTask = task({ id: 't-other', recurringTaskId: 'b' })
    const resolved = resolveRecurring([a], [otherRulesTask], '2026-08-06', [])
    expect(resolved).toEqual([{ rule: a, existing: null }])
  })

  it('excludes a rule already applied to that day, same as pendingRules', () => {
    const a = rule({ id: 'a' })
    expect(resolveRecurring([a], [], '2026-08-06', ['a'])).toEqual([])
  })

  it('resolves multiple due rules independently', () => {
    const a = rule({ id: 'a' })
    const b = rule({ id: 'b' })
    const openForA = task({ id: 't-a', recurringTaskId: 'a' })
    const resolved = resolveRecurring([a, b], [openForA], '2026-08-06', [])
    expect(resolved).toEqual([
      { rule: a, existing: openForA },
      { rule: b, existing: null }
    ])
  })
})

describe('ruleFromTask', () => {
  it('builds a daily, active rule seeded from the task text and estimate', () => {
    expect(ruleFromTask(task({ text: 'Water the plants', estimateMinutes: 5 }))).toEqual({
      text: 'Water the plants',
      estimateMinutes: 5,
      freq: 'daily',
      weekdays: [],
      dayOfMonth: 1,
      active: true
    })
  })

  it('carries a null estimate through unchanged', () => {
    expect(ruleFromTask(task({ estimateMinutes: null })).estimateMinutes).toBeNull()
  })
})
