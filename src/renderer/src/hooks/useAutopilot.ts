import { useEffect, useState } from 'react'
import { blockAt } from '@shared/agenda'
import { blockSpan } from '@shared/blocks'
import { elapsedMinutes } from '@shared/timer'
import { minutesNow } from '@shared/time'
import { useData } from '../state/DataContext'

/** How often the day is reconciled. Fine enough that a block starts on its minute. */
const TICK_MS = 15_000

/**
 * Runs the day.
 *
 * Keeps `activeTimer` pointed at whichever block the clock is inside, so the
 * plan and the measurement can never drift apart. The user asked not to have to
 * start anything: generating a schedule should be enough.
 *
 * Three deliberate properties:
 *
 * - **It only ever starts what the schedule already says.** It never creates,
 *   moves, or settles work on its own.
 * - **The timer counts from the block's start, not from now.** Opening the app
 *   twenty minutes into a block shows twenty minutes gone, because they are.
 *   That elapsed time is what gets recorded as `actualMinutes`, which is what
 *   makes "you finished early" mean anything.
 * - **It stops at the prompt.** Deciding what happened to a block that ran out
 *   is the user's; autopilot never answers on their behalf. It records how long
 *   the block ran and leaves it `planned`, so `useEndedBlocks` still asks about
 *   the one it left behind while the next one is already running.
 *
 * With the window closed the renderer does not exist, so nothing advances —
 * main still fires the notifications, and reopening reconciles in one tick.
 */
export function useAutopilot(): void {
  const { state, today, settings, dispatch } = useData()
  const [nowMin, setNowMin] = useState(minutesNow())

  useEffect(() => {
    const id = setInterval(() => setNowMin(minutesNow()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const enabled =
    settings.autopilot && state.hydrated && state.data.dayPause === null && today.schedule !== null

  const date = state.activeDate
  const schedule = today.schedule
  const timer = state.data.activeTimer

  useEffect(() => {
    if (!enabled || !schedule) return

    const should = blockAt(schedule, nowMin)
    const runningId = timer?.blockId ?? null
    if ((should?.id ?? null) === runningId) return

    if (timer) {
      const running = schedule.find((b) => b.id === timer.blockId)
      const over = running ? blockSpan(running).end <= nowMin : true
      // a timer the user started on something still running outranks the schedule
      if (running && !over) return

      // Record how long it ran, but do NOT settle it.
      //
      // `completeTimer` would mark the block done — which is the answer to "did
      // you finish?", given on the user's behalf, and it removes the block from
      // the prompt queue before they ever see the question. Writing only
      // `actualMinutes` keeps the measurement and leaves the block `planned`,
      // so the prompt still asks and the journal still gets the minutes when
      // they answer.
      if (running && running.kind === 'activity') {
        dispatch({
          type: 'setBlockActualMinutes',
          date,
          blockId: running.id,
          minutes: elapsedMinutes(timer)
        })
      }
      dispatch({ type: 'cancelTimer' })
    }

    if (should) {
      const startedAt = new Date()
      startedAt.setHours(0, blockSpan(should).start, 0, 0)
      dispatch({ type: 'startTimer', date, blockId: should.id, startedAt: startedAt.toISOString() })
    }
  }, [enabled, schedule, timer, nowMin, date, dispatch])
}
