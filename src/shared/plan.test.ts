import { describe, expect, it } from 'vitest'
import type { BacklogTask, ScheduleBlock, Settings } from './types'
import { planBacklog, type PlanInput, type PlanResult } from './plan'
import { blockMinutes } from './blocks'

const DAY1 = '2026-08-06'
const DAY2 = '2026-08-07'
const DAY3 = '2026-08-08'

function settings(over: Partial<Settings> = {}): Settings {
  return {
    dayStart: '09:00',
    dayEnd: '17:00',
    breaksEnabled: false,
    breakMinutes: 10,
    alwaysOnTop: false,
    freeBufferEnabled: false,
    freeBufferMinutes: 30,
    freeBufferEveryMinutes: 120,
    theme: 'system',
    ...over
  }
}

function task(over: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: 't1',
    text: 'Essay',
    priority: 2,
    estimateMinutes: 60,
    dueDate: null,
    done: false,
    completedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

function block(over: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: 'b1',
    kind: 'activity',
    lane: 'focus',
    activityId: 'a1',
    backlogTaskId: null,
    anchorSource: null,
    name: 'Existing',
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

function run(over: Partial<PlanInput> = {}): PlanResult {
  return planBacklog({
    backlog: [],
    days: {},
    anchorsByDate: {},
    settings: settings(),
    fromDate: DAY1,
    fromMinute: 0,
    horizonDays: 3,
    ...over
  })
}

/** Flatten a result into 'DATE HH:mm-HH:mm name' lines — easiest thing to assert on. */
const lines = (r: PlanResult): string[] =>
  Object.entries(r.placements)
    .flatMap(([date, blocks]) => blocks.map((b) => `${date} ${b.start}-${b.end} ${b.name}`))
    .sort()

describe('planBacklog basics', () => {
  it('places a task in the first free slot of the day', () => {
    expect(lines(run({ backlog: [task()] }))).toEqual([`${DAY1} 09:00-10:00 Essay`])
  })

  it('never places a task with no estimate', () => {
    const r = run({ backlog: [task({ estimateMinutes: null })] })
    expect(r.placements).toEqual({})
    expect(r.unplaced).toEqual([])
  })

  it('ignores tasks already done', () => {
    expect(run({ backlog: [task({ done: true })] }).placements).toEqual({})
  })
})

describe('planBacklog only fills gaps', () => {
  it('works around an existing block and never emits it', () => {
    const existing = block({ start: '09:00', end: '11:00' })
    const r = run({ backlog: [task({ estimateMinutes: 60 })], days: { [DAY1]: [existing] } })
    expect(lines(r)).toEqual([`${DAY1} 11:00-12:00 Essay`])
    expect(r.placements[DAY1].every((b) => b.backlogTaskId === 't1')).toBe(true)
  })

  it('never places over an anchor', () => {
    const r = run({
      backlog: [task({ estimateMinutes: 120 })],
      anchorsByDate: { [DAY1]: [{ name: 'Dhuhr', start: 9 * 60 + 30, end: 9 * 60 + 50 }] }
    })
    expect(lines(r)).toEqual([
      `${DAY1} 09:00-09:30 Essay (Part 1 of 2)`,
      `${DAY1} 09:50-11:20 Essay (Part 2 of 2)`
    ])
  })

  it('leaves today free only from fromMinute onward', () => {
    const r = run({ backlog: [task({ estimateMinutes: 60 })], fromMinute: 14 * 60 })
    expect(lines(r)).toEqual([`${DAY1} 14:00-15:00 Essay`])
  })

  it('applies fromMinute to the first day only', () => {
    // 8h window, now 16:00 -> one hour left today, the rest spills to tomorrow
    const r = run({ backlog: [task({ estimateMinutes: 180 })], fromMinute: 16 * 60 })
    expect(lines(r)).toEqual([
      `${DAY1} 16:00-17:00 Essay (Part 1 of 2)`,
      `${DAY2} 09:00-11:00 Essay (Part 2 of 2)`
    ])
  })
})

describe('planBacklog splitting', () => {
  it('spills a long task across days', () => {
    // 8h/day window, 20h of work -> 8 + 8 + 4
    const r = run({ backlog: [task({ text: 'Big', estimateMinutes: 20 * 60 })] })
    expect(lines(r)).toEqual([
      `${DAY1} 09:00-17:00 Big (Part 1 of 3)`,
      `${DAY2} 09:00-17:00 Big (Part 2 of 3)`,
      `${DAY3} 09:00-13:00 Big (Part 3 of 3)`
    ])
  })

  it('refuses a gap smaller than minChunkMinutes', () => {
    // the 20-minute hole before the existing block is under the 30-minute floor
    const r = run({
      backlog: [task({ estimateMinutes: 60 })],
      days: { [DAY1]: [block({ start: '09:20', end: '11:00' })] }
    })
    expect(lines(r)).toEqual([`${DAY1} 11:00-12:00 Essay`])
  })

  it('still uses a small gap when the work left is smaller than the floor', () => {
    const r = run({
      backlog: [task({ estimateMinutes: 15 })],
      days: { [DAY1]: [block({ start: '09:20', end: '17:00' })] }
    })
    expect(lines(r)).toEqual([`${DAY1} 09:00-09:15 Essay`])
  })
})

describe('planBacklog ordering', () => {
  it('places higher priority first', () => {
    const r = run({
      backlog: [
        task({ id: 'lo', text: 'Low', priority: 3, estimateMinutes: 60 }),
        task({ id: 'hi', text: 'High', priority: 1, estimateMinutes: 60 })
      ]
    })
    expect(lines(r)).toEqual([`${DAY1} 09:00-10:00 High`, `${DAY1} 10:00-11:00 Low`])
  })

  it('breaks ties by due date, undated last', () => {
    const r = run({
      backlog: [
        task({ id: 'none', text: 'Someday', dueDate: null, estimateMinutes: 60 }),
        task({ id: 'soon', text: 'Soon', dueDate: DAY2, estimateMinutes: 60 })
      ]
    })
    expect(lines(r)).toEqual([`${DAY1} 09:00-10:00 Soon`, `${DAY1} 10:00-11:00 Someday`])
  })

  it('never schedules a task after its own deadline', () => {
    // 20h of work but due tomorrow: only two days of window are usable
    const r = run({ backlog: [task({ text: 'Due', estimateMinutes: 20 * 60, dueDate: DAY2 })] })
    expect(Object.keys(r.placements).sort()).toEqual([DAY1, DAY2])
    expect(r.unplaced).toEqual(['Due'])
  })
})

describe('planBacklog is idempotent', () => {
  it('places nothing on a second run', () => {
    const t = task({ estimateMinutes: 120 })
    const first = run({ backlog: [t] })
    expect(lines(first)).toHaveLength(1)

    // feed the first run's output back in as existing state
    const second = run({ backlog: [t], days: first.placements })
    expect(second.placements).toEqual({})
    expect(second.unplaced).toEqual([])
  })

  it('places only the remainder when a task is partly scheduled', () => {
    const t = task({ estimateMinutes: 180 })
    const already = { [DAY1]: [block({ start: '09:00', end: '10:00', backlogTaskId: 't1' })] }
    const r = run({ backlog: [t], days: already })
    const total = Object.values(r.placements)
      .flat()
      .reduce((sum, b) => {
        const [sh, sm] = b.start.split(':').map(Number)
        const [eh, em] = b.end.split(':').map(Number)
        return sum + (eh * 60 + em - (sh * 60 + sm))
      }, 0)
    expect(total).toBe(120) // 60 of the 180 was already committed
  })
})

describe('planBacklog horizon', () => {
  it('reports work that does not fit rather than dropping it', () => {
    // 3-day horizon at 8h/day = 24h of capacity; ask for 30h
    const r = run({ backlog: [task({ text: 'Huge', estimateMinutes: 30 * 60 })] })
    expect(r.unplaced).toEqual(['Huge'])
    expect(Object.keys(r.placements).sort()).toEqual([DAY1, DAY2, DAY3])
  })

  it('places nothing when the day window is inverted', () => {
    const r = run({ backlog: [task()], settings: settings({ dayStart: '17:00', dayEnd: '09:00' }) })
    expect(r.placements).toEqual({})
    expect(r.unplaced).toEqual(['Essay'])
  })
})

describe('skipped, free and parallel-lane blocks', () => {
  it('does not count a skipped block as work already done', () => {
    // the whole 60m estimate must still be placed: skipping bought no time, and
    // counting it would silently delete the task instead of deferring it
    const r = run({
      backlog: [task({ estimateMinutes: 60 })],
      days: {
        [DAY1]: [
          block({ id: 'x', backlogTaskId: 't1', start: '09:00', end: '10:00', status: 'skipped' })
        ]
      }
    })
    const placed = Object.values(r.placements)
      .flat()
      .reduce((sum, b) => sum + blockMinutes(b), 0)
    expect(placed).toBe(60)
  })

  it('still treats the skipped slot as occupied, so the work lands on a later day', () => {
    // "something came up" means you are busy now, not that the slot is free —
    // freeing it would drop the same task straight back into the same hour
    const r = run({
      backlog: [task({ estimateMinutes: 60 })],
      days: {
        [DAY1]: [
          block({ id: 'x', backlogTaskId: 't1', start: '09:00', end: '10:00', status: 'skipped' }),
          block({ id: 'y', start: '10:00', end: '17:00' })
        ]
      }
    })
    expect(lines(r)).toEqual([`${DAY2} 09:00-10:00 Essay`])
  })

  it('never places work into protected free time', () => {
    const r = run({
      backlog: [task({ estimateMinutes: 60 })],
      days: {
        [DAY1]: [block({ id: 'f', kind: 'free', name: 'Free', start: '09:00', end: '17:00' })],
        [DAY2]: [block({ id: 'g', kind: 'free', name: 'Free', start: '09:00', end: '17:00' })]
      }
    })
    expect(lines(r)).toEqual([`${DAY3} 09:00-10:00 Essay`])
  })

  it('a full parallel lane does not block focus placement', () => {
    // a 3D print running all day is unattended; the focus lane is still free
    const r = run({
      backlog: [task({ estimateMinutes: 60 })],
      days: {
        [DAY1]: [block({ id: 'p', lane: 'parallel', start: '09:00', end: '17:00' })]
      }
    })
    expect(lines(r)).toEqual([`${DAY1} 09:00-10:00 Essay`])
  })

  it('sees a block that runs past midnight as occupied', () => {
    // parseHM alone yields {start: 1380, end: 30}, an inverted interval that the
    // sweep discards — the planner would schedule straight over it
    const r = run({
      backlog: [task({ estimateMinutes: 60 })],
      settings: settings({ dayStart: '22:00', dayEnd: '23:59' }),
      days: { [DAY1]: [block({ id: 'n', start: '22:00', end: '00:30' })] }
    })
    expect(lines(r).filter((l) => l.startsWith(DAY1))).toEqual([])
  })
})
