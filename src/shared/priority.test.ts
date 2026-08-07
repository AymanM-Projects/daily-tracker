import { describe, expect, it } from 'vitest'
import type { Prioritised } from './priority'
import { derivePriority, effectivePriority, priorityLabel } from './priority'

function item(over: Partial<Prioritised> = {}): Prioritised {
  return { priority: 3, dueDate: null, ...over }
}

const TODAY = '2026-08-07'

describe('derivePriority', () => {
  it('is High on the due date itself', () => {
    expect(derivePriority('2026-08-07', TODAY)).toBe(1)
  })

  it('is High the day before it is due', () => {
    expect(derivePriority('2026-08-08', TODAY)).toBe(1)
  })

  it('is High once overdue, and stays there', () => {
    expect(derivePriority('2026-08-06', TODAY)).toBe(1)
    expect(derivePriority('2026-01-01', TODAY)).toBe(1)
  })

  it('is Medium from two to four days out', () => {
    expect(derivePriority('2026-08-09', TODAY)).toBe(2)
    expect(derivePriority('2026-08-11', TODAY)).toBe(2)
  })

  it('is Low beyond four days', () => {
    expect(derivePriority('2026-08-12', TODAY)).toBe(3)
    expect(derivePriority('2026-12-25', TODAY)).toBe(3)
  })

  it('escalates on its own as the day approaches — nothing has to rewrite the task', () => {
    const due = '2026-08-15'
    const seen = ['2026-08-01', '2026-08-11', '2026-08-14'].map((d) => derivePriority(due, d))
    expect(seen).toEqual([3, 2, 1])
  })

  it('counts days across a month boundary', () => {
    expect(derivePriority('2026-09-01', '2026-08-31')).toBe(1)
    expect(derivePriority('2026-09-03', '2026-08-31')).toBe(2)
  })

  it('counts days across a DST boundary rather than dividing milliseconds', () => {
    // US DST ends 2026-11-01, making that local day 25 hours long
    expect(derivePriority('2026-11-02', '2026-11-01')).toBe(1)
    expect(derivePriority('2026-11-04', '2026-11-01')).toBe(2)
  })
})

describe('effectivePriority', () => {
  it('uses the manual priority when there is no deadline', () => {
    expect(effectivePriority(item({ priority: 1 }), TODAY)).toBe(1)
    expect(effectivePriority(item({ priority: 3 }), TODAY)).toBe(3)
  })

  it('lets a deadline override a lower manual priority', () => {
    expect(effectivePriority(item({ priority: 3, dueDate: '2026-08-07' }), TODAY)).toBe(1)
  })

  it('lets a deadline override a HIGHER manual priority too — the deadline is the answer', () => {
    expect(effectivePriority(item({ priority: 1, dueDate: '2026-12-25' }), TODAY)).toBe(3)
  })
})

describe('priorityLabel', () => {
  it('names each level', () => {
    expect([1, 2, 3].map((p) => priorityLabel(p as 1 | 2 | 3))).toEqual(['High', 'Medium', 'Low'])
  })
})
