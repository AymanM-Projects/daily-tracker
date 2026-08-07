import type { ActivitySet, AppData, DateKey, DayData, PrayerSettings, Settings } from './types'

/** Richmond, Virginia + ISNA + standard Asr, per the user's configuration. */
export function defaultPrayerSettings(): PrayerSettings {
  return {
    enabled: true,
    latitude: 37.5407,
    longitude: -77.436,
    method: 'isna',
    fajrAngle: 15,
    ishaAngle: 15,
    ishaInterval: null,
    asrFactor: 1,
    blockMinutes: 20,
    include: ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
  }
}

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
    activitySetId: null,
    recurringApplied: []
  }
}

export function getDay(data: AppData, date: DateKey): DayData {
  return data.days[date] ?? emptyDay()
}

export function defaultAppData(): AppData {
  return {
    version: 5,
    activeTimer: null,
    projects: [],
    activitySets: [defaultActivitySet()],
    activities: [],
    recurringTasks: [],
    backlog: [],
    prayer: defaultPrayerSettings(),
    settings: defaultSettings(),
    days: {}
  }
}
