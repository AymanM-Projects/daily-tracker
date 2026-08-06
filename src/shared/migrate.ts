import type { AppData } from './types'
import { defaultActivitySet, defaultSettings } from './defaults'

/**
 * Bump this whenever the on-disk shape changes, and add a matching step to the
 * chain in `migrate()`. `src/main/store.ts` backs the file up before applying.
 */
export const CURRENT_VERSION = 3

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
 * Upgrades a parsed document to CURRENT_VERSION. Steps run in sequence, so a
 * document several versions behind walks through each one in turn.
 */
export function migrate(raw: AnyData): AppData {
  let data = raw
  if (((data.version as number) ?? 1) === 1) data = v1ToV2(data)
  if ((data.version as number) === 2) data = v2ToV3(data)
  // future: if (data.version === 3) data = v3ToV4(data)
  return data as unknown as AppData
}
