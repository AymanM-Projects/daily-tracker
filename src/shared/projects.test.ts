import { describe, expect, it } from 'vitest'
import type { Activity, BacklogTask, DayData, Project, ScheduleBlock } from './types'
import { projectProgress } from './projects'

const TODAY = '2026-08-10'

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Learn Spanish',
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
    name: 'Duolingo',
    durationMinutes: 30,
    priority: 2,
    mode: 'focus',
    dueDate: null,
    projectId: 'p1',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

function task(over: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: 't1',
    text: 'Practice verbs',
    priority: 2,
    estimateMinutes: 30,
    dueDate: null,
    projectId: 'p1',
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
    name: 'Duolingo',
    start: '09:00',
    end: '09:30',
    overflow: false,
    status: 'done',
    actualMinutes: 30,
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
    schedule: [],
    unscheduled: null,
    activitySetId: null,
    recurringApplied: [],
    carriedForward: false,
    ...over
  }
}

describe('projectProgress — deadline math', () => {
  it('reports null with no deadline', () => {
    expect(projectProgress(project(), [], [], {}, TODAY).daysUntilDeadline).toBeNull()
  })

  it('counts days remaining to a future deadline', () => {
    const p = project({ deadline: '2026-08-15' })
    expect(projectProgress(p, [], [], {}, TODAY).daysUntilDeadline).toBe(5)
  })

  it('goes negative for an already-overdue deadline', () => {
    const p = project({ deadline: '2026-08-05' })
    expect(projectProgress(p, [], [], {}, TODAY).daysUntilDeadline).toBe(-5)
  })

  it('reports zero for a deadline that is today', () => {
    const p = project({ deadline: TODAY })
    expect(projectProgress(p, [], [], {}, TODAY).daysUntilDeadline).toBe(0)
  })
})

describe('projectProgress — task counts', () => {
  it('counts only backlog tasks linked to this project', () => {
    const tasks = [
      task({ id: 't1', projectId: 'p1', done: true }),
      task({ id: 't2', projectId: 'p1', done: false }),
      task({ id: 't3', projectId: 'p2', done: true })
    ]
    const r = projectProgress(project(), [], tasks, {}, TODAY)
    expect(r.tasksTotal).toBe(2)
    expect(r.tasksDone).toBe(1)
  })

  it('reports zero of zero when nothing is linked', () => {
    const r = projectProgress(project(), [], [], {}, TODAY)
    expect(r.tasksTotal).toBe(0)
    expect(r.tasksDone).toBe(0)
  })

  it('excludes an unlinked task entirely, not just from the done count', () => {
    const tasks = [task({ id: 't1', projectId: null })]
    const r = projectProgress(project(), [], tasks, {}, TODAY)
    expect(r.tasksTotal).toBe(0)
  })
})

describe('projectProgress — minutes logged this week', () => {
  it('sums actual minutes across the rolling 7-day window, in and out of range', () => {
    const days: Record<string, DayData> = {
      '2026-08-10': day({ schedule: [block({ id: 'b1', actualMinutes: 30 })] }), // offset 0
      '2026-08-04': day({ schedule: [block({ id: 'b2', actualMinutes: 20 })] }), // offset 6, still in
      '2026-08-03': day({ schedule: [block({ id: 'b3', actualMinutes: 99 })] }) // offset 7, out
    }
    const r = projectProgress(project(), [activity()], [], days, TODAY)
    expect(r.minutesLoggedThisWeek).toBe(50)
  })

  it('skips a block with no measured minutes', () => {
    const days: Record<string, DayData> = {
      [TODAY]: day({ schedule: [block({ actualMinutes: null })] })
    }
    expect(projectProgress(project(), [activity()], [], days, TODAY).minutesLoggedThisWeek).toBe(0)
  })

  it("excludes another project's blocks", () => {
    const other = activity({ id: 'a2', projectId: 'p2' })
    const days: Record<string, DayData> = {
      [TODAY]: day({ schedule: [block({ activityId: 'a2', actualMinutes: 45 })] })
    }
    expect(projectProgress(project(), [other], [], days, TODAY).minutesLoggedThisWeek).toBe(0)
  })

  it('resolves backlog-placed work through backlogTaskId, not just activityId', () => {
    const t = task({ id: 't1', projectId: 'p1' })
    const days: Record<string, DayData> = {
      [TODAY]: day({
        schedule: [block({ activityId: null, backlogTaskId: 't1', actualMinutes: 25 })]
      })
    }
    expect(projectProgress(project(), [], [t], days, TODAY).minutesLoggedThisWeek).toBe(25)
  })

  it('resolves at read time — a block for a task later unlinked from the project no longer counts', () => {
    const t = task({ id: 't1', projectId: null }) // used to be linked, isn't any more
    const days: Record<string, DayData> = {
      [TODAY]: day({
        schedule: [block({ activityId: null, backlogTaskId: 't1', actualMinutes: 25 })]
      })
    }
    expect(projectProgress(project(), [], [t], days, TODAY).minutesLoggedThisWeek).toBe(0)
  })

  it('ignores a day outside the window entirely, including a day with no schedule', () => {
    const days: Record<string, DayData> = { '2026-07-01': day({ schedule: [block()] }) }
    expect(projectProgress(project(), [activity()], [], days, TODAY).minutesLoggedThisWeek).toBe(0)
  })
})

describe('projectProgress — weekly target', () => {
  it('is null when no target is set', () => {
    expect(projectProgress(project(), [], [], {}, TODAY).targetMinutesPerWeek).toBeNull()
  })

  it('converts target hours per week into minutes', () => {
    const r = projectProgress(project({ targetHoursPerWeek: 5 }), [], [], {}, TODAY)
    expect(r.targetMinutesPerWeek).toBe(300)
  })
})
