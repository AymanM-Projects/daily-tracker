import { useEffect, useState } from 'react'
import type { ScheduleBlock } from '@shared/types'
import { elapsedMs } from '@shared/timer'
import { blockMinutes } from '@shared/blocks'
import { getDay } from '@shared/defaults'
import { useData } from '../state/DataContext'

export interface TimerView {
  block: ScheduleBlock
  /** ms counted so far, ticking once a second while running */
  elapsed: number
  /** planned length of the block in ms */
  plannedMs: number
  /** ms left against the plan; negative once it runs over */
  remaining: number
  paused: boolean
  overrun: boolean
}

function plannedMsOf(block: ScheduleBlock): number {
  return blockMinutes(block) * 60_000
}

/**
 * Derives the live timer view from `activeTimer`. The ticking value lives here
 * in component state and is never written back to the document — the reducer
 * only records the timer at start/pause/resume/stop.
 */
export function useTimer(): TimerView | null {
  const { state } = useData()
  const timer = state.data.activeTimer
  const [now, setNow] = useState(() => Date.now())

  const running = timer !== null && !timer.paused
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const block = timer
    ? (getDay(state.data, timer.dateKey).schedule ?? []).find((b) => b.id === timer.blockId)
    : undefined

  // Notifications are no longer armed from here. Main computes the day's next
  // boundary from the schedule itself (see `armNextTransition`), so the
  // announcements keep coming with the window closed — which is exactly when a
  // renderer-armed alarm would have died with the renderer.

  if (!timer || !block) return null

  const elapsed = elapsedMs(timer, now)
  const plannedMs = plannedMsOf(block)
  return {
    block,
    elapsed,
    plannedMs,
    remaining: plannedMs - elapsed,
    paused: timer.paused,
    overrun: elapsed > plannedMs
  }
}
