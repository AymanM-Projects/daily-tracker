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
    expect(day.checklist[0].text).toBe('Ship it')
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
    expect(out.version).toBe(3)
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
