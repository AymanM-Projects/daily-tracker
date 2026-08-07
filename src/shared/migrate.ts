import type { AppData } from './types'
import { defaultActivitySet, defaultPrayerSettings, defaultSettings } from './defaults'

/**
 * Bump this whenever the on-disk shape changes, and add a matching step to the
 * chain in `migrate()`. `src/main/store.ts` backs the file up before applying.
 */
export const CURRENT_VERSION = 6

type AnyData = Record<string, unknown>

function asArray(value: unknown): AnyData[] {
  return Array.isArray(value) ? (value as AnyData[]) : []
}

function asRecord(value: unknown): Record<string, AnyData> {
  return value && typeof value === 'object' ? (value as Record<string, AnyData>) : {}
}

/**
 * v1 had no projects and no activity sets, and one global day window on `settings`.
 * v2 introduces both, seeding a single "Default" set that carries the window the
 * user already had so their schedule keeps generating identically.
 *
 * Every object is spread, so fields this migration doesn't know about survive.
 */
function v1ToV2(data: AnyData): AnyData {
  const activities = asArray(data.activities)
  const settings = { ...defaultSettings(), ...asRecord(data.settings) }
  const days = asRecord(data.days)

  return {
    ...data,
    version: 2,
    projects: asArray(data.projects),
    activitySets: [
      defaultActivitySet(
        activities.map((a) => String(a.id)),
        {
          dayStart: String(settings.dayStart),
          dayEnd: String(settings.dayEnd),
          breaksEnabled: Boolean(settings.breaksEnabled)
        }
      )
    ],
    activities: activities.map((a) => ({ ...a, projectId: a.projectId ?? null })),
    days: Object.fromEntries(
      Object.entries(days).map(([key, day]) => [
        key,
        { ...day, activitySetId: day.activitySetId ?? null }
      ])
    )
  }
}

/**
 * v2 recorded only what the user intended to do. v3 adds the fields that record
 * what actually happened — per-block status and measured duration — plus the
 * resumable timer that produces them.
 */
function v2ToV3(data: AnyData): AnyData {
  const days = asRecord(data.days)

  return {
    ...data,
    version: 3,
    activeTimer: data.activeTimer ?? null,
    days: Object.fromEntries(
      Object.entries(days).map(([key, day]) => {
        const schedule = day.schedule
        return [
          key,
          {
            ...day,
            schedule: Array.isArray(schedule)
              ? (schedule as AnyData[]).map((b) => ({
                  ...b,
                  status: b.status ?? 'planned',
                  actualMinutes: b.actualMinutes ?? null
                }))
              : schedule
          }
        ]
      })
    )
  }
}

/**
 * v4 adds recurring checklist rules and per-task time estimates.
 *
 * `source` is stamped explicitly rather than left undefined: reconciliation
 * distinguishes items the user typed from ones a rule produced, and an absent
 * field would make every existing task look machine-generated. `scheduleBlockId`
 * is deliberately part of this shape though nothing writes it yet — the
 * block↔checklist link lands next, and one migration is cheaper than two.
 */
function v3ToV4(data: AnyData): AnyData {
  const days = asRecord(data.days)

  return {
    ...data,
    version: 4,
    recurringTasks: asArray(data.recurringTasks),
    days: Object.fromEntries(
      Object.entries(days).map(([key, day]) => [
        key,
        {
          ...day,
          recurringApplied: asArray(day.recurringApplied).map(String),
          checklist: asArray(day.checklist).map((item) => ({
            ...item,
            estimateMinutes: item.estimateMinutes ?? null,
            source: item.source ?? 'manual'
          }))
        }
      ])
    )
  }
}

/**
 * v5 adds prayer settings, so the generator can route work around fixed
 * obligations instead of scheduling straight over them.
 *
 * `backlog` is created empty here even though nothing reads it yet: the standing
 * task list lands next and will only need to *move* data, not also add a field.
 * Existing settings are spread over the defaults so a partially-written prayer
 * block from a future build is never clobbered.
 */
function v4ToV5(data: AnyData): AnyData {
  return {
    ...data,
    version: 5,
    backlog: asArray(data.backlog),
    prayer: { ...defaultPrayerSettings(), ...asRecord(data.prayer) }
  }
}

/**
 * v6 turns the per-day checklist into a standing backlog. Tasks stop belonging
 * to a date and instead carry an optional due date, so unfinished work survives
 * the day instead of dying with it.
 *
 * Items are MOVED, not copied: each keeps its text, estimate and recurring link,
 * and gains `dueDate` set to the day it used to live on so nothing loses its
 * context. Priority defaults to medium because per-day items never had one.
 * `day.checklist` is emptied rather than deleted, so a half-read older build
 * still finds the field it expects.
 */
function v5ToV6(data: AnyData): AnyData {
  const days = asRecord(data.days)
  const backlog = asArray(data.backlog)

  for (const [date, day] of Object.entries(days)) {
    for (const item of asArray(day.checklist)) {
      backlog.push({
        id: item.id,
        text: item.text,
        priority: 2,
        estimateMinutes: item.estimateMinutes ?? null,
        dueDate: date,
        done: Boolean(item.done),
        completedAt: item.completedAt ?? null,
        createdAt: item.createdAt ?? new Date().toISOString(),
        ...(item.recurringTaskId ? { recurringTaskId: item.recurringTaskId } : {})
      })
    }
  }

  return {
    ...data,
    version: 6,
    backlog,
    days: Object.fromEntries(
      Object.entries(days).map(([key, day]) => [
        key,
        {
          ...day,
          checklist: [],
          schedule: Array.isArray(day.schedule)
            ? (day.schedule as AnyData[]).map((b) => ({
                ...b,
                backlogTaskId: b.backlogTaskId ?? null
              }))
            : day.schedule
        }
      ])
    )
  }
}

/**
 * Upgrades a parsed document to CURRENT_VERSION. Steps run in sequence, so a
 * document several versions behind walks through each one in turn.
 */
export function migrate(raw: AnyData): AppData {
  let data = raw
  if (((data.version as number) ?? 1) === 1) data = v1ToV2(data)
  if ((data.version as number) === 2) data = v2ToV3(data)
  if ((data.version as number) === 3) data = v3ToV4(data)
  if ((data.version as number) === 4) data = v4ToV5(data)
  if ((data.version as number) === 5) data = v5ToV6(data)
  return data as unknown as AppData
}
