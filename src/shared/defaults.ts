import type { AppData, DateKey, DayData, Settings } from './types'

export function defaultSettings(): Settings {
  return {
    dayStart: '09:00',
    dayEnd: '17:00',
    breaksEnabled: true,
    breakMinutes: 10,
    alwaysOnTop: false
  }
}

export function emptyDay(): DayData {
  return {
    checklist: [],
    journal: [],
    schedule: null,
    unscheduled: null
  }
}

export function getDay(data: AppData, date: DateKey): DayData {
  return data.days[date] ?? emptyDay()
}

export function defaultAppData(): AppData {
  return {
    version: 1,
    activities: [],
    settings: defaultSettings(),
    days: {}
  }
}
