import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ScheduleBlock } from '@shared/types'
import { blockSpan } from '@shared/blocks'
import { minutesNow } from '@shared/time'
import { useData } from '../state/DataContext'

/** Past this many minutes a prompt stops being useful and becomes noise. */
export const PROMPT_WINDOW_MINUTES = 20

/** How long dismissing defers a block, in memory only. */
const DEFER_MINUTES = 10

export interface EndedBlocks {
  /** the block to ask about now, or null */
  current: ScheduleBlock | null
  /** blocks that ended too long ago to interrupt over — shown as a catch-up strip */
  stale: ScheduleBlock[]
  /** a block finished ahead of its slot, with time still left in it */
  earlyFinish: ScheduleBlock | null
  /** hide one for ten minutes without writing anything */
  defer: (id: string) => void
}

/**
 * Which blocks have quietly ended without being answered for.
 *
 * **Derived, never stored.** Answering a prompt changes the block's status or
 * stamps `promptedAt`, which removes it from this derivation and advances the
 * head on its own. That is what makes "the app was closed for five hours" need
 * no special handling: five ended blocks are simply five entries.
 *
 * Deferrals live in component state and are never written to disk, because a
 * dismissal must never be readable as an answer — the same principle as
 * `recurringApplied`. Quitting and relaunching re-asks, which is correct: you
 * never answered.
 */
export function useEndedBlocks(): EndedBlocks {
  const { state, today } = useData()
  const [nowMin, setNowMin] = useState(minutesNow())
  const [deferred, setDeferred] = useState<Record<string, number>>({})

  useEffect(() => {
    const interval = setInterval(() => setNowMin(minutesNow()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const defer = useCallback((id: string): void => {
    setDeferred((prev) => ({ ...prev, [id]: minutesNow() + DEFER_MINUTES }))
  }, [])

  const paused = state.data.dayPause !== null
  const timer = state.data.activeTimer
  const schedule = today.schedule
  const hydrated = state.hydrated

  const { current, stale, earlyFinish } = useMemo(() => {
    // nothing is asked while the day is frozen, or while a timer runs on some
    // other block — that block is the user's declared attention right now
    if (!hydrated || paused || !schedule) {
      return { current: null, stale: [] as ScheduleBlock[], earlyFinish: null }
    }

    // A block settled ahead of its slot with time still to run. Derived like
    // everything else here: answering stamps promptedAt, which removes it.
    const early =
      schedule.find((b) => {
        if (b.kind !== 'activity' || b.status !== 'done' || b.promptedAt !== null) return false
        if (b.actualMinutes === null) return false
        const span = blockSpan(b)
        return span.end > nowMin && span.start + b.actualMinutes < span.end
      }) ?? null

    const candidates = schedule
      .filter((b) => b.kind === 'activity' && b.status === 'planned' && b.promptedAt === null)
      .filter((b) => blockSpan(b).end <= nowMin)
      .filter((b) => (deferred[b.id] ?? -Infinity) <= nowMin)
      // A timer on another block used to suppress this queue outright — that
      // block is the user's declared attention. Autopilot breaks that reading:
      // it starts the NEXT block the moment this one ends, so the question
      // "did you finish?" would be swallowed at every handover. A block that
      // ended before the running one began is not competing for attention; it
      // is the thing the running block replaced, and it still needs answering.
      .filter((b) => {
        if (!timer || timer.blockId === b.id) return true
        const running = schedule.find((x) => x.id === timer.blockId)
        return running ? blockSpan(b).end <= blockSpan(running).start : true
      })
      .sort((a, b) => blockSpan(a).end - blockSpan(b).end)

    const fresh = candidates.filter((b) => nowMin - blockSpan(b).end <= PROMPT_WINDOW_MINUTES)
    return {
      current: fresh[0] ?? null,
      stale: candidates.filter((b) => nowMin - blockSpan(b).end > PROMPT_WINDOW_MINUTES),
      earlyFinish: early
    }
  }, [hydrated, paused, schedule, timer, nowMin, deferred])

  return { current, stale, earlyFinish, defer }
}
