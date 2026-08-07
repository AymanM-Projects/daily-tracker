import { describe, expect, it } from 'vitest'
import type { BacklogTask, ScheduleBlock } from './types'
import {
  bankSpilled,
  editBlock,
  extendBlock,
  insertBlock,
  removeBlock,
  shiftAfter,
  spill,
  truncate,
  type DayWindow,
  type Result
} from './reschedule'
import { formatHM } from './time'

const WINDOW: DayWindow = { dayStart: 9 * 60, dayEnd: 17 * 60 }
const at = (h: number, m = 0): number => h * 60 + m

/** Ids are asserted on here, unlike the other suites, so they are minted predictably. */
function ids(prefix = 'new'): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

function block(over: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: 'b1',
    kind: 'activity',
    lane: 'focus',
    activityId: 'a1',
    backlogTaskId: null,
    anchorSource: null,
    name: 'Work',
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

const free = (
  id: string,
  start: number,
  end: number,
  lane: 'focus' | 'parallel' = 'focus'
): ScheduleBlock =>
  block({
    id,
    kind: 'free',
    lane,
    name: 'Free',
    activityId: null,
    start: formatHM(start),
    end: formatHM(end)
  })

const anchor = (id: string, start: number, end: number): ScheduleBlock =>
  block({
    id,
    kind: 'anchor',
    name: 'Dhuhr',
    activityId: null,
    start: formatHM(start),
    end: formatHM(end)
  })

/** 'kind lane HH:mm-HH:mm name' — the readable shape these tests assert on. */
const lines = (blocks: ScheduleBlock[]): string[] =>
  blocks.map((b) => `${b.kind} ${b.lane} ${b.start}-${b.end} ${b.name}`)

const value = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`)
  return r.value
}

describe('shiftAfter — what moves', () => {
  it('pushes planned blocks that start at or after the mark', () => {
    const out = shiftAfter(
      [
        block({ id: 'a', start: '09:00', end: '10:00', name: 'A' }),
        block({ id: 'b', start: '10:00', end: '11:00', name: 'B' })
      ],
      at(10),
      20
    )
    expect(lines(out)).toEqual(['activity focus 09:00-10:00 A', 'activity focus 10:20-11:20 B'])
  })

  it('never moves an anchor', () => {
    const out = shiftAfter([anchor('p', at(11), at(11, 20))], at(10), 30)
    expect(lines(out)).toEqual(['anchor focus 11:00-11:20 Dhuhr'])
  })

  it('never moves settled history', () => {
    const out = shiftAfter(
      [
        block({ id: 'd', start: '10:00', end: '11:00', name: 'Done', status: 'done' }),
        block({ id: 'p', start: '11:00', end: '12:00', name: 'Partial', status: 'partial' })
      ],
      at(10),
      30
    )
    expect(lines(out)).toEqual([
      'activity focus 10:00-11:00 Done',
      'activity focus 11:00-12:00 Partial'
    ])
  })

  it('leaves a straddling block alone — that is extendBlock territory', () => {
    const out = shiftAfter([block({ id: 'x', start: '09:00', end: '11:00' })], at(10), 30)
    expect(lines(out)).toEqual(['activity focus 09:00-11:00 Work'])
  })

  it('holds a skipped block in place but does not let it act as a barrier', () => {
    const out = shiftAfter(
      [
        block({ id: 's', start: '10:00', end: '11:00', name: 'Skipped', status: 'skipped' }),
        block({ id: 'b', start: '11:00', end: '12:00', name: 'B' })
      ],
      at(10),
      30
    )
    // B shifts straight over the skipped slot: nothing happened in it
    expect(lines(out)).toEqual([
      'activity focus 10:00-11:00 Skipped',
      'activity focus 11:30-12:30 B'
    ])
  })

  it('shifts each lane independently', () => {
    const out = shiftAfter(
      [
        block({ id: 'f', start: '10:00', end: '11:00', name: 'Focus' }),
        block({ id: 'p', lane: 'parallel', start: '10:00', end: '14:00', name: 'Print' })
      ],
      at(10),
      30
    )
    expect(lines(out)).toEqual([
      'activity focus 10:30-11:30 Focus',
      'activity parallel 10:30-14:30 Print'
    ])
  })

  it('returns the blocks untouched for a zero delta', () => {
    const input = [block({ id: 'a', start: '10:00', end: '11:00' })]
    expect(lines(shiftAfter(input, at(9), 0))).toEqual(lines(input))
  })
})

describe('shiftAfter — consumables absorb', () => {
  it('takes minutes off a free block front and moves nothing downstream', () => {
    const out = shiftAfter(
      [free('f', at(10), at(10, 30)), block({ id: 'b', start: '10:30', end: '11:30', name: 'B' })],
      at(10),
      20
    )
    expect(lines(out)).toEqual(['free focus 10:20-10:30 Free', 'activity focus 10:30-11:30 B'])
  })

  it('drops a consumable rather than leaving an untappable sliver', () => {
    // 30m free absorbing 28 would leave 2 minutes; the whole block goes instead
    const out = shiftAfter(
      [free('f', at(10), at(10, 30)), block({ id: 'b', start: '10:30', end: '11:30', name: 'B' })],
      at(10),
      28
    )
    expect(lines(out)).toEqual(['activity focus 10:30-11:30 B'])
  })

  it('passes the remaining debt on when the consumable cannot cover it', () => {
    const out = shiftAfter(
      [free('f', at(10), at(10, 30)), block({ id: 'b', start: '10:30', end: '11:30', name: 'B' })],
      at(10),
      50
    )
    // the free block is consumed whole (30), leaving 20 for B
    expect(lines(out)).toEqual(['activity focus 10:50-11:50 B'])
  })

  it('absorbs into a break the same way', () => {
    const brk = block({
      id: 'k',
      kind: 'break',
      name: 'Break',
      activityId: null,
      start: '10:00',
      end: '10:10'
    })
    const out = shiftAfter([brk, block({ id: 'b', start: '10:10', end: '11:10' })], at(10), 5)
    expect(lines(out)).toEqual(['break focus 10:05-10:10 Break', 'activity focus 10:10-11:10 Work'])
  })

  it('is not an inverse — the consumed free block does not come back', () => {
    const input = [
      free('f', at(10), at(10, 30)),
      block({ id: 'b', start: '10:30', end: '11:30', name: 'B' })
    ]
    const there = shiftAfter(input, at(10), 20)
    const back = shiftAfter(there, at(10), -20)
    // the 20 minutes the free block gave up are gone for good: it stays 10 long
    // instead of returning to 30, and the day is now packed tighter than it began
    expect(lines(back)).toEqual(['free focus 10:00-10:10 Free', 'activity focus 10:10-11:10 B'])
    expect(lines(back)).not.toEqual(lines(input))
  })
})

describe('shiftAfter — routing round barriers', () => {
  it('pushes a block past an anchor it would land on, and propagates the surplus', () => {
    const out = shiftAfter(
      [
        anchor('p', at(11), at(11, 20)),
        block({ id: 'a', start: '10:00', end: '11:00', name: 'A' }),
        block({ id: 'b', start: '11:20', end: '12:20', name: 'B' })
      ],
      at(10),
      30
    )
    // A wants 10:30-11:30 but collides with Dhuhr, so it starts at 11:20;
    // that larger push carries through to B
    expect(lines(out)).toEqual([
      'anchor focus 11:00-11:20 Dhuhr',
      'activity focus 11:20-12:20 A',
      'activity focus 12:40-13:40 B'
    ])
  })
})

describe('shiftAfter — pulling earlier', () => {
  it('pulls later blocks back toward the mark', () => {
    const out = shiftAfter([block({ id: 'b', start: '11:00', end: '12:00' })], at(10), -30)
    expect(lines(out)).toEqual(['activity focus 10:30-11:30 Work'])
  })

  it('clamps at the mark rather than overshooting into the past', () => {
    const out = shiftAfter([block({ id: 'b', start: '11:00', end: '12:00' })], at(10), -180)
    expect(lines(out)).toEqual(['activity focus 10:00-11:00 Work'])
  })

  it('clamps at an intervening anchor', () => {
    const out = shiftAfter(
      [
        anchor('p', at(11), at(11, 20)),
        block({ id: 'b', start: '13:00', end: '14:00', name: 'B' })
      ],
      at(10),
      -180
    )
    expect(lines(out)).toEqual(['anchor focus 11:00-11:20 Dhuhr', 'activity focus 11:20-12:20 B'])
  })

  it('keeps order — two blocks cannot be pulled onto each other', () => {
    const out = shiftAfter(
      [
        block({ id: 'a', start: '12:00', end: '13:00', name: 'A' }),
        block({ id: 'b', start: '13:00', end: '14:00', name: 'B' })
      ],
      at(10),
      -180
    )
    expect(lines(out)).toEqual(['activity focus 10:00-11:00 A', 'activity focus 11:00-12:00 B'])
  })
})

describe('editBlock', () => {
  const base = [
    block({ id: 'a', start: '09:00', end: '10:00', name: 'A' }),
    block({ id: 'b', start: '10:00', end: '11:00', name: 'B' })
  ]

  it('moves a block and marks it manual', () => {
    const out = value(editBlock(base, 'b', { start: at(11), end: at(12) }, WINDOW))
    expect(lines(out)).toEqual(['activity focus 09:00-10:00 A', 'activity focus 11:00-12:00 B'])
    expect(out.find((x) => x.id === 'b')?.manual).toBe(true)
  })

  it('refuses a collision and names what is in the way', () => {
    const r = editBlock(base, 'b', { start: at(9, 30), end: at(10, 30) }, WINDOW)
    expect(r).toEqual({
      ok: false,
      error: { code: 'collision', withName: 'A', withStart: '09:00', withEnd: '10:00' }
    })
  })

  it('shifts the rest out of the way when ripple is asked for', () => {
    const out = value(
      editBlock(base, 'a', { start: at(9), end: at(10, 30) }, WINDOW, { ripple: true })
    )
    expect(lines(out)).toEqual(['activity focus 09:00-10:30 A', 'activity focus 10:30-11:30 B'])
  })

  it('always allows landing on free time, trimming it', () => {
    const withFree = [block({ id: 'a', start: '09:00', end: '10:00' }), free('f', at(10), at(12))]
    const out = value(editBlock(withFree, 'a', { start: at(9), end: at(11) }, WINDOW))
    expect(lines(out)).toEqual(['activity focus 09:00-11:00 Work', 'free focus 11:00-12:00 Free'])
  })

  it('splits a free block edited into its middle', () => {
    const withFree = [
      block({ id: 'a', start: '13:00', end: '14:00', name: 'Late' }),
      free('f', at(9), at(12))
    ]
    const out = value(
      editBlock(withFree, 'a', { start: at(10), end: at(11) }, WINDOW, { makeId: ids() })
    )
    expect(lines(out)).toEqual([
      'free focus 09:00-10:00 Free',
      'activity focus 10:00-11:00 Late',
      'free focus 11:00-12:00 Free'
    ])
  })

  it('absorbs a break the new span fully covers', () => {
    const withBreak = [
      block({ id: 'a', start: '09:00', end: '10:00', name: 'A' }),
      block({
        id: 'k',
        kind: 'break',
        name: 'Break',
        activityId: null,
        start: '10:00',
        end: '10:10'
      })
    ]
    const out = value(editBlock(withBreak, 'a', { start: at(9), end: at(10, 10) }, WINDOW))
    expect(lines(out)).toEqual(['activity focus 09:00-10:10 A'])
  })

  it('refuses anchors, breaks and settled blocks', () => {
    const blocks = [
      anchor('p', at(11), at(11, 20)),
      block({ id: 'd', start: '09:00', end: '10:00', status: 'done' })
    ]
    expect(editBlock(blocks, 'p', { start: at(12) }, WINDOW).ok).toBe(false)
    expect(editBlock(blocks, 'd', { start: at(12) }, WINDOW).ok).toBe(false)
  })

  it('refuses to rename generated backlog work', () => {
    const placed = [block({ id: 'x', backlogTaskId: 't1', name: 'Essay (2 of 3)' })]
    expect(editBlock(placed, 'x', { name: 'Something else' }, WINDOW)).toEqual({
      ok: false,
      error: { code: 'generated-name' }
    })
  })

  it('refuses an inverted span and one before the day starts', () => {
    expect(editBlock(base, 'b', { start: at(12), end: at(11) }, WINDOW).ok).toBe(false)
    expect(editBlock(base, 'b', { start: at(8), end: at(9) }, WINDOW).ok).toBe(false)
  })

  it('recomputes overflow rather than refusing to run past the day end', () => {
    const out = value(editBlock(base, 'b', { start: at(16), end: at(18) }, WINDOW))
    expect(out.find((x) => x.id === 'b')?.overflow).toBe(true)
  })
})

describe('insertBlock', () => {
  it('inserts into a gap', () => {
    const out = value(
      insertBlock(
        [block({ id: 'a', start: '09:00', end: '10:00', name: 'A' })],
        { name: 'New', lane: 'focus', start: at(11), end: at(12) },
        WINDOW,
        { makeId: ids() }
      )
    )
    expect(lines(out)).toEqual(['activity focus 09:00-10:00 A', 'activity focus 11:00-12:00 New'])
    expect(out.find((b) => b.name === 'New')).toMatchObject({ id: 'new1', manual: true })
  })

  it('refuses to overlap existing work unless rippled', () => {
    const base = [block({ id: 'a', start: '09:00', end: '10:00', name: 'A' })]
    const draft = { name: 'New', lane: 'focus' as const, start: at(10, 30), end: at(11, 30) }
    const collide = { ...draft, start: at(9, 30), end: at(10, 30) }
    expect(insertBlock(base, collide, WINDOW).ok).toBe(false)
    expect(lines(value(insertBlock(base, draft, WINDOW, { makeId: ids() })))).toEqual([
      'activity focus 09:00-10:00 A',
      'activity focus 10:30-11:30 New'
    ])
  })
})

describe('removeBlock', () => {
  const base = [
    block({ id: 'a', start: '09:00', end: '10:00', name: 'A' }),
    block({ id: 'b', start: '10:00', end: '11:00', name: 'B', backlogTaskId: 't1' })
  ]

  it('protects the vacated span so replan cannot immediately refill it', () => {
    const out = removeBlock(base, 'b', { vacate: 'free', makeId: ids() })
    expect(lines(out)).toEqual(['activity focus 09:00-10:00 A', 'free focus 10:00-11:00 Free'])
  })

  it('leaves a bare gap when asked to', () => {
    expect(lines(removeBlock(base, 'b', { vacate: 'gap' }))).toEqual([
      'activity focus 09:00-10:00 A'
    ])
  })

  it('merges the released span into free time beside it', () => {
    const withFree = [...base, free('f', at(11), at(12))]
    const out = removeBlock(withFree, 'b', { vacate: 'free', makeId: ids() })
    expect(lines(out)).toEqual(['activity focus 09:00-10:00 A', 'free focus 10:00-12:00 Free'])
  })
})

describe('extendBlock', () => {
  it('absorbs into free time without moving anything', () => {
    const blocks = [
      block({ id: 'a', start: '09:00', end: '10:00', name: 'A' }),
      free('f', at(10), at(10, 30)),
      block({ id: 'b', start: '10:30', end: '11:30', name: 'B' })
    ]
    const r = extendBlock(blocks, 'a', 20)
    expect(r).toMatchObject({ absorbed: 20, pushed: 0 })
    expect(lines(r.blocks)).toEqual([
      'activity focus 09:00-10:20 A',
      'free focus 10:20-10:30 Free',
      'activity focus 10:30-11:30 B'
    ])
  })

  it('pushes the day when there is nothing to absorb, and reports it', () => {
    const blocks = [
      block({ id: 'a', start: '09:00', end: '10:00', name: 'A' }),
      block({ id: 'b', start: '10:00', end: '11:00', name: 'B' })
    ]
    const r = extendBlock(blocks, 'a', 30)
    expect(r).toMatchObject({ absorbed: 0, pushed: 30 })
    expect(lines(r.blocks)).toEqual([
      'activity focus 09:00-10:30 A',
      'activity focus 10:30-11:30 B'
    ])
  })

  it('records the original length once, so repeated extensions keep the plan', () => {
    const blocks = [block({ id: 'a', start: '09:00', end: '10:00' })]
    const once = extendBlock(blocks, 'a', 15).blocks
    const twice = extendBlock(once, 'a', 15).blocks
    expect(twice[0]).toMatchObject({ end: '10:30', plannedMinutes: 60 })
  })
})

describe('spill', () => {
  const DAY_END = at(17)

  it('keeps a straddling head worth doing and spills only the tail', () => {
    const r = spill([block({ id: 'a', start: '16:00', end: '18:00', name: 'Essay' })], DAY_END)
    expect(lines(r.blocks)).toEqual(['activity focus 16:00-17:00 Essay'])
    expect(r.spilled).toEqual([
      { name: 'Essay', minutes: 60, backlogTaskId: null, activityId: 'a1' }
    ])
  })

  it('moves the whole block when the surviving head would be a sliver', () => {
    const r = spill([block({ id: 'a', start: '16:50', end: '18:00', name: 'Essay' })], DAY_END)
    expect(r.blocks).toEqual([])
    expect(r.spilled[0]).toMatchObject({ minutes: 70 })
  })

  it('drops protected time past the end rather than banking rest as a task', () => {
    const r = spill([free('f', at(16), at(18))], DAY_END)
    expect(lines(r.blocks)).toEqual(['free focus 16:00-17:00 Free'])
    expect(r.spilled).toEqual([])
  })

  it('never spills history or anchors', () => {
    const r = spill(
      [
        block({ id: 'd', start: '16:00', end: '18:00', name: 'Done', status: 'done' }),
        anchor('p', at(17, 30), at(17, 50))
      ],
      DAY_END
    )
    expect(r.spilled).toEqual([])
    expect(r.blocks).toHaveLength(2)
  })

  it('leaves a day that already fits completely alone', () => {
    const blocks = [block({ id: 'a', start: '09:00', end: '10:00' })]
    expect(spill(blocks, DAY_END)).toEqual({ blocks, spilled: [] })
  })
})

describe('bankSpilled', () => {
  const task = (over: Partial<BacklogTask> = {}): BacklogTask => ({
    id: 't1',
    text: 'Essay',
    priority: 2,
    estimateMinutes: 120,
    dueDate: null,
    done: false,
    completedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  })

  it('leaves placed work untouched — the planner reopens it by arithmetic', () => {
    // shortening the block already dropped `placed` by 60, so remaining grows by
    // 60 on its own. Raising the estimate here would schedule the work twice.
    const backlog = [task()]
    const out = bankSpilled(
      [{ name: 'Essay (2 of 2)', minutes: 60, backlogTaskId: 't1', activityId: null }],
      backlog
    )
    expect(out).toEqual(backlog)
  })

  it('mints a task for a generated activity block, which has nothing to reopen', () => {
    const out = bankSpilled(
      [{ name: 'Deep work', minutes: 45, backlogTaskId: null, activityId: 'act1' }],
      [],
      { makeId: ids('t'), now: '2026-08-07T00:00:00.000Z', priorityOf: () => 1 }
    )
    expect(out).toEqual([
      {
        id: 't1',
        text: 'Deep work',
        priority: 1,
        estimateMinutes: 45,
        dueDate: null,
        done: false,
        completedAt: null,
        createdAt: '2026-08-07T00:00:00.000Z'
      }
    ])
  })

  it('returns the backlog unchanged when nothing needs minting', () => {
    const backlog = [task()]
    expect(bankSpilled([], backlog)).toBe(backlog)
  })
})

describe('truncate', () => {
  it('shortens the block and protects the released span', () => {
    const blocks = [block({ id: 'a', start: '09:00', end: '10:00' })]
    const r = truncate(blocks, 'a', 40, { makeId: ids() })
    expect(r).toMatchObject({ freedMinutes: 20, freeBlockId: 'new1' })
    expect(lines(r.blocks)).toEqual([
      'activity focus 09:00-09:40 Work',
      'free focus 09:40-10:00 Free'
    ])
    expect(r.blocks[0]).toMatchObject({ actualMinutes: 40, plannedMinutes: 60 })
  })

  it('does nothing when the measured time is not shorter', () => {
    const blocks = [block({ id: 'a', start: '09:00', end: '10:00' })]
    expect(truncate(blocks, 'a', 60)).toMatchObject({ freedMinutes: 0, freeBlockId: null })
    expect(truncate(blocks, 'a', 90)).toMatchObject({ freedMinutes: 0, freeBlockId: null })
  })

  it('merges the released span into adjacent free time', () => {
    const blocks = [block({ id: 'a', start: '09:00', end: '10:00' }), free('f', at(10), at(11))]
    const r = truncate(blocks, 'a', 40, { makeId: ids() })
    expect(lines(r.blocks)).toEqual([
      'activity focus 09:00-09:40 Work',
      'free focus 09:40-11:00 Free'
    ])
  })
})
