import type { Activity, ActivityMode, BacklogTask, DateKey, Priority, Project } from './types'
import { isValidDateKey } from './time'

export type WriteResult<T> = { ok: true; value: T } | { ok: false; error: string }

function ok<T>(value: T): WriteResult<T> {
  return { ok: true, value }
}

function fail<T>(error: string): WriteResult<T> {
  return { ok: false, error }
}

function isValidPriority(value: number): value is Priority {
  return value === 1 || value === 2 || value === 3
}

/**
 * `IdFactory`/`now` are threaded through exactly like `bankSpilled` in
 * `reschedule.ts` — a default of `crypto.randomUUID()` / `new Date()` for real
 * callers, overridable in tests so assertions can pin the value instead of
 * asserting "is a uuid".
 */
type IdFactory = () => string

export interface CreateBacklogTaskInput {
  text: string
  /** 1 = high, 2 = medium, 3 = low. Defaults to 2. Validated as a plain number, not trusted as `Priority`. */
  priority?: number
  estimateMinutes?: number
  dueDate?: string
  projectId?: string
}

/**
 * Construct-and-append — the only shape an MCP write is allowed to take.
 * `done`/`completedAt` are hardcoded to their "just created" values and
 * nothing here ever flips them, so a mint can never double as a completion.
 *
 * Validates before appending: an unknown project, an out-of-range priority,
 * or a malformed date is a clear tool error, never silently dropped or
 * defaulted — the caller (an LLM) needs to know its request was rejected
 * rather than quietly mangled.
 */
export function createBacklogTask(
  backlog: BacklogTask[],
  projects: Project[],
  input: CreateBacklogTaskInput,
  now: string = new Date().toISOString(),
  makeId: IdFactory = () => crypto.randomUUID()
): WriteResult<{ backlog: BacklogTask[]; task: BacklogTask }> {
  const text = input.text?.trim()
  if (!text) return fail('text is required')

  const priority = input.priority ?? 2
  if (!isValidPriority(priority)) return fail('priority must be 1 (high), 2 (medium), or 3 (low)')

  if (input.estimateMinutes !== undefined && !(input.estimateMinutes > 0)) {
    return fail('estimateMinutes must be a positive number')
  }

  if (input.dueDate !== undefined && !isValidDateKey(input.dueDate)) {
    return fail(`dueDate must be a valid YYYY-MM-DD date, got "${input.dueDate}"`)
  }

  if (input.projectId !== undefined && !projects.some((p) => p.id === input.projectId)) {
    return fail(`no project with id "${input.projectId}"`)
  }

  const task: BacklogTask = {
    id: makeId(),
    text,
    priority,
    estimateMinutes: input.estimateMinutes ?? null,
    dueDate: (input.dueDate ?? null) as DateKey | null,
    projectId: input.projectId ?? null,
    done: false,
    completedAt: null,
    createdAt: now
  }
  return ok({ backlog: [...backlog, task], task })
}

export interface CreateActivityInput {
  name: string
  durationMinutes: number
  mode: ActivityMode
  priority?: number
  dueDate?: string
  projectId?: string
}

export function createActivity(
  activities: Activity[],
  projects: Project[],
  input: CreateActivityInput,
  now: string = new Date().toISOString(),
  makeId: IdFactory = () => crypto.randomUUID()
): WriteResult<{ activities: Activity[]; activity: Activity }> {
  const name = input.name?.trim()
  if (!name) return fail('name is required')

  if (!(input.durationMinutes > 0)) return fail('durationMinutes must be a positive number')

  if (input.mode !== 'focus' && input.mode !== 'background') {
    return fail('mode must be "focus" or "background"')
  }

  const priority = input.priority ?? 2
  if (!isValidPriority(priority)) return fail('priority must be 1 (high), 2 (medium), or 3 (low)')

  if (input.dueDate !== undefined && !isValidDateKey(input.dueDate)) {
    return fail(`dueDate must be a valid YYYY-MM-DD date, got "${input.dueDate}"`)
  }

  if (input.projectId !== undefined && !projects.some((p) => p.id === input.projectId)) {
    return fail(`no project with id "${input.projectId}"`)
  }

  const activity: Activity = {
    id: makeId(),
    name,
    durationMinutes: input.durationMinutes,
    priority,
    mode: input.mode,
    dueDate: (input.dueDate ?? null) as DateKey | null,
    projectId: input.projectId ?? null,
    createdAt: now
  }
  return ok({ activities: [...activities, activity], activity })
}

export interface CreateProjectInput {
  name: string
  deadline?: string
  targetHoursPerWeek?: number
}

/** Creating a `Project` this way is structurally no different from a task or activity — an inert record, zero side effects. */
export function createProject(
  projects: Project[],
  input: CreateProjectInput,
  now: string = new Date().toISOString(),
  makeId: IdFactory = () => crypto.randomUUID()
): WriteResult<{ projects: Project[]; project: Project }> {
  const name = input.name?.trim()
  if (!name) return fail('name is required')

  if (input.deadline !== undefined && !isValidDateKey(input.deadline)) {
    return fail(`deadline must be a valid YYYY-MM-DD date, got "${input.deadline}"`)
  }

  if (input.targetHoursPerWeek !== undefined && !(input.targetHoursPerWeek > 0)) {
    return fail('targetHoursPerWeek must be a positive number')
  }

  const project: Project = {
    id: makeId(),
    name,
    deadline: (input.deadline ?? null) as DateKey | null,
    targetHoursPerWeek: input.targetHoursPerWeek ?? null,
    archived: false,
    createdAt: now
  }
  return ok({ projects: [...projects, project], project })
}
