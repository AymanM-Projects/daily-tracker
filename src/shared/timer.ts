import type { ActiveTimer } from './types'

/**
 * Elapsed time is always derived from `accumulatedMs` plus the current running
 * segment, never stored as a ticking number. That keeps a per-second UI update
 * from writing to disk, and makes a restart mid-session resume correctly.
 */
export function elapsedMs(timer: ActiveTimer, now: number = Date.now()): number {
  if (timer.paused) return timer.accumulatedMs
  const segment = now - Date.parse(timer.startedAt)
  // a backwards clock (NTP correction, sleep/wake) must never subtract banked time
  return timer.accumulatedMs + Math.max(0, segment)
}

/** Whole minutes elapsed, rounded to the nearest minute and never negative. */
export function elapsedMinutes(timer: ActiveTimer, now: number = Date.now()): number {
  return Math.max(0, Math.round(elapsedMs(timer, now) / 60_000))
}

/** 'M:SS' under an hour, 'H:MM:SS' beyond it. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
