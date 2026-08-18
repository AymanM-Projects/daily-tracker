import { describe, expect, it } from 'vitest'
import type {
  Activity,
  AppData,
  BacklogTask,
  DayData,
  JournalEntry,
  Project,
  RecurringTask,
  Routine
} from './types'
import { defaultAppData } from './defaults'
import {
  getContextBundle,
  listActivities,
  listBacklogTasks,
  listJournalEntries,
  listProjects
} from './mcpContext'

const TODAY = '2026-08-10'

function entry(over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'e1',
    kind: 'manual',
    text: 'did a thing',
    timestamp: '2026-08-10T12:00:00.000Z',
    ...over
  }
}

function day(over: Partial<DayData> = {}): DayData {
  return {
    checklist: [],
    journal: [],
    schedule: null,
    unscheduled: null,
    activitySetId: null,
    recurringApplied: [],
    carriedForward: false,
    ...over
  }
}

function task(over: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: 't1',
    text: 'Task',
    priority: 2,
    estimateMinutes: null,
    dueDate: null,
    projectId: null,
    done: false,
    completedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Proj',
    deadline: null,
    targetHoursPerWeek: null,
    archived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

function activity(over: Partial<Activity> = {}): Activity {
  return {
    id: 'a1',
    name: 'Act',
    durationMinutes: 30,
    priority: 2,
    mode: 'focus',
    dueDate: null,
    projectId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

function routine(over: Partial<Routine> = {}): Routine {
  return {
    id: 'r1',
    name: 'Lunch',
    start: '12:00',
    durationMinutes: 30,
    weekdays: [],
    active: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

function recurringTask(over: Partial<RecurringTask> = {}): RecurringTask {
  return {
    id: 'rt1',
    text: 'Water plants',
    estimateMinutes: null,
    freq: 'daily',
    weekdays: [],
    dayOfMonth: 1,
    active: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

function withData(patch: Partial<AppData>): AppData {
  return { ...defaultAppData(), ...patch }
}

describe('listJournalEntries', () => {
  it('includes entries within the inclusive range, attaching each date', () => {
    const data = withData({
      days: {
        '2026-08-09': day({ journal: [entry({ id: 'e1' })] }),
        '2026-08-10': day({ journal: [entry({ id: 'e2' })] }),
        '2026-08-11': day({ journal: [entry({ id: 'e3' })] })
      }
    })
    const result = listJournalEntries(data, '2026-08-09', '2026-08-10')
    expect(result.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(result[0].date).toBe('2026-08-09')
  })

  it('sorts entries by timestamp across days', () => {
    const data = withData({
      days: {
        '2026-08-10': day({
          journal: [entry({ id: 'late', timestamp: '2026-08-10T18:00:00.000Z' })]
        }),
        '2026-08-09': day({
          journal: [entry({ id: 'early', timestamp: '2026-08-09T08:00:00.000Z' })]
        })
      }
    })
    const result = listJournalEntries(data, '2026-08-09', '2026-08-10')
    expect(result.map((e) => e.id)).toEqual(['early', 'late'])
  })

  it('excludes days outside the range', () => {
    const data = withData({ days: { '2026-08-01': day({ journal: [entry()] }) } })
    expect(listJournalEntries(data, '2026-08-09', '2026-08-10')).toEqual([])
  })
})

describe('listBacklogTasks', () => {
  it('excludes done tasks by default', () => {
    const data = withData({
      backlog: [task({ id: 't1', done: true }), task({ id: 't2', done: false })]
    })
    expect(listBacklogTasks(data).map((t) => t.id)).toEqual(['t2'])
  })

  it('includes done tasks when asked', () => {
    const data = withData({ backlog: [task({ id: 't1', done: true })] })
    expect(listBacklogTasks(data, { includeDone: true }).map((t) => t.id)).toEqual(['t1'])
  })

  it('filters by projectId, including an explicit null for unlinked tasks', () => {
    const data = withData({
      backlog: [
        task({ id: 't1', projectId: 'p1' }),
        task({ id: 't2', projectId: null }),
        task({ id: 't3', projectId: 'p2' })
      ]
    })
    expect(listBacklogTasks(data, { projectId: 'p1' }).map((t) => t.id)).toEqual(['t1'])
    expect(listBacklogTasks(data, { projectId: null }).map((t) => t.id)).toEqual(['t2'])
  })
})

describe('listProjects', () => {
  it('excludes archived projects by default', () => {
    const data = withData({
      projects: [project({ id: 'p1', archived: true }), project({ id: 'p2', archived: false })]
    })
    expect(listProjects(data).map((p) => p.id)).toEqual(['p2'])
  })

  it('includes archived projects when asked', () => {
    const data = withData({ projects: [project({ id: 'p1', archived: true })] })
    expect(listProjects(data, { includeArchived: true }).map((p) => p.id)).toEqual(['p1'])
  })
})

describe('listActivities', () => {
  it('filters by mode', () => {
    const data = withData({
      activities: [
        activity({ id: 'a1', mode: 'focus' }),
        activity({ id: 'a2', mode: 'background' })
      ]
    })
    expect(listActivities(data, { mode: 'focus' }).map((a) => a.id)).toEqual(['a1'])
  })

  it('filters by projectId, including an explicit null for unlinked activities', () => {
    const data = withData({
      activities: [activity({ id: 'a1', projectId: 'p1' }), activity({ id: 'a2', projectId: null })]
    })
    expect(listActivities(data, { projectId: 'p1' }).map((a) => a.id)).toEqual(['a1'])
    expect(listActivities(data, { projectId: null }).map((a) => a.id)).toEqual(['a2'])
  })
})

describe('getContextBundle', () => {
  it('defaults to a 7-day journal window ending on today, inclusive', () => {
    const data = withData({
      days: {
        '2026-08-04': day({
          journal: [entry({ id: 'in', timestamp: '2026-08-04T00:00:00.000Z' })]
        }), // offset 6
        '2026-08-03': day({
          journal: [entry({ id: 'out', timestamp: '2026-08-03T00:00:00.000Z' })]
        }) // offset 7
      }
    })
    expect(getContextBundle(data, TODAY).journal.map((e) => e.id)).toEqual(['in'])
  })

  it('respects a narrower days window', () => {
    const data = withData({ days: { '2026-08-09': day({ journal: [entry()] }) } })
    expect(getContextBundle(data, TODAY, { days: 1 }).journal).toEqual([])
  })

  it('excludes done backlog tasks unless includeCompleted is set', () => {
    const data = withData({ backlog: [task({ id: 't1', done: true })] })
    expect(getContextBundle(data, TODAY).backlogTasks).toEqual([])
    expect(getContextBundle(data, TODAY, { includeCompleted: true }).backlogTasks).toHaveLength(1)
  })

  it('excludes archived projects', () => {
    const data = withData({ projects: [project({ archived: true })] })
    expect(getContextBundle(data, TODAY).projects).toEqual([])
  })

  it('excludes inactive routines and recurring tasks', () => {
    const data = withData({
      routines: [routine({ id: 'r1', active: true }), routine({ id: 'r2', active: false })],
      recurringTasks: [
        recurringTask({ id: 'rt1', active: true }),
        recurringTask({ id: 'rt2', active: false })
      ]
    })
    const bundle = getContextBundle(data, TODAY)
    expect(bundle.routines.map((r) => r.id)).toEqual(['r1'])
    expect(bundle.recurringTasks.map((r) => r.id)).toEqual(['rt1'])
  })
})
