import { describe, expect, it } from 'vitest'
import type { RecurringTask } from './types'
import { dueOn, pendingRules } from './recurrence'

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
