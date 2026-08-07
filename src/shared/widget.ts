import type { AppData, ScheduleBlock, ScheduleLane, WidgetBlock, WidgetSummary } from './types'
import { getDay } from './defaults'
import { formatDateLabel, minutesNow, parseHM, todayKey } from './time'
import { elapsedMs, formatDuration } from './timer'

const LANES: ScheduleLane[] = ['focus', 'parallel']

/**
 * Minutes since midnight for a block's end. Overflow blocks can be generated
 * past midnight, where `formatHM` has wrapped the value below the start —
 * unwrap it so the block still reads as forward-going.
 */
function endMinutes(block: ScheduleBlock): number {
  const start = parseHM(block.start)
  const end = parseHM(block.end)
  return end <= start ? end + 1440 : end
}

function toWidgetBlock(block: ScheduleBlock, nowMin: number, running: boolean): WidgetBlock {
  const start = parseHM(block.start)
  const end = endMinutes(block)
  const span = Math.max(1, end - start)
  return {
    id: block.id,
    name: block.name,
    lane: block.lane,
    kind: block.kind,
    start: block.start,
    end: block.end,
    minutesAway: Math.max(0, running ? end - nowMin : start - nowMin),
    progress: running ? Math.min(1, Math.max(0, (nowMin - start) / span)) : 0,
    overflow: block.overflow
  }
}

/**
 * Flattens today's state into what the menu bar popover shows. Pure, so the
 * main process can derive it without the app window being open, and so the
 * "what am I doing right now" rule is testable on its own.
 *
 * Done and skipped blocks are excluded everywhere: once a block is settled it
 * is history, and showing it as current would misreport the day.
 */
export function buildWidgetSummary(
  data: AppData,
  at: Date = new Date(),
  revision = 0
): WidgetSummary {
  const key = todayKey(at)
  const day = getDay(data, key)
  const nowMin = minutesNow(at)
  const schedule = day.schedule ?? []
  const open = schedule.filter((b) => b.status === 'planned')

  const now: WidgetBlock[] = []
  for (const lane of LANES) {
    const running = open.find(
      (b) => b.lane === lane && parseHM(b.start) <= nowMin && nowMin < endMinutes(b)
    )
    if (running) now.push(toWidgetBlock(running, nowMin, true))
  }

  // the soonest thing that has not started yet, across both lanes
  const upcoming = open
    .filter((b) => parseHM(b.start) > nowMin)
    .sort((a, b) => parseHM(a.start) - parseHM(b.start) || (a.lane === 'focus' ? -1 : 1))

  const active = data.activeTimer
  const timerBlock = active?.dateKey === key ? schedule.find((b) => b.id === active.blockId) : null

  const hours = at.getHours()
  const h12 = hours % 12 === 0 ? 12 : hours % 12

  return {
    revision,
    clock: `${h12}:${String(at.getMinutes()).padStart(2, '0')}`,
    meridiem: hours < 12 ? 'AM' : 'PM',
    dateLabel: formatDateLabel(key),
    hasSchedule: day.schedule !== null,
    now,
    next: upcoming.length > 0 ? toWidgetBlock(upcoming[0], nowMin, false) : null,
    dayComplete: day.schedule !== null && now.length === 0 && upcoming.length === 0,
    timer:
      active && timerBlock
        ? {
            blockId: active.blockId,
            name: timerBlock.name,
            display: formatDuration(elapsedMs(active, at.getTime())),
            paused: active.paused
          }
        : null,
    // counts the standing backlog rather than the retired per-day checklist:
    // "3 of 12 done" across everything outstanding, not just today's slice
    checklist: {
      done: data.backlog.filter((t) => t.done).length,
      total: data.backlog.length
    }
  }
}

/**
 * The text that sits beside the menu bar icon. Deliberately tiny — the bar is
 * shared real estate, so it shows a running timer, else the minutes left on the
 * current focus block, else nothing at all.
 */
export function trayTitle(summary: WidgetSummary): string {
  if (summary.timer) return summary.timer.paused ? 'paused' : summary.timer.display
  const focus = summary.now.find((b) => b.lane === 'focus')
  if (focus) return `${focus.minutesAway}m`
  return ''
}
