import type { DateKey, PrayerName, PrayerSettings } from './types'

/**
 * Prayer times from solar geometry. Hand-written rather than a package, per the
 * repo's no-dependency rule, and pure so it can be checked against a published
 * timetable without launching anything.
 *
 * Timezone handling deliberately leans on the platform: `Date.getTimezoneOffset()`
 * already returns -5h in January and -4h in August for America/New_York, so DST
 * needs no table. This assumes the machine's clock is set to the same zone the
 * user prays in — true for a laptop you carry to school, wrong if you fly.
 */

const DEG = Math.PI / 180
const SUNSET_ANGLE = 0.833 // sun's disc radius plus atmospheric refraction

/** Fajr and Isha twilight angles by method. Isha is an angle unless `ishaInterval` is set. */
export const PRAYER_METHODS = {
  isna: { label: 'ISNA', fajrAngle: 15, ishaAngle: 15, ishaInterval: null },
  mwl: { label: 'Muslim World League', fajrAngle: 18, ishaAngle: 17, ishaInterval: null },
  ummAlQura: { label: 'Umm al-Qura', fajrAngle: 18.5, ishaAngle: null, ishaInterval: 90 },
  egyptian: { label: 'Egyptian', fajrAngle: 19.5, ishaAngle: 17.5, ishaInterval: null },
  karachi: { label: 'Karachi', fajrAngle: 18, ishaAngle: 18, ishaInterval: null }
} as const

export type PrayerMethod = keyof typeof PRAYER_METHODS

/** Days since the J2000.0 epoch at 00:00 UT on the given calendar date. */
function julianDay(year: number, month: number, day: number): number {
  let y = year
  let m = month
  if (m <= 2) {
    y -= 1
    m += 12
  }
  const a = Math.floor(y / 100)
  const b = 2 - a + Math.floor(a / 4)
  return (
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5 - 2451545.0
  )
}

/** Low-precision solar position — well under a minute of error, which is all this needs. */
function solarPosition(d: number): { declination: number; equationOfTime: number } {
  const meanLongitude = (280.46646 + 0.98564736 * d) % 360
  const meanAnomaly = (357.52911 + 0.98560028 * d) % 360
  const eclipticLongitude =
    meanLongitude +
    1.914602 * Math.sin(meanAnomaly * DEG) +
    0.019993 * Math.sin(2 * meanAnomaly * DEG)
  const obliquity = 23.439291 - 0.0000004 * d

  const declination = Math.asin(Math.sin(obliquity * DEG) * Math.sin(eclipticLongitude * DEG)) / DEG

  let rightAscension =
    Math.atan2(
      Math.cos(obliquity * DEG) * Math.sin(eclipticLongitude * DEG),
      Math.cos(eclipticLongitude * DEG)
    ) / DEG
  rightAscension = ((rightAscension % 360) + 360) % 360
  // wrapped into [-180, 180) so the equation of time stays a small signed value
  const equationOfTime = (((meanLongitude - rightAscension + 540) % 360) - 180) * 4

  return { declination, equationOfTime }
}

/**
 * Hour angle, in hours, for the sun sitting `angle` degrees below the horizon.
 * Null inside polar day or night, where no such moment exists.
 */
function hourAngle(angle: number, latitude: number, declination: number): number | null {
  const cosH =
    (Math.sin(-angle * DEG) - Math.sin(latitude * DEG) * Math.sin(declination * DEG)) /
    (Math.cos(latitude * DEG) * Math.cos(declination * DEG))
  if (cosH > 1 || cosH < -1) return null
  return Math.acos(cosH) / DEG / 15
}

/** Hour angle for Asr, when an object's shadow reaches `factor` times its own length. */
function asrHourAngle(factor: number, latitude: number, declination: number): number | null {
  const angle = -Math.atan(1 / (factor + Math.tan(Math.abs(latitude - declination) * DEG))) / DEG
  return hourAngle(angle, latitude, declination)
}

/**
 * Prayer times for a local calendar date, as minutes since local midnight.
 *
 * Computed in UT and shifted by the machine's own offset for that date, so the
 * EST/EDT changeover is handled without a timezone table.
 */
export function prayerTimes(
  date: DateKey,
  settings: PrayerSettings
): { name: PrayerName; minutes: number }[] {
  const [year, month, day] = date.split('-').map(Number)
  const { latitude, longitude } = settings

  const d = julianDay(year, month, day)
  const { declination, equationOfTime } = solarPosition(d)

  const offsetMinutes = -new Date(year, month - 1, day, 12, 0, 0).getTimezoneOffset()
  const solarNoonUT = 12 - longitude / 15 - equationOfTime / 60
  const toLocal = (utHours: number): number =>
    Math.round((((utHours * 60 + offsetMinutes) % 1440) + 1440) % 1440)

  const sunriseH = hourAngle(SUNSET_ANGLE, latitude, declination)
  const fajrH = hourAngle(settings.fajrAngle, latitude, declination)
  const asrH = asrHourAngle(settings.asrFactor, latitude, declination)

  const times: { name: PrayerName; minutes: number }[] = []
  const push = (name: PrayerName, utHours: number): void => {
    times.push({ name, minutes: toLocal(utHours) })
  }

  // At extreme latitudes twilight may never arrive; fall back to an hour off
  // sunrise/sunset so the day still gets a usable, clearly-approximate anchor.
  push('Fajr', solarNoonUT - (fajrH ?? (sunriseH !== null ? sunriseH + 1 : 6)))
  push('Dhuhr', solarNoonUT)
  if (asrH !== null) push('Asr', solarNoonUT + asrH)

  const maghribUT = solarNoonUT + (sunriseH ?? 6)
  push('Maghrib', maghribUT)

  if (settings.ishaInterval !== null) {
    push('Isha', maghribUT + settings.ishaInterval / 60)
  } else {
    const ishaH = hourAngle(settings.ishaAngle ?? 15, latitude, declination)
    push('Isha', solarNoonUT + (ishaH ?? (sunriseH ?? 6) + 1))
  }

  return times
}

/** Sunrise as minutes since local midnight — used to sanity-check a day's ordering. */
export function sunriseMinutes(date: DateKey, settings: PrayerSettings): number | null {
  const [year, month, day] = date.split('-').map(Number)
  const d = julianDay(year, month, day)
  const { declination, equationOfTime } = solarPosition(d)
  const h = hourAngle(SUNSET_ANGLE, settings.latitude, declination)
  if (h === null) return null
  const offsetMinutes = -new Date(year, month - 1, day, 12, 0, 0).getTimezoneOffset()
  const ut = 12 - settings.longitude / 15 - equationOfTime / 60 - h
  return Math.round((((ut * 60 + offsetMinutes) % 1440) + 1440) % 1440)
}
