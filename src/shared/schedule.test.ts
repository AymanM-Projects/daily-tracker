import { describe, expect, it } from 'vitest'
import type { Activity, Settings } from './types'
import { avoidAnchors, generateSchedule, type Anchor, type ScheduleResult } from './schedule'

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

function activity(over: Partial<Activity> = {}): Activity {
  return {
    id: 'a1',
    name: 'Work',
    durationMinutes: 60,
    priority: 2,
    mode: 'focus',
    projectId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

/**
 * Flatten a result into 'lane kind HH:mm-HH:mm name' lines, in emission order.
 * Order is part of what these lock in — `generateSchedule` emits anchors, then
 * focus, then parallel.
 */
const lines = (r: ScheduleResult): string[] =>
  r.blocks.map((b) => `${b.lane} ${b.kind} ${b.start}-${b.end} ${b.name}`)

const at = (h: number, m = 0): number => h * 60 + m

describe('generateSchedule day window', () => {
  it('returns nothing when the day window is inverted', () => {
    const r = generateSchedule([activity()], settings({ dayStart: '17:00', dayEnd: '09:00' }))
    expect(r).toEqual({ blocks: [], unscheduled: [] })
  })

  it('emits anchors even when there is nothing to schedule', () => {
    const r = generateSchedule([], settings(), {
      anchors: [{ name: 'Dhuhr', start: at(13), end: at(13, 20) }]
    })
    expect(lines(r)).toEqual(['focus anchor 13:00-13:20 Dhuhr'])
    expect(r.unscheduled).toEqual([])
  })

  it('drops anchors that fall outside the day window', () => {
    const anchors: Anchor[] = [
      { name: 'Fajr', start: at(5), end: at(5, 20) },
      { name: 'Dhuhr', start: at(13), end: at(13, 20) },
      { name: 'Isha', start: at(21), end: at(21, 20) }
    ]
    const r = generateSchedule([], settings(), { anchors })
    expect(lines(r)).toEqual(['focus anchor 13:00-13:20 Dhuhr'])
  })
})

describe('generateSchedule lanes', () => {
  it('lays focus activities back to back from dayStart', () => {
    const r = generateSchedule(
      [activity({ id: 'a', name: 'One' }), activity({ id: 'b', name: 'Two' })],
      settings()
    )
    expect(lines(r)).toEqual(['focus activity 09:00-10:00 One', 'focus activity 10:00-11:00 Two'])
  })

  it('starts both lanes at dayStart so they overlap', () => {
    const r = generateSchedule(
      [
        activity({ id: 'f', name: 'Essay' }),
        activity({ id: 'p', name: 'Print', mode: 'background', durationMinutes: 180 })
      ],
      settings()
    )
    expect(lines(r)).toEqual([
      'focus activity 09:00-10:00 Essay',
      'parallel activity 09:00-12:00 Print'
    ])
  })

  it('sorts by priority, then duration, then createdAt', () => {
    const r = generateSchedule(
      [
        activity({
          id: '1',
          name: 'LateTie',
          priority: 2,
          durationMinutes: 30,
          createdAt: '2026-08-02T00:00:00.000Z'
        }),
        activity({ id: '2', name: 'Low', priority: 3, durationMinutes: 15 }),
        activity({
          id: '3',
          name: 'EarlyTie',
          priority: 2,
          durationMinutes: 30,
          createdAt: '2026-08-01T00:00:00.000Z'
        }),
        activity({ id: '4', name: 'High', priority: 1, durationMinutes: 60 })
      ],
      settings()
    )
    expect(lines(r).map((l) => l.split(' ').pop())).toEqual(['High', 'EarlyTie', 'LateTie', 'Low'])
  })
})

describe('generateSchedule breaks', () => {
  it('inserts a break between consecutive focus activities', () => {
    const r = generateSchedule(
      [activity({ id: 'a', name: 'One' }), activity({ id: 'b', name: 'Two' })],
      settings({ breaksEnabled: true })
    )
    expect(lines(r)).toEqual([
      'focus activity 09:00-10:00 One',
      'focus break 10:00-10:10 Break',
      'focus activity 10:10-11:10 Two'
    ])
  })

  it('never adds a break after the last activity', () => {
    const r = generateSchedule([activity({ name: 'Only' })], settings({ breaksEnabled: true }))
    expect(lines(r)).toEqual(['focus activity 09:00-10:00 Only'])
  })

  it('never adds breaks to the parallel lane', () => {
    const r = generateSchedule(
      [
        activity({ id: 'p1', name: 'Print', mode: 'background', durationMinutes: 60 }),
        activity({ id: 'p2', name: 'Render', mode: 'background', durationMinutes: 60 })
      ],
      settings({ breaksEnabled: true })
    )
    expect(lines(r)).toEqual([
      'parallel activity 09:00-10:00 Print',
      'parallel activity 10:00-11:00 Render'
    ])
  })

  it('skips a break rather than shifting it when an anchor lands on the boundary', () => {
    const r = generateSchedule(
      [activity({ id: 'a', name: 'One' }), activity({ id: 'b', name: 'Two' })],
      settings({ breaksEnabled: true }),
      { anchors: [{ name: 'Dhuhr', start: at(10), end: at(10, 20) }] }
    )
    expect(lines(r)).toEqual([
      'focus anchor 10:00-10:20 Dhuhr',
      'focus activity 09:00-10:00 One',
      'focus activity 10:20-11:20 Two'
    ])
  })
})

describe('generateSchedule anchors', () => {
  it('starts an activity after an anchor rather than splitting it', () => {
    const r = generateSchedule([activity({ name: 'Essay' })], settings(), {
      anchors: [{ name: 'Dhuhr', start: at(9, 30), end: at(9, 50) }]
    })
    expect(lines(r)).toEqual(['focus anchor 09:30-09:50 Dhuhr', 'focus activity 09:50-10:50 Essay'])
  })

  it('runs the parallel lane straight through anchors', () => {
    const r = generateSchedule(
      [activity({ name: 'Print', mode: 'background', durationMinutes: 240 })],
      settings(),
      { anchors: [{ name: 'Dhuhr', start: at(9, 30), end: at(9, 50) }] }
    )
    expect(lines(r)).toEqual([
      'focus anchor 09:30-09:50 Dhuhr',
      'parallel activity 09:00-13:00 Print'
    ])
  })

  it('steps over back-to-back anchors in one go', () => {
    expect(
      avoidAnchors(at(9), 60, [
        { name: 'A', start: at(9, 30), end: at(9, 50) },
        { name: 'B', start: at(9, 50), end: at(10, 10) }
      ])
    ).toBe(at(10, 10))
  })

  it('leaves the cursor alone when nothing collides', () => {
    expect(avoidAnchors(at(9), 30, [{ name: 'A', start: at(11), end: at(11, 20) }])).toBe(at(9))
  })
})

describe('generateSchedule overflow', () => {
  it('flags the first block past dayEnd and dumps the rest to unscheduled', () => {
    const r = generateSchedule(
      [
        activity({ id: '1', name: 'One', createdAt: '2026-08-01T00:00:00.000Z' }),
        activity({ id: '2', name: 'Two', createdAt: '2026-08-02T00:00:00.000Z' }),
        activity({ id: '3', name: 'Three', createdAt: '2026-08-03T00:00:00.000Z' }),
        activity({ id: '4', name: 'Four', createdAt: '2026-08-04T00:00:00.000Z' })
      ],
      settings({ dayEnd: '11:00' })
    )
    expect(lines(r)).toEqual([
      'focus activity 09:00-10:00 One',
      'focus activity 10:00-11:00 Two',
      'focus activity 11:00-12:00 Three'
    ])
    expect(r.blocks.map((b) => b.overflow)).toEqual([false, false, true])
    expect(r.unscheduled).toEqual(['Four'])
  })

  it('overflows each lane independently', () => {
    const r = generateSchedule(
      [
        activity({ id: 'f1', name: 'F1', durationMinutes: 150 }),
        activity({ id: 'p1', name: 'P1', mode: 'background', durationMinutes: 60 })
      ],
      settings({ dayEnd: '11:00' })
    )
    expect(r.unscheduled).toEqual([])
    expect(lines(r)).toEqual(['focus activity 09:00-11:30 F1', 'parallel activity 09:00-10:00 P1'])
  })
})

describe('generateSchedule block shape', () => {
  it('snapshots the activity name and links the activity id', () => {
    const [block] = generateSchedule([activity({ id: 'src', name: 'Essay' })], settings()).blocks
    expect(block).toMatchObject({
      kind: 'activity',
      lane: 'focus',
      activityId: 'src',
      backlogTaskId: null,
      name: 'Essay',
      status: 'planned',
      actualMinutes: null,
      manual: false,
      promptedAt: null,
      plannedMinutes: null
    })
    expect(block.id).toEqual(expect.any(String))
  })

  it('leaves anchors and breaks unlinked to any activity', () => {
    const r = generateSchedule(
      [activity({ id: 'a', name: 'One' }), activity({ id: 'b', name: 'Two' })],
      settings({ breaksEnabled: true }),
      { anchors: [{ name: 'Asr', start: at(15), end: at(15, 20) }] }
    )
    for (const b of r.blocks.filter((x) => x.kind !== 'activity')) {
      expect(b.activityId).toBeNull()
      expect(b.backlogTaskId).toBeNull()
    }
  })
})

/** n focus activities of `minutes` each, named A1..An and ordered by createdAt. */
const chain = (n: number, minutes = 60): Activity[] =>
  Array.from({ length: n }, (_, i) =>
    activity({
      id: `a${i + 1}`,
      name: `A${i + 1}`,
      durationMinutes: minutes,
      createdAt: `2026-08-0${i + 1}T00:00:00.000Z`
    })
  )

describe('protected free buffers', () => {
  it('reproduces the pre-change output exactly when disabled', () => {
    const input = chain(4)
    const opts = { anchors: [{ name: 'Dhuhr', start: at(13), end: at(13, 20) }] }
    const off = generateSchedule(input, settings({ breaksEnabled: true }), opts)
    expect(lines(off)).toEqual([
      'focus anchor 13:00-13:20 Dhuhr',
      'focus activity 09:00-10:00 A1',
      'focus break 10:00-10:10 Break',
      'focus activity 10:10-11:10 A2',
      'focus break 11:10-11:20 Break',
      'focus activity 11:20-12:20 A3',
      'focus break 12:20-12:30 Break',
      // pushed past Dhuhr rather than split across it
      'focus activity 13:20-14:20 A4'
    ])
    expect(off.blocks.some((b) => b.kind === 'free')).toBe(false)
  })

  it('leaves output identical when the threshold is never reached', () => {
    const input = chain(3, 30)
    const on = generateSchedule(input, settings({ freeBufferEnabled: true }))
    const off = generateSchedule(input, settings())
    expect(lines(on)).toEqual(lines(off))
  })

  it('inserts a buffer after freeBufferEveryMinutes of focus work', () => {
    const r = generateSchedule(chain(3), settings({ freeBufferEnabled: true }))
    expect(lines(r)).toEqual([
      'focus activity 09:00-10:00 A1',
      'focus activity 10:00-11:00 A2',
      'focus free 11:00-11:30 Free',
      'focus activity 11:30-12:30 A3'
    ])
  })

  it('replaces the break at that boundary rather than stacking on it', () => {
    const r = generateSchedule(chain(3), settings({ freeBufferEnabled: true, breaksEnabled: true }))
    expect(lines(r)).toEqual([
      'focus activity 09:00-10:00 A1',
      'focus break 10:00-10:10 Break',
      'focus activity 10:10-11:10 A2',
      'focus free 11:10-11:40 Free',
      'focus activity 11:40-12:40 A3'
    ])
  })

  it('starts the clock over and inserts nothing when an anchor sits on the boundary', () => {
    // salah IS the rest — a free block on top of it would be a second one
    const r = generateSchedule(chain(3), settings({ freeBufferEnabled: true }), {
      anchors: [{ name: 'Dhuhr', start: at(11), end: at(11, 20) }]
    })
    expect(lines(r)).toEqual([
      'focus anchor 11:00-11:20 Dhuhr',
      'focus activity 09:00-10:00 A1',
      'focus activity 10:00-11:00 A2',
      'focus activity 11:20-12:20 A3'
    ])
  })

  it('skips a buffer that will not fit before an anchor, and keeps the debt', () => {
    // the 30m buffer due at 11:00 collides with an 11:10 prayer, so it is
    // skipped rather than shifted past it — and comes due again at the next boundary
    const r = generateSchedule(chain(4), settings({ freeBufferEnabled: true }), {
      anchors: [{ name: 'Dhuhr', start: at(11, 10), end: at(11, 30) }]
    })
    expect(lines(r)).toEqual([
      'focus anchor 11:10-11:30 Dhuhr',
      'focus activity 09:00-10:00 A1',
      'focus activity 10:00-11:00 A2',
      'focus activity 11:30-12:30 A3',
      'focus free 12:30-13:00 Free',
      'focus activity 13:00-14:00 A4'
    ])
  })

  it('never inserts a buffer into the parallel lane', () => {
    const background = chain(3).map((a) => ({ ...a, mode: 'background' as const }))
    const r = generateSchedule(background, settings({ freeBufferEnabled: true }))
    expect(r.blocks.some((b) => b.kind === 'free')).toBe(false)
    expect(lines(r)).toEqual([
      'parallel activity 09:00-10:00 A1',
      'parallel activity 10:00-11:00 A2',
      'parallel activity 11:00-12:00 A3'
    ])
  })

  it('never leaves a buffer trailing the last activity', () => {
    const r = generateSchedule(
      chain(2),
      settings({ freeBufferEnabled: true, freeBufferEveryMinutes: 60 })
    )
    expect(lines(r)).toEqual([
      'focus activity 09:00-10:00 A1',
      'focus free 10:00-10:30 Free',
      'focus activity 10:30-11:30 A2'
    ])
  })

  it('skips a buffer that would run past dayEnd', () => {
    const r = generateSchedule(chain(3), settings({ freeBufferEnabled: true, dayEnd: '11:10' }))
    expect(r.blocks.some((b) => b.kind === 'free')).toBe(false)
    expect(lines(r)).toEqual([
      'focus activity 09:00-10:00 A1',
      'focus activity 10:00-11:00 A2',
      'focus activity 11:00-12:00 A3'
    ])
  })

  it('leaves the rest of the day open rather than protecting it', () => {
    // the tail is unplanned, not earned rest. Protecting it would make every
    // focus minute after the last activity invisible to the backlog planner,
    // which treats a free block as occupied — no backlog work could ever land
    // on a generated day.
    const r = generateSchedule(chain(3), settings({ freeBufferEnabled: true }))
    const last = r.blocks[r.blocks.length - 1]
    expect(last).toMatchObject({ kind: 'activity', end: '12:30' })
    expect(r.blocks.filter((b) => b.kind === 'free')).toHaveLength(1)
  })

  it('emits a free block the planner will treat as occupied', () => {
    const free = generateSchedule(chain(3), settings({ freeBufferEnabled: true })).blocks.find(
      (b) => b.kind === 'free'
    )
    expect(free).toMatchObject({
      kind: 'free',
      lane: 'focus',
      name: 'Free',
      activityId: null,
      backlogTaskId: null,
      status: 'planned',
      overflow: false,
      manual: false
    })
  })
})
