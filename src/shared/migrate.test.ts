import { describe, expect, it } from 'vitest'
import { CURRENT_VERSION, migrate } from './migrate'

/** A realistic v1 document: the shape the app shipped with. */
function v1Fixture(): Record<string, unknown> {
  return {
    version: 1,
    activities: [
      {
        id: 'act-1',
        name: 'Deep work',
        durationMinutes: 90,
        priority: 1,
        mode: 'focus',
        createdAt: '2026-08-06T14:00:00.000Z'
      }
    ],
    settings: {
      dayStart: '16:00',
      dayEnd: '22:00',
      breaksEnabled: false,
      breakMinutes: 10,
      alwaysOnTop: true
    },
    days: {
      '2026-08-06': {
        checklist: [
          {
            id: 'chk-1',
            text: 'Ship it',
            done: true,
            createdAt: '2026-08-06T14:00:00.000Z',
            completedAt: '2026-08-06T15:00:00.000Z'
          }
        ],
        journal: [
          {
            id: 'jrn-1',
            kind: 'auto',
            text: 'Completed: Ship it',
            timestamp: '2026-08-06T15:00:00.000Z',
            checklistItemId: 'chk-1'
          }
        ],
        schedule: [
          {
            id: 'blk-1',
            kind: 'activity',
            lane: 'focus',
            activityId: 'act-1',
            name: 'Deep work',
            start: '16:00',
            end: '17:30',
            overflow: false
          }
        ],
        unscheduled: []
      }
    }
  }
}

describe('migrate v1 -> current', () => {
  const out = migrate(v1Fixture())

  it('lands on the current version', () => {
    expect(out.version).toBe(CURRENT_VERSION)
  })

  it('seeds a Default set carrying the original day window', () => {
    expect(out.activitySets).toHaveLength(1)
    const set = out.activitySets[0]
    expect(set.name).toBe('Default')
    expect(set.isDefault).toBe(true)
    expect(set.dayStart).toBe('16:00')
    expect(set.dayEnd).toBe('22:00')
    expect(set.breaksEnabled).toBe(false)
    expect(set.activityIds).toEqual(['act-1'])
  })

  it('backfills the new fields without undefined', () => {
    expect(out.projects).toEqual([])
    expect(out.activeTimer).toBeNull()
    expect(out.activities[0].projectId).toBeNull()
    const day = out.days['2026-08-06']
    expect(day.activitySetId).toBeNull()
    expect(day.schedule?.[0].status).toBe('planned')
    expect(day.schedule?.[0].actualMinutes).toBeNull()
    // nothing anywhere should be literally undefined once serialized
    expect(JSON.stringify(out)).not.toContain('undefined')
  })

  it('loses no existing data', () => {
    const day = out.days['2026-08-06']
    expect(out.activities[0].name).toBe('Deep work')
    expect(out.activities[0].durationMinutes).toBe(90)
    // v6 moved the per-day checklist into the standing backlog
    expect(out.backlog[0].text).toBe('Ship it')
    expect(out.backlog[0].dueDate).toBe('2026-08-06')
    expect(day.journal[0].checklistItemId).toBe('chk-1')
    expect(day.schedule?.[0].start).toBe('16:00')
    expect(out.settings.alwaysOnTop).toBe(true)
  })
})

describe('migrate is idempotent', () => {
  it('leaves an already-current document unchanged', () => {
    const once = migrate(v1Fixture())
    const twice = migrate(JSON.parse(JSON.stringify(once)))
    expect(twice).toEqual(once)
  })
})

describe('migrate v2 -> v3', () => {
  it('adds block status and actualMinutes to an existing v2 document', () => {
    const v2 = migrate(v1Fixture()) as unknown as Record<string, unknown>
    // rewind to a v2-shaped document: v2 had no timer and no block status
    const days = JSON.parse(JSON.stringify(v2.days))
    delete days['2026-08-06'].schedule[0].status
    delete days['2026-08-06'].schedule[0].actualMinutes
    const rewound: Record<string, unknown> = { ...v2, version: 2, days }
    delete rewound.activeTimer

    const out = migrate(rewound)
    // the chain always runs to the end, so a v2 document lands on CURRENT_VERSION
    expect(out.version).toBe(CURRENT_VERSION)
    expect(out.activeTimer).toBeNull()
    expect(out.days['2026-08-06'].schedule?.[0].status).toBe('planned')
    expect(out.days['2026-08-06'].schedule?.[0].actualMinutes).toBeNull()
  })

  it('preserves a schedule that was never generated', () => {
    const out = migrate({
      version: 2,
      projects: [],
      activitySets: [],
      activities: [],
      settings: {},
      days: { '2026-08-06': { checklist: [], journal: [], schedule: null, unscheduled: null } }
    })
    expect(out.days['2026-08-06'].schedule).toBeNull()
  })
})

