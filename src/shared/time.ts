import type { DateKey } from './types'

/** Local date key 'YYYY-MM-DD' */
export function todayKey(d: Date = new Date()): DateKey {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'HH:mm' -> minutes since midnight */
export function parseHM(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/** minutes since midnight -> 'HH:mm' (wraps past 24h) */
export function formatHM(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  const h = String(Math.floor(wrapped / 60)).padStart(2, '0')
  const m = String(wrapped % 60).padStart(2, '0')
  return `${h}:${m}`
}

/**
 * 'HH:mm' -> '9:00 AM', for display only.
 *
 * Deliberately separate from `formatHM`, which is the STORAGE format: block
 * start/end are persisted as 24-hour strings and read back with `parseHM`.
 * Rendering 12-hour must never change what is written to disk.
 */
export function formatClock(hm: string): string {
  return formatClockMinutes(parseHM(hm))
}

/** minutes since midnight -> '9:00 AM' */
export function formatClockMinutes(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440
  const h24 = Math.floor(wrapped / 60)
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(wrapped % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** Current local time in minutes since midnight */
export function minutesNow(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes()
}

/** Shift a date key by whole days (negative = past) */
export function shiftDateKey(key: DateKey, deltaDays: number): DateKey {
  const [y, m, d] = key.split('-').map(Number)
  return todayKey(new Date(y, m - 1, d + deltaDays))
}

/** 'Wed, Aug 6' style label for a date key */
export function formatDateLabel(key: DateKey): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}

/** Day of the week for a date key, 0 = Sunday */
export function weekdayOf(key: DateKey): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** How many days the key's month has — day 0 of the next month is the last of this one */
export function daysInMonth(key: DateKey): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** '45m', '1h', '2h 15m' — compact enough for a dense pane */
export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes))
  if (safe < 60) return `${safe}m`
  const h = Math.floor(safe / 60)
  const m = safe % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** ISO timestamp -> local 'HH:mm' */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return formatHM(d.getHours() * 60 + d.getMinutes())
}
