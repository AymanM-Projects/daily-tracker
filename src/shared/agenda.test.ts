import { describe, expect, it } from 'vitest'
import type { ScheduleBlock } from './types'
import { blockAt, nextTransition } from './agenda'

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

const at = (hm: string): number => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

describe('blockAt', () => {
  it('finds the block the clock is inside', () => {
    expect(blockAt([block()], at('09:30'))?.name).toBe('Deep work')
  })

  it('includes the first minute and excludes the last', () => {
    expect(blockAt([block()], at('09:00'))?.name).toBe('Deep work')
    expect(blockAt([block()], at('10:00'))).toBeNull()
  })

  it('returns nothing before the day starts or after it ends', () => {
    expect(blockAt([block()], at('08:59'))).toBeNull()
    expect(blockAt([block()], at('11:00'))).toBeNull()
  })

  it('prefers focus over a parallel block running at the same time', () => {
    const both = [
      block({ id: 'p', lane: 'parallel', name: '3D print' }),
      block({ id: 'f', lane: 'focus', name: 'Deep work' })
    ]
    expect(blockAt(both, at('09:30'))?.name).toBe('Deep work')
  })

  it('falls back to the parallel block when nothing is in the focus lane', () => {
    const only = [block({ id: 'p', lane: 'parallel', name: '3D print' })]
    expect(blockAt(only, at('09:30'))?.name).toBe('3D print')
  })

  it('counts breaks and anchors — they were asked for too', () => {
    expect(blockAt([block({ kind: 'break', name: 'Break' })], at('09:30'))?.name).toBe('Break')
    expect(blockAt([block({ kind: 'anchor', name: 'Dhuhr' })], at('09:30'))?.name).toBe('Dhuhr')
  })

  it('never counts free time — rest is not a task you can fall behind on', () => {
    expect(blockAt([block({ kind: 'free', name: 'Free' })], at('09:30'))).toBeNull()
  })

  it('ignores a block already settled or skipped', () => {
    expect(blockAt([block({ status: 'done' })], at('09:30'))).toBeNull()
    expect(blockAt([block({ status: 'skipped' })], at('09:30'))).toBeNull()
    expect(blockAt([block({ status: 'partial' })], at('09:30'))).toBeNull()
  })

  it('handles a block running past midnight', () => {
    const overnight = block({ start: '23:00', end: '00:30' })
    expect(blockAt([overnight], at('23:30'))?.name).toBe('Deep work')
  })
})

describe('nextTransition', () => {
  it('announces the start of the next block', () => {
    const t = nextTransition([block()], at('08:00'))
    expect(`${t?.kind} ${t?.atMinute} ${t?.title}`).toBe('start 540 Deep work')
  })

  it('announces the end of the block currently running', () => {
    const t = nextTransition([block()], at('09:30'))
    expect(`${t?.kind} ${t?.atMinute} ${t?.title}`).toBe("end 600 Deep work — time's up")
  })

  it('prefers the arriving block when one ends exactly as another starts', () => {
    const day = [
      block({ id: 'a' }),
      block({ id: 'b', name: 'Reading', start: '10:00', end: '11:00' })
    ]
    const t = nextTransition(day, at('09:30'))
    expect(`${t?.kind} ${t?.block.name}`).toBe('start Reading')
  })

  it('returns the soonest of several upcoming blocks', () => {
    const day = [
      block({ id: 'late', name: 'Late', start: '15:00', end: '16:00' }),
      block({ id: 'soon', name: 'Soon', start: '11:00', end: '12:00' })
    ]
    expect(nextTransition(day, at('10:00'))?.block.name).toBe('Soon')
  })

  it('says nothing once the day is behind us', () => {
    expect(nextTransition([block()], at('18:00'))).toBeNull()
  })

  it('skips free time, and settled or skipped blocks', () => {
    const day = [
      block({ id: 'f', kind: 'free', start: '11:00', end: '12:00' }),
      block({ id: 'd', status: 'done', start: '13:00', end: '14:00' }),
      block({ id: 's', status: 'skipped', start: '14:00', end: '15:00' })
    ]
    expect(nextTransition(day, at('10:00'))).toBeNull()
  })

  it('words a break differently from real work', () => {
    const day = [block({ kind: 'break', name: 'Break', start: '10:00', end: '10:10' })]
    expect(nextTransition(day, at('09:00'))?.title).toBe('Break')
    expect(nextTransition(day, at('10:05'))?.title).toBe('Break over')
  })

  it('handles an overnight block by unwrapping its end', () => {
    const t = nextTransition([block({ start: '23:00', end: '00:30' })], at('23:30'))
    expect(`${t?.kind} ${t?.atMinute}`).toBe('end 1470')
  })
})
