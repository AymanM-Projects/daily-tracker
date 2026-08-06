import { describe, expect, it } from 'vitest'
import type { ActiveTimer } from './types'
import { elapsedMinutes, elapsedMs, formatDuration } from './timer'

const T0 = Date.parse('2026-08-06T16:00:00.000Z')

function timer(over: Partial<ActiveTimer> = {}): ActiveTimer {
  return {
    dateKey: '2026-08-06',
    blockId: 'block-1',
    startedAt: new Date(T0).toISOString(),
    accumulatedMs: 0,
    paused: false,
    ...over
  }
}

describe('elapsedMs', () => {
  it('counts the running segment', () => {
    expect(elapsedMs(timer(), T0 + 90_000)).toBe(90_000)
  })

  it('freezes at the banked total while paused', () => {
    const t = timer({ paused: true, accumulatedMs: 120_000 })
    // a later `now` must not advance a paused timer
    expect(elapsedMs(t, T0 + 999_000)).toBe(120_000)
  })

  it('adds the new segment to banked time after resuming', () => {
    // paused at 2min, resumed at T0, then 30s more
    const t = timer({ accumulatedMs: 120_000 })
    expect(elapsedMs(t, T0 + 30_000)).toBe(150_000)
  })

  it('survives a restart mid-run without double-counting', () => {
    // the document on disk is the only state; reloading it and asking again
    // at the same instant must give the same answer
    const onDisk = timer({ accumulatedMs: 60_000 })
    const reloaded: ActiveTimer = JSON.parse(JSON.stringify(onDisk))
    expect(elapsedMs(reloaded, T0 + 45_000)).toBe(elapsedMs(onDisk, T0 + 45_000))
    expect(elapsedMs(reloaded, T0 + 45_000)).toBe(105_000)
  })

  it('never subtracts banked time when the clock jumps backwards', () => {
    const t = timer({ accumulatedMs: 300_000 })
    expect(elapsedMs(t, T0 - 60_000)).toBe(300_000)
  })
})

describe('elapsedMinutes', () => {
  it('rounds to the nearest minute', () => {
    expect(elapsedMinutes(timer(), T0 + 89_000)).toBe(1)
    expect(elapsedMinutes(timer(), T0 + 91_000)).toBe(2)
  })

  it('is zero for a timer that just started', () => {
    expect(elapsedMinutes(timer(), T0)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats under a minute', () => {
    expect(formatDuration(9_000)).toBe('0:09')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(125_000)).toBe('2:05')
  })

  it('adds an hours field past 60 minutes', () => {
    expect(formatDuration(3_725_000)).toBe('1:02:05')
  })

  it('clamps negatives to zero', () => {
    expect(formatDuration(-5_000)).toBe('0:00')
  })
})
