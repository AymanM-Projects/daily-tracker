import type { Activity, ScheduleBlock, ScheduleLane, Settings } from './types'
import { formatHM, parseHM } from './time'

export interface ScheduleResult {
  blocks: ScheduleBlock[]
  unscheduled: string[]
}

/** A fixed-time obligation the focus lane must work around, in minutes since midnight. */
export interface Anchor {
  name: string
  start: number
  end: number
}

export interface GenerateOptions {
  /**
   * Fixed commitments — prayers today, though this module deliberately knows
   * nothing about what they are. They block the FOCUS lane only: a 3D print or
   * a vibecoding run keeps running, which is the point of the parallel lane.
   */
  anchors?: Anchor[]
}

/**
 * Push `cursor` past any anchor that a block of `duration` would collide with.
 * Loops because stepping over one anchor can land on the next.
 */
function avoidAnchors(cursor: number, duration: number, anchors: Anchor[]): number {
  let at = cursor
  let moved = true
  while (moved) {
    moved = false
    for (const a of anchors) {
      if (at < a.end && a.start < at + duration) {
        at = a.end
        moved = true
      }
    }
  }
  return at
}

function sortForSchedule(activities: Activity[]): Activity[] {
  return [...activities].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.durationMinutes - b.durationMinutes ||
      a.createdAt.localeCompare(b.createdAt)
  )
}

function fillLane(
  activities: Activity[],
  lane: ScheduleLane,
  settings: Settings,
  anchors: Anchor[]
): { blocks: ScheduleBlock[]; unscheduled: string[] } {
  const dayStart = parseHM(settings.dayStart)
  const dayEnd = parseHM(settings.dayEnd)
  const withBreaks = settings.breaksEnabled && lane === 'focus'
  const sorted = sortForSchedule(activities)
  const blocks: ScheduleBlock[] = []
  const unscheduled: string[] = []
  let cursor = dayStart

  for (let i = 0; i < sorted.length; i++) {
    const activity = sorted[i]
    // an activity is never split across an anchor — it starts after it instead
    cursor = avoidAnchors(cursor, activity.durationMinutes, anchors)
    const end = cursor + activity.durationMinutes
    const overflow = end > dayEnd
    blocks.push({
      id: crypto.randomUUID(),
      kind: 'activity',
      lane,
      activityId: activity.id,
      backlogTaskId: null,
      name: activity.name,
      start: formatHM(cursor),
      end: formatHM(end),
      overflow,
      status: 'planned',
      actualMinutes: null
    })
    if (overflow) {
      unscheduled.push(...sorted.slice(i + 1).map((a) => a.name))
      break
    }
    cursor = end
    const remaining = i < sorted.length - 1
    // a break is skipped rather than shifted when an anchor already interrupts here
    const breakClear = avoidAnchors(cursor, settings.breakMinutes, anchors) === cursor
    if (withBreaks && remaining && breakClear && cursor + settings.breakMinutes <= dayEnd) {
      blocks.push({
        id: crypto.randomUUID(),
        kind: 'break',
        lane,
        activityId: null,
        backlogTaskId: null,
        name: 'Break',
        start: formatHM(cursor),
        end: formatHM(cursor + settings.breakMinutes),
        overflow: false,
        status: 'planned',
        actualMinutes: null
      })
      cursor += settings.breakMinutes
    }
  }

  return { blocks, unscheduled }
}

/**
 * Two-lane generator: focus activities fill the Focus lane with optional breaks;
 * background activities fill the Parallel lane concurrently, both starting at dayStart.
 */
export function generateSchedule(
  activities: Activity[],
  settings: Settings,
  options: GenerateOptions = {}
): ScheduleResult {
  const dayStart = parseHM(settings.dayStart)
  const dayEnd = parseHM(settings.dayEnd)
  if (dayEnd <= dayStart) return { blocks: [], unscheduled: [] }

  // only anchors inside the day window matter; Fajr at 5am is real but has no
  // bearing on an afternoon that starts at three
  const anchors = (options.anchors ?? [])
    .filter((a) => a.end > dayStart && a.start < dayEnd)
    .sort((x, y) => x.start - y.start)

  const anchorBlocks: ScheduleBlock[] = anchors.map((a) => ({
    id: crypto.randomUUID(),
    kind: 'anchor' as const,
    lane: 'focus' as const,
    activityId: null,
    backlogTaskId: null,
    name: a.name,
    start: formatHM(a.start),
    end: formatHM(a.end),
    overflow: false,
    status: 'planned' as const,
    actualMinutes: null
  }))

  if (activities.length === 0) return { blocks: anchorBlocks, unscheduled: [] }

  const focus = fillLane(
    activities.filter((a) => a.mode === 'focus'),
    'focus',
    settings,
    anchors
  )
  const parallel = fillLane(
    activities.filter((a) => a.mode === 'background'),
    'parallel',
    settings,
    // the parallel lane runs straight through anchors on purpose
    []
  )
  return {
    blocks: [...anchorBlocks, ...focus.blocks, ...parallel.blocks],
    unscheduled: [...focus.unscheduled, ...parallel.unscheduled]
  }
}
