import { describe, expect, it } from 'vitest'
import type { Activity, BacklogTask, Project } from './types'
import { createActivity, createBacklogTask, createProject } from './mcpWrites'

const NOW = '2026-08-10T12:00:00.000Z'
let counter = 0
const makeId = (): string => `id-${++counter}`

function task(over: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: 't1',
    text: 'Existing',
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

function activity(over: Partial<Activity> = {}): Activity {
  return {
    id: 'a1',
    name: 'Existing',
    durationMinutes: 30,
    priority: 2,
    mode: 'focus',
    dueDate: null,
    projectId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Existing',
    deadline: null,
    targetHoursPerWeek: null,
    archived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over
  }
}

describe('createBacklogTask', () => {
  it('appends a new task without touching the existing ones', () => {
    const existing = [task({ id: 't1' }), task({ id: 't2', done: true })]
    const result = createBacklogTask(existing, [], { text: 'New task' }, NOW, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.backlog.slice(0, 2)).toEqual(existing)
    expect(result.value.backlog).toHaveLength(3)
    expect(result.value.task.text).toBe('New task')
    expect(result.value.task.done).toBe(false)
    expect(result.value.task.priority).toBe(2)
    expect(result.value.task.createdAt).toBe(NOW)
  })

  it('defaults priority to 2 and rejects an out-of-range value', () => {
    const withPriority = createBacklogTask([], [], { text: 'x', priority: 1 }, NOW, makeId)
    expect(withPriority.ok && withPriority.value.task.priority).toBe(1)

    const bad = createBacklogTask([], [], { text: 'x', priority: 4 }, NOW, makeId)
    expect(bad).toEqual({ ok: false, error: expect.stringContaining('priority') })
  })

  it('rejects empty or whitespace-only text', () => {
    expect(createBacklogTask([], [], { text: '   ' }, NOW, makeId).ok).toBe(false)
  })

  it('rejects a malformed dueDate', () => {
    const result = createBacklogTask([], [], { text: 'x', dueDate: '2026-13-40' }, NOW, makeId)
    expect(result).toEqual({ ok: false, error: expect.stringContaining('dueDate') })
  })

  it('rejects an unknown projectId', () => {
    const result = createBacklogTask(
      [],
      [project({ id: 'p1' })],
      { text: 'x', projectId: 'p2' },
      NOW,
      makeId
    )
    expect(result.ok).toBe(false)
  })

  it('accepts a known projectId', () => {
    const result = createBacklogTask(
      [],
      [project({ id: 'p1' })],
      { text: 'x', projectId: 'p1' },
      NOW,
      makeId
    )
    expect(result.ok && result.value.task.projectId).toBe('p1')
  })

  it('rejects a non-positive estimate', () => {
    expect(createBacklogTask([], [], { text: 'x', estimateMinutes: 0 }, NOW, makeId).ok).toBe(false)
  })
})

describe('createActivity', () => {
  it('appends a new activity without touching the existing ones', () => {
    const existing = [activity({ id: 'a1' })]
    const result = createActivity(
      existing,
      [],
      { name: 'New', durationMinutes: 45, mode: 'focus' },
      NOW,
      makeId
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.activities[0]).toEqual(existing[0])
    expect(result.value.activities).toHaveLength(2)
    expect(result.value.activity.mode).toBe('focus')
    expect(result.value.activity.priority).toBe(2)
  })

  it('rejects an invalid mode', () => {
    const result = createActivity(
      [],
      [],
      { name: 'x', durationMinutes: 10, mode: 'sometimes' as never },
      NOW,
      makeId
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a non-positive duration', () => {
    expect(
      createActivity([], [], { name: 'x', durationMinutes: 0, mode: 'focus' }, NOW, makeId).ok
    ).toBe(false)
  })

  it('rejects an out-of-range priority', () => {
    const result = createActivity(
      [],
      [],
      { name: 'x', durationMinutes: 10, mode: 'focus', priority: 0 },
      NOW,
      makeId
    )
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown projectId', () => {
    const result = createActivity(
      [],
      [project({ id: 'p1' })],
      { name: 'x', durationMinutes: 10, mode: 'focus', projectId: 'nope' },
      NOW,
      makeId
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a malformed dueDate', () => {
    const result = createActivity(
      [],
      [],
      { name: 'x', durationMinutes: 10, mode: 'focus', dueDate: 'not-a-date' },
      NOW,
      makeId
    )
    expect(result.ok).toBe(false)
  })
})

describe('createProject', () => {
  it('appends a new project without touching the existing ones, always unarchived', () => {
    const existing = [project({ id: 'p1', archived: true })]
    const result = createProject(existing, { name: 'New project' }, NOW, makeId)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.projects[0]).toEqual(existing[0])
    expect(result.value.projects).toHaveLength(2)
    expect(result.value.project.archived).toBe(false)
    expect(result.value.project.deadline).toBeNull()
    expect(result.value.project.targetHoursPerWeek).toBeNull()
  })

  it('rejects an empty name', () => {
    expect(createProject([], { name: '' }, NOW, makeId).ok).toBe(false)
  })

  it('rejects a malformed deadline', () => {
    expect(createProject([], { name: 'x', deadline: 'not-a-date' }, NOW, makeId).ok).toBe(false)
  })

  it('rejects a non-positive targetHoursPerWeek', () => {
    expect(createProject([], { name: 'x', targetHoursPerWeek: -1 }, NOW, makeId).ok).toBe(false)
  })

  it('accepts a valid deadline and target', () => {
    const result = createProject(
      [],
      { name: 'x', deadline: '2026-12-25', targetHoursPerWeek: 5 },
      NOW,
      makeId
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.project.deadline).toBe('2026-12-25')
    expect(result.value.project.targetHoursPerWeek).toBe(5)
  })
})

describe('append-only guarantee', () => {
  it('never sets done true on a created backlog task, or archived true on a created project', () => {
    const t = createBacklogTask([], [], { text: 'x' }, NOW, makeId)
    const p = createProject([], { name: 'x' }, NOW, makeId)
    expect(t.ok && t.value.task.done).toBe(false)
    expect(p.ok && p.value.project.archived).toBe(false)
  })

  it('leaves a pre-existing done task completely unchanged after an append', () => {
    const doneTasks = [task({ id: 'done1', done: true, completedAt: '2026-08-01T00:00:00.000Z' })]
    const result = createBacklogTask(doneTasks, [], { text: 'new' }, NOW, makeId)
    expect(result.ok && result.value.backlog[0]).toEqual(doneTasks[0])
  })

  it('leaves a pre-existing archived project completely unchanged after an append', () => {
    const archivedProjects = [project({ id: 'arch1', archived: true })]
    const result = createProject(archivedProjects, { name: 'new' }, NOW, makeId)
    expect(result.ok && result.value.projects[0]).toEqual(archivedProjects[0])
  })

  it('rejects rather than silently drops or defaults an invalid field', () => {
    // a bad request must come back as an error, not a task/activity/project
    // minted with the bad field quietly stripped or coerced
    const badTask = createBacklogTask([], [], { text: 'x', priority: 99 }, NOW, makeId)
    const badActivity = createActivity(
      [],
      [],
      { name: 'x', durationMinutes: -5, mode: 'focus' },
      NOW,
      makeId
    )
    const badProject = createProject([], { name: 'x', deadline: '2026-02-30' }, NOW, makeId)
    expect(badTask.ok).toBe(false)
    expect(badActivity.ok).toBe(false)
    expect(badProject.ok).toBe(false)
  })
})
