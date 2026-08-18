import { describe, expect, it } from 'vitest'
import type { BacklogTask, DayData, ScheduleBlock } from './types'
import { alreadyCarried, carryForward, daysToSweep } from './carry'

function block(over: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: 'b1',
    kind: 'activity',
    lane: 'focus',
    activityId: 'a1',
    backlogTaskId: null,
    anchorSource: null,
    name: 'Deep work',
    start: '09:00',
    end: '10:00',
    overflow: false,
    status: 'planned',
    actualMinutes: null,
    manual: false,
    promptedAt: null,
    plannedMinutes: null,
    ...over
  }
}

function day(over: Partial<DayData> = {}): DayData {
  return {
    checklist: [],
    journal: [],
    schedule: [block()],
    unscheduled: null,
    activitySetId: null,
    recurringApplied: [],
    carriedForward: false,
    ...over
  }
}

/** 'name Nm' — readable enough to assert on without comparing object graphs */
function flat(work: { text: string; estimateMinutes: number }[]): string[] {
  return work.map((w) => `${w.text} ${w.estimateMinutes}m`)
}

const YESTERDAY = '2026-08-06'
const TODAY = '2026-08-07'

describe('carryForward', () => {
  it('carries a block nobody ever touched, at its full length', () => {
    expect(flat(carryForward(day(), YESTERDAY, TODAY))).toEqual(['Deep work 60m'])
  })

  it('carries only the unworked remainder of a partial block', () => {
    const partial = day({
      schedule: [block({ status: 'partial', actualMinutes: 20, plannedMinutes: 60 })]
    })
    expect(flat(carryForward(partial, YESTERDAY, TODAY))).toEqual(['Deep work 40m'])
  })

  it('falls back to the block length when a partial never recorded a planned length', () => {
    const partial = day({ schedule: [block({ status: 'partial', actualMinutes: 15 })] })
    expect(flat(carryForward(partial, YESTERDAY, TODAY))).toEqual(['Deep work 45m'])
  })

  it('carries nothing for a finished block', () => {
    expect(carryForward(day({ schedule: [block({ status: 'done' })] }), YESTERDAY, TODAY)).toEqual(
      []
    )
  })

  it('carries nothing for a skipped block — skipping is a decision, not an oversight', () => {
    expect(
      carryForward(day({ schedule: [block({ status: 'skipped' })] }), YESTERDAY, TODAY)
    ).toEqual([])
  })

  it('leaves backlog work alone — the planner already tracks its remaining minutes', () => {
    const placed = day({ schedule: [block({ activityId: null, backlogTaskId: 't1' })] })
    expect(carryForward(placed, YESTERDAY, TODAY)).toEqual([])
  })

  it('ignores breaks, anchors and free time', () => {
    const filler = day({
      schedule: [
        block({ id: 'b2', kind: 'break', activityId: null, name: 'Break' }),
        block({ id: 'b3', kind: 'anchor', activityId: null, name: 'Dhuhr' }),
        block({ id: 'b4', kind: 'free', activityId: null, name: 'Free' })
      ]
    })
    expect(carryForward(filler, YESTERDAY, TODAY)).toEqual([])
  })

  it('drops a leftover too small to be worth a task', () => {
    const sliver = day({
      schedule: [block({ status: 'partial', actualMinutes: 58, plannedMinutes: 60 })]
    })
    expect(carryForward(sliver, YESTERDAY, TODAY)).toEqual([])
  })

  it('never touches today — the day is still being lived', () => {
    expect(carryForward(day(), TODAY, TODAY)).toEqual([])
  })

  it('never touches a future day', () => {
    expect(carryForward(day(), '2026-08-09', TODAY)).toEqual([])
  })

  it('is a no-op on a day already swept — saying "carried" has to stick', () => {
    expect(carryForward(day({ carriedForward: true }), YESTERDAY, TODAY)).toEqual([])
  })

  it('is a no-op on a day that was never generated', () => {
    expect(carryForward(day({ schedule: null }), YESTERDAY, TODAY)).toEqual([])
  })

  it('strips an existing Part suffix rather than stacking another', () => {
    const named = day({ schedule: [block({ name: 'Essay (Part 2 of 3)' })] })
    expect(flat(carryForward(named, YESTERDAY, TODAY))).toEqual(['Essay 60m'])
  })

  it('reports the block it came from, so the same block cannot be harvested twice', () => {
    expect(carryForward(day(), YESTERDAY, TODAY).map((w) => w.sourceBlockId)).toEqual(['b1'])
  })

  it('carries several unfinished blocks from one day', () => {
    const busy = day({
      schedule: [block({ id: 'b1' }), block({ id: 'b2', name: 'Reading', end: '09:30' })]
    })
    expect(flat(carryForward(busy, YESTERDAY, TODAY))).toEqual(['Deep work 60m', 'Reading 30m'])
  })
})

describe('daysToSweep', () => {
  it('returns unswept past days oldest first', () => {
    const days = { '2026-08-05': day(), '2026-08-03': day(), '2026-08-04': day() }
    expect(daysToSweep(days, TODAY)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05'])
  })

  it('excludes today, the future, swept days and ungenerated days', () => {
    const days = {
      [TODAY]: day(),
      '2026-08-09': day(),
      '2026-08-05': day({ carriedForward: true }),
      '2026-08-04': day({ schedule: null }),
      '2026-08-03': day()
    }
    expect(daysToSweep(days, TODAY)).toEqual(['2026-08-03'])
  })
})

describe('alreadyCarried', () => {
  it('recognises a task minted from a given block', () => {
    const task = {
      id: 't1',
      text: 'Deep work',
      priority: 2,
      estimateMinutes: 60,
      dueDate: null,
      projectId: null,
      done: false,
      completedAt: null,
      createdAt: '2026-08-07T00:00:00.000Z',
      carriedFromBlockId: 'b1'
    } as BacklogTask
    expect(alreadyCarried([task], 'b1')).toBe(true)
    expect(alreadyCarried([task], 'b2')).toBe(false)
    expect(alreadyCarried([], 'b1')).toBe(false)
  })
})
