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
  const blockName = block?.name

  // hand the deadline to main, which owns the notification (renderer timers
  // are throttled when the window is backgrounded)
  const armed = timer && block && !timer.paused
  const remainingAtArm = armed ? Math.max(0, plannedMsOf(block) - elapsedMs(timer)) : null

  useEffect(() => {
    if (remainingAtArm === null || !blockName) {
      void window.api.setTimerAlarm(null)
      return
    }
    void window.api.setTimerAlarm({
      at: Date.now() + remainingAtArm,
      title: 'Block finished',
      body: `${blockName} — planned time is up.`
    })
    // re-arm only when the run itself changes, not on every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer?.blockId, timer?.paused, timer?.startedAt, timer?.accumulatedMs, blockName])

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
