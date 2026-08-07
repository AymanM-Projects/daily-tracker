import { describe, expect, it } from 'vitest'
import type { AppData, ScheduleBlock } from './types'
import { defaultAppData } from './defaults'
import { buildWidgetSummary, trayTitle } from './widget'

const KEY = '2026-08-06'

/** A local wall-clock instant on the day above. */
function at(hm: string): Date {
  const [h, m] = hm.split(':').map(Number)
  return new Date(2026, 7, 6, h, m, 0, 0)
}

function block(over: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: 'b1',
    kind: 'activity',
    lane: 'focus',
    activityId: 'a1',
    backlogTaskId: null,
    name: 'Homework',
    start: '16:00',
    end: '17:00',
    overflow: false,
    status: 'planned',
    actualMinutes: null,
    ...over
  }
}

function withSchedule(blocks: ScheduleBlock[] | null): AppData {
  const data = defaultAppData()
  data.days[KEY] = {
    checklist: [],
    journal: [],
    schedule: blocks,
    unscheduled: null,
    activitySetId: null,
    recurringApplied: []
  }
  return data
}

describe('buildWidgetSummary', () => {
  it('reports the clock in 12-hour form', () => {
    const s = buildWidgetSummary(withSchedule(null), at('16:05'))
    expect(s.clock).toBe('4:05')
    expect(s.meridiem).toBe('PM')

    const midnight = buildWidgetSummary(withSchedule(null), at('00:07'))
    expect(midnight.clock).toBe('12:07')
    expect(midnight.meridiem).toBe('AM')
  })

  it('flags a day with no generated schedule', () => {
    const s = buildWidgetSummary(withSchedule(null), at('16:30'))
    expect(s.hasSchedule).toBe(false)
    expect(s.dayComplete).toBe(false)
    expect(s.now).toEqual([])
    expect(s.next).toBeNull()
  })

  it('picks the block spanning now, with remaining minutes and progress', () => {
    const s = buildWidgetSummary(withSchedule([block()]), at('16:45'))
    expect(s.now).toHaveLength(1)
    expect(s.now[0].name).toBe('Homework')
    expect(s.now[0].minutesAway).toBe(15)
    expect(s.now[0].progress).toBeCloseTo(0.75)
  })

  it('surfaces both lanes at once, since they overlap by design', () => {
    const s = buildWidgetSummary(
      withSchedule([
        block(),
        block({ id: 'b2', lane: 'parallel', name: '3D print', start: '16:00', end: '18:30' })
      ]),
      at('16:45')
    )
    expect(s.now.map((b) => b.lane)).toEqual(['focus', 'parallel'])
    expect(s.now[1].minutesAway).toBe(105)
  })

  it('excludes done and skipped blocks from now and next', () => {
    const s = buildWidgetSummary(
      withSchedule([
        block({ status: 'done', actualMinutes: 42 }),
        block({ id: 'b2', name: 'Read', start: '17:00', end: '17:30', status: 'skipped' })
      ]),
      at('16:45')
    )
    expect(s.now).toEqual([])
    expect(s.next).toBeNull()
    expect(s.dayComplete).toBe(true)
  })

  it('chooses the soonest upcoming block across lanes', () => {
    const s = buildWidgetSummary(
      withSchedule([
        block({ id: 'b2', name: 'Later', start: '18:00', end: '19:00' }),
        block({ id: 'b3', lane: 'parallel', name: 'Sooner', start: '17:00', end: '17:30' })
      ]),
      at('16:45')
    )
    expect(s.next?.name).toBe('Sooner')
    expect(s.next?.minutesAway).toBe(15)
    expect(s.next?.progress).toBe(0)
  })

  it('treats an end that wrapped past midnight as forward-going', () => {
    const s = buildWidgetSummary(
      withSchedule([block({ start: '23:30', end: '00:30', overflow: true })]),
      at('23:50')
    )
    expect(s.now).toHaveLength(1)
    expect(s.now[0].minutesAway).toBe(40)
  })

  it('attaches the running timer with the block name', () => {
    const data = withSchedule([block()])
    data.activeTimer = {
      dateKey: KEY,
      blockId: 'b1',
      startedAt: at('16:40').toISOString(),
      accumulatedMs: 0,
      paused: false
    }
    expect(buildWidgetSummary(data, at('16:45')).timer).toEqual({
      blockId: 'b1',
      name: 'Homework',
      display: '5:00',
      paused: false
    })
  })

  it('ignores a timer left over from another day', () => {
    const data = withSchedule([block()])
    data.activeTimer = {
      dateKey: '2026-08-05',
      blockId: 'b1',
      startedAt: at('16:40').toISOString(),
      accumulatedMs: 0,
      paused: false
    }
    expect(buildWidgetSummary(data, at('16:45')).timer).toBeNull()
  })

  it('counts the whole backlog, not just today', () => {
    const data = withSchedule(null)
    data.backlog = [
      {
        id: 'c1',
        text: 'a',
        priority: 2,
        estimateMinutes: null,
        dueDate: KEY,
        done: true,
        completedAt: null,
        createdAt: ''
      },
      {
        id: 'c2',
        text: 'b',
        priority: 2,
        estimateMinutes: null,
        dueDate: null, // an undated "someday" task still counts
        done: false,
        completedAt: null,
        createdAt: ''
      }
    ]
    expect(buildWidgetSummary(data, at('16:45')).checklist).toEqual({ done: 1, total: 2 })
  })
})

describe('trayTitle', () => {
  it('prefers a running timer', () => {
    const data = withSchedule([block()])
    data.activeTimer = {
      dateKey: KEY,
      blockId: 'b1',
      startedAt: at('16:40').toISOString(),
      accumulatedMs: 0,
      paused: false
    }
    expect(trayTitle(buildWidgetSummary(data, at('16:45')))).toBe('5:00')
    data.activeTimer.paused = true
    expect(trayTitle(buildWidgetSummary(data, at('16:45')))).toBe('paused')
  })

  it('falls back to minutes left on the focus block', () => {
    expect(trayTitle(buildWidgetSummary(withSchedule([block()]), at('16:45')))).toBe('15m')
  })

  it('stays empty when only a parallel block is running', () => {
    const s = buildWidgetSummary(withSchedule([block({ lane: 'parallel' })]), at('16:45'))
    expect(trayTitle(s)).toBe('')
  })

  it('stays empty on a day with no schedule', () => {
    expect(trayTitle(buildWidgetSummary(withSchedule(null), at('16:45')))).toBe('')
  })
})
