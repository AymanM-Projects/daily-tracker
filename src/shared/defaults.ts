import type { ActivitySet, AppData, DateKey, DayData, Settings } from './types'

export function defaultSettings(): Settings {
  return {
    dayStart: '09:00',
    dayEnd: '17:00',
    breaksEnabled: true,
    breakMinutes: 10,
    alwaysOnTop: false
  }
}

/**
 * The set every document starts with. Window values are passed in so a migration
 * can carry the user's existing settings across instead of resetting them.
 */
export function defaultActivitySet(
  activityIds: string[] = [],
  window: Pick<Settings, 'dayStart' | 'dayEnd' | 'breaksEnabled'> = defaultSettings()
): ActivitySet {
  return {
    id: crypto.randomUUID(),
    name: 'Default',
    activityIds,
    dayStart: window.dayStart,
    dayEnd: window.dayEnd,
    breaksEnabled: window.breaksEnabled,
    isDefault: true,
    createdAt: new Date().toISOString()
  }
}

export function emptyDay(): DayData {
  return {
    checklist: [],
    journal: [],
    schedule: null,
    unscheduled: null,
    activitySetId: null
  }
}

export function getDay(data: AppData, date: DateKey): DayData {
  return data.days[date] ?? emptyDay()
}

export function defaultAppData(): AppData {
  return {
    version: 3,
    activeTimer: null,
    projects: [],
    activitySets: [defaultActivitySet()],
    activities: [],
    settings: defaultSettings(),
    days: {}
  }
}
