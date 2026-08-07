import type { AppData } from './types'
import { defaultActivitySet, defaultPrayerSettings, defaultSettings } from './defaults'

/**
 * Bump this whenever the on-disk shape changes, and add a matching step to the
 * chain in `migrate()`. `src/main/store.ts` backs the file up before applying.
 */
export const CURRENT_VERSION = 10

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
 * v7 adds protected free time, hand-edited (manual) blocks, the end-of-block
 * prompt stamp, and the day-wide pause.
 *
 * No free blocks are created retroactively. Regeneration is manual, so a day
 * that has already been generated keeps exactly the shape the user last saw
 * until they press the button — a migration is the wrong place to rewrite a
 * schedule someone may already be partway through.
 */
function v6ToV7(data: AnyData): AnyData {
  const days = asRecord(data.days)

  return {
    ...data,
    version: 7,
    dayPause: data.dayPause ?? null,
    // defaults first, so a field written by a newer build is never clobbered
    settings: { ...defaultSettings(), ...asRecord(data.settings) },
    days: Object.fromEntries(
      Object.entries(days).map(([key, day]) => [
        key,
        {
          ...day,
          schedule: Array.isArray(day.schedule)
            ? (day.schedule as AnyData[]).map((b) => ({
                ...b,
                manual: b.manual ?? false,
                promptedAt: b.promptedAt ?? null,
                plannedMinutes: b.plannedMinutes ?? null
              }))
            : day.schedule
        }
      ])
    )
  }
}

/**
 * v8 adds the theme choice. Nothing else moves: `defaultSettings()` supplies
 * 'system', which is what every existing document was already doing implicitly.
 */
function v7ToV8(data: AnyData): AnyData {
  return {
    ...data,
    version: 8,
    settings: { ...defaultSettings(), ...asRecord(data.settings) }
  }
}

/**
 * v9 adds daily routines, activity deadlines, and the carry-forward sweep.
 *
 * `carriedForward` is set to TRUE on every day that already exists. The sweep in
 * shared/carry.ts turns unfinished blocks into backlog work, so defaulting these
 * to false would make the first launch after this upgrade harvest months of
 * history at once and bury the backlog under work the user has long since moved
 * past. Only days created from here on are swept.
 *
 * No routines are invented, and no activity gains a deadline — both start empty,
 * which is exactly the behaviour every existing document already had.
 */
function v8ToV9(data: AnyData): AnyData {
  const days = asRecord(data.days)

  return {
    ...data,
    version: 9,
    routines: data.routines ?? [],
    activities: asArray(data.activities).map((a) => ({
      ...(a as AnyData),
      dueDate: (a as AnyData).dueDate ?? null
    })),
    days: Object.fromEntries(
      Object.entries(days).map(([key, day]) => [
        key,
        {
          ...day,
          carriedForward: day.carriedForward ?? true,
          schedule: Array.isArray(day.schedule)
            ? (day.schedule as AnyData[]).map((b) => ({
                ...b,
                anchorSource: b.anchorSource ?? null
              }))
            : day.schedule
        }
      ])
    )
  }
}

/**
 * v10 adds the autopilot switch. Nothing else moves: `defaultSettings()` supplies
 * `true`, so an existing document starts running its day the first time it is
 * opened — which is the point of the feature, and reversible from Settings.
 */
function v9ToV10(data: AnyData): AnyData {
  return {
    ...data,
    version: 10,
    settings: { ...defaultSettings(), ...asRecord(data.settings) }
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
  if ((data.version as number) === 6) data = v6ToV7(data)
  if ((data.version as number) === 7) data = v7ToV8(data)
  if ((data.version as number) === 8) data = v8ToV9(data)
  if ((data.version as number) === 9) data = v9ToV10(data)
  return data as unknown as AppData
}
