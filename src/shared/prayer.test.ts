import { describe, expect, it } from 'vitest'
import type { PrayerSettings } from './types'
import { prayerTimes, sunriseMinutes } from './prayer'

/** Richmond, Virginia + ISNA + standard Asr — the user's actual configuration. */
function richmond(over: Partial<PrayerSettings> = {}): PrayerSettings {
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
    include: ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'],
    ...over
  }
}

const at = (date: string, name: string, s = richmond()): number =>
  prayerTimes(date, s).find((t) => t.name === name)!.minutes

const hm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// The ground-truth cases assume America/New_York — that the platform supplies
// the DST offset is the whole point of the design, so they are gated, not faked.
const IS_EASTERN = Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York'

describe('prayerTimes ordering', () => {
  const DATES = ['2026-01-15', '2026-03-20', '2026-06-21', '2026-08-06', '2026-12-21']

  it('keeps Fajr < sunrise < Dhuhr < Asr < Maghrib < Isha all year', () => {
    for (const date of DATES) {
      const t = prayerTimes(date, richmond())
      const get = (n: string): number => t.find((x) => x.name === n)!.minutes
      const sunrise = sunriseMinutes(date, richmond())!
      expect(get('Fajr'), `${date} Fajr before sunrise`).toBeLessThan(sunrise)
      expect(sunrise, `${date} sunrise before Dhuhr`).toBeLessThan(get('Dhuhr'))
      expect(get('Dhuhr'), `${date} Dhuhr before Asr`).toBeLessThan(get('Asr'))
      expect(get('Asr'), `${date} Asr before Maghrib`).toBeLessThan(get('Maghrib'))
      expect(get('Maghrib'), `${date} Maghrib before Isha`).toBeLessThan(get('Isha'))
    }
  })

  it('returns all five prayers in order', () => {
    expect(prayerTimes('2026-08-06', richmond()).map((t) => t.name)).toEqual([
      'Fajr',
      'Dhuhr',
      'Asr',
      'Maghrib',
      'Isha'
    ])
  })
})

describe.runIf(IS_EASTERN)('against known Richmond VA sun times', () => {
  // Sunrise and sunset are the checkable ground truth. Invariants alone would
  // not catch a sign error in the declination or a longitude flipped east.
  it('matches the summer solstice', () => {
    expect(hm(sunriseMinutes('2026-06-21', richmond())!)).toBe('05:49') // published ~5:51 AM
    expect(hm(at('2026-06-21', 'Maghrib'))).toBe('20:34') // published sunset ~8:33 PM
  })

  it('matches the winter solstice', () => {
    expect(hm(sunriseMinutes('2026-12-21', richmond())!)).toBe('07:21') // published ~7:22 AM
    expect(hm(at('2026-12-21', 'Maghrib'))).toBe('16:55') // published sunset ~4:53 PM
  })

  it('puts Dhuhr near solar noon, which Richmond lags because of its longitude', () => {
    // 77.44 W is ~9.7 degrees west of the 75 W meridian, so solar noon runs about
    // half an hour late; in EDT that lands Dhuhr just after 1 PM, not at noon.
    expect(at('2026-08-06', 'Dhuhr')).toBeGreaterThan(13 * 60)
    expect(at('2026-08-06', 'Dhuhr')).toBeLessThan(13 * 60 + 30)
  })

  it('handles the DST changeover without a timezone table', () => {
    // the same solar event, an hour apart on the clock, purely from the offset
    expect(at('2026-01-15', 'Dhuhr')).toBeLessThan(12 * 60 + 30) // EST
    expect(at('2026-08-06', 'Dhuhr')).toBeGreaterThan(13 * 60) // EDT
  })
})

describe('method and madhab options', () => {
  it('puts Hanafi Asr later than the standard opinion', () => {
    const standard = at('2026-08-06', 'Asr', richmond({ asrFactor: 1 }))
    const hanafi = at('2026-08-06', 'Asr', richmond({ asrFactor: 2 }))
    expect(hanafi).toBeGreaterThan(standard)
    expect(hanafi - standard).toBeGreaterThan(30) // roughly an hour in practice
  })

  it('gives an earlier Fajr and later Isha for MWL than for ISNA', () => {
    const mwl = richmond({ fajrAngle: 18, ishaAngle: 17 })
    expect(at('2026-08-06', 'Fajr', mwl)).toBeLessThan(at('2026-08-06', 'Fajr'))
    expect(at('2026-08-06', 'Isha', mwl)).toBeGreaterThan(at('2026-08-06', 'Isha'))
  })

  it('supports a fixed Isha interval instead of an angle', () => {
    const umm = richmond({ ishaAngle: null, ishaInterval: 90 })
    const t = prayerTimes('2026-08-06', umm)
    const get = (n: string): number => t.find((x) => x.name === n)!.minutes
    expect(get('Isha') - get('Maghrib')).toBe(90)
  })
})

describe('extreme latitudes', () => {
  it('still returns five usable times inside the polar summer', () => {
    // Tromsø in June: the sun never sets, so the twilight angles have no solution
    const arctic = richmond({ latitude: 69.65, longitude: 18.96 })
    const t = prayerTimes('2026-06-21', arctic)
    expect(t).toHaveLength(5)
    for (const x of t) {
      expect(Number.isFinite(x.minutes)).toBe(true)
      expect(x.minutes).toBeGreaterThanOrEqual(0)
      expect(x.minutes).toBeLessThan(1440)
    }
  })
})
