import { describe, expect, it } from 'vitest'
import type { Routine } from './types'
import { appliesOn, routineAnchors } from './routines'

function routine(over: Partial<Routine> = {}): Routine {
  return {
    id: 'r1',
    name: 'Lunch',
    start: '12:30',
    durationMinutes: 45,
    weekdays: [],
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over
  }
}

/** 'name start-end' in minutes, flat enough to read at a glance */
function flat(anchors: { name: string; start: number; end: number }[]): string[] {
  return anchors.map((a) => `${a.name} ${a.start}-${a.end}`)
}

// 2026-08-06 is a Thursday (weekday 4); 2026-08-09 is a Sunday (0)
const THURSDAY = '2026-08-06'
const SUNDAY = '2026-08-09'

describe('appliesOn', () => {
  it('applies every day when no weekdays are picked', () => {
    expect(appliesOn(routine(), THURSDAY)).toBe(true)
    expect(appliesOn(routine(), SUNDAY)).toBe(true)
  })

  it('applies only on the weekdays it names', () => {
    const weekdaysOnly = routine({ weekdays: [1, 2, 3, 4, 5] })
    expect(appliesOn(weekdaysOnly, THURSDAY)).toBe(true)
    expect(appliesOn(weekdaysOnly, SUNDAY)).toBe(false)
  })

  it('never applies while paused', () => {
    expect(appliesOn(routine({ active: false }), THURSDAY)).toBe(false)
  })
})

describe('routineAnchors', () => {
  it('turns a routine into an anchor spanning its duration', () => {
    expect(flat(routineAnchors([routine()], THURSDAY))).toEqual(['Lunch 750-795'])
  })

  it('marks every anchor as coming from a routine, for the timeline icon', () => {
    expect(routineAnchors([routine()], THURSDAY).map((a) => a.source)).toEqual(['routine'])
  })

  it('returns them in time order regardless of how they were entered', () => {
    const list = [
      routine({ id: 'd', name: 'Dinner', start: '19:00', durationMinutes: 60 }),
      routine({ id: 'w', name: 'Wake', start: '06:30', durationMinutes: 30 }),
      routine({ id: 'l' })
    ]
    expect(flat(routineAnchors(list, THURSDAY))).toEqual([
      'Wake 390-420',
      'Lunch 750-795',
      'Dinner 1140-1200'
    ])
  })

  it('drops routines that do not apply today', () => {
    const list = [
      routine({ weekdays: [0] }),
      routine({ id: 'r2', name: 'Wake', start: '06:30', durationMinutes: 30, weekdays: [4] })
    ]
    expect(flat(routineAnchors(list, THURSDAY))).toEqual(['Wake 390-420'])
  })

  it('drops a paused routine', () => {
    expect(routineAnchors([routine({ active: false })], THURSDAY)).toEqual([])
  })

  it('drops a zero-length routine rather than emitting an anchor that occupies nothing', () => {
    expect(routineAnchors([routine({ durationMinutes: 0 })], THURSDAY)).toEqual([])
  })

  it('handles an empty list', () => {
    expect(routineAnchors([], THURSDAY)).toEqual([])
  })
})