describe('migrate v3 -> v4', () => {
  /** A v3 document with one done and one open checklist item. */
  function v3Fixture(): Record<string, unknown> {
    return {
      version: 3,
      activeTimer: null,
      projects: [],
      activitySets: [],
      activities: [],
      settings: {},
      days: {
        '2026-08-06': {
          checklist: [
            { id: 'c1', text: 'Ship it', done: true, createdAt: 'x', completedAt: 'y' },
            { id: 'c2', text: 'Write tests', done: false, createdAt: 'x', completedAt: null }
          ],
          journal: [{ id: 'j1', kind: 'manual', text: 'note', timestamp: 'x' }],
          schedule: null,
          unscheduled: null,
          activitySetId: null
        }
      }
    }
  }

  it('adds recurring rules and carries checklist items through to the backlog', () => {
    const out = migrate(v3Fixture())
    expect(out.version).toBe(CURRENT_VERSION)
    expect(out.recurringTasks).toEqual([])
    expect(out.days['2026-08-06'].recurringApplied).toEqual([])

    // v4 stamped these onto the checklist; v6 then moved them into the backlog,
    // so the end state of the chain is where the assertion belongs
    expect(out.backlog.map((t) => t.estimateMinutes)).toEqual([null, null])
    expect(out.backlog.every((t) => t.dueDate === '2026-08-06')).toBe(true)
    expect(out.days['2026-08-06'].checklist).toEqual([])
  })

  it('loses nothing it does not understand', () => {
    const out = migrate(v3Fixture())
    expect(out.backlog[0].text).toBe('Ship it')
    expect(out.backlog[0].done).toBe(true)
    expect(out.backlog[0].completedAt).toBe('y')
    expect(out.backlog[1].done).toBe(false)
    expect(out.days['2026-08-06'].journal[0].text).toBe('note')
  })

  it('does not re-stamp values a newer document already has', () => {
    const doc = v3Fixture()
    const days = doc.days as Record<string, Record<string, unknown>>
    const checklist = days['2026-08-06'].checklist as Record<string, unknown>[]
    checklist[0].estimateMinutes = 25

    // the estimate set on the v3 document survives all the way into the backlog
    expect(migrate(doc).backlog[0].estimateMinutes).toBe(25)
  })

  it('moves items from several days into one backlog, each keeping its date', () => {
    const out = migrate({
      version: 5,
      days: {
        '2026-08-05': {
          checklist: [{ id: 'a', text: 'Yesterday', done: false, estimateMinutes: 30 }],
          journal: [],
          schedule: null,
          unscheduled: null
        },
        '2026-08-06': {
          checklist: [{ id: 'b', text: 'Today', done: false, estimateMinutes: null }],
          journal: [],
          schedule: null,
          unscheduled: null
        }
      }
    })
    expect(out.backlog.map((t) => `${t.text}@${t.dueDate}`)).toEqual([
      'Yesterday@2026-08-05',
      'Today@2026-08-06'
    ])
    // per-day lists are emptied, not deleted — the field still exists
    expect(out.days['2026-08-05'].checklist).toEqual([])
    expect(out.backlog.every((t) => t.priority === 2)).toBe(true)
  })

  it('stamps backlogTaskId onto existing schedule blocks', () => {
    const out = migrate({
      version: 5,
      days: {
        '2026-08-06': {
          checklist: [],
          journal: [],
          schedule: [
            { id: 'b1', kind: 'activity', name: 'Deep work', start: '09:00', end: '10:00' }
          ],
          unscheduled: null
        }
      }
    })
    expect(out.days['2026-08-06'].schedule?.[0].backlogTaskId).toBeNull()
    expect(out.days['2026-08-06'].schedule?.[0].name).toBe('Deep work')
  })

  it('keeps a recurring link when moving an item across', () => {
    const out = migrate({
      version: 5,
      days: {
        '2026-08-06': {
          checklist: [
            { id: 'r', text: 'Bins', done: false, estimateMinutes: 10, recurringTaskId: 'rule-1' }
          ],
          journal: [],
          schedule: null,
          unscheduled: null
        }
      }
    })
    expect(out.backlog[0].recurringTaskId).toBe('rule-1')
  })

  it('survives a day with no checklist array at all', () => {
    const out = migrate({
      version: 3,
      days: { '2026-08-06': { journal: [], schedule: null, unscheduled: null } }
    })
    expect(out.days['2026-08-06'].checklist).toEqual([])
    expect(out.days['2026-08-06'].recurringApplied).toEqual([])
  })
})
