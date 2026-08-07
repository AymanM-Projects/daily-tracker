import type { Activity, ScheduleBlock, ScheduleLane, Settings } from './types'
import { makeFreeBlock } from './blocks'
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
  /**
   * Spans the generator must route around but must NOT emit — blocks that
   * already exist and are being kept, such as a hand-edited or settled block fed
   * back in by Regenerate. Emitting these would duplicate every pinned block as
   * a second, anchor-shaped copy of itself.
   */
  reserved?: Anchor[]
}

/**
 * Push `cursor` past any anchor that a block of `duration` would collide with.
 * Loops because stepping over one anchor can land on the next.
 */
export function avoidAnchors(cursor: number, duration: number, anchors: Anchor[]): number {
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
  // Focus lane only. The parallel lane is unattended work — protected rest from
  // a 3D print means nothing, and free blocks there would tell the backlog
  // planner the whole day is occupied.
  const withFree =
    settings.freeBufferEnabled &&
    lane === 'focus' &&
    settings.freeBufferMinutes > 0 &&
    settings.freeBufferEveryMinutes > 0
  const sorted = sortForSchedule(activities)
  const blocks: ScheduleBlock[] = []
  const unscheduled: string[] = []
  let cursor = dayStart
  /** focus minutes worked since the last real rest — what a buffer comes due after */
  let sinceRest = 0

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
      actualMinutes: null,
      manual: false,
      promptedAt: null,
      plannedMinutes: null
    })
    if (overflow) {
      unscheduled.push(...sorted.slice(i + 1).map((a) => a.name))
      break
    }
    cursor = end
    sinceRest += activity.durationMinutes
    // nothing is ever inserted after the last activity
    if (i === sorted.length - 1) break

    // An anchor sitting on this boundary IS the rest. Salah interrupts the flow
    // on its own, so the buffer clock starts over and nothing is stacked on top
    // of it. Probing a single minute asks exactly "is the cursor at or inside an
    // anchor" without borrowing either filler's length.
    if (withFree && avoidAnchors(cursor, 1, anchors) !== cursor) {
      sinceRest = 0
      continue
    }

    // A due buffer REPLACES the break at this boundary rather than stacking on
    // it — two rests back to back is one rest. It is skipped, not shifted, if an
    // anchor is close enough that it would not fit.
    const bufferDue = withFree && sinceRest >= settings.freeBufferEveryMinutes
    const bufferClear = avoidAnchors(cursor, settings.freeBufferMinutes, anchors) === cursor
    if (bufferDue && bufferClear && cursor + settings.freeBufferMinutes <= dayEnd) {
      blocks.push(makeFreeBlock(lane, cursor, cursor + settings.freeBufferMinutes))
      cursor += settings.freeBufferMinutes
      sinceRest = 0
      continue
    }

    // a break is skipped rather than shifted when an anchor already interrupts here
    const breakClear = avoidAnchors(cursor, settings.breakMinutes, anchors) === cursor
    if (withBreaks && breakClear && cursor + settings.breakMinutes <= dayEnd) {
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
        actualMinutes: null,
        manual: false,
        promptedAt: null,
        plannedMinutes: null
      })
      cursor += settings.breakMinutes
    }
  }

  // Deliberately NOT mopping the leftover tail of the day into free blocks.
  // `plan.ts` treats every focus-lane block as occupied regardless of kind, so
  // protecting the tail would mean the backlog planner could never place work on
  // a generated day. Buffers are rest earned between tasks; the tail is simply
  // unplanned, and staying unplanned is what keeps the backlog usable.
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
  const inWindow = (a: Anchor): boolean => a.end > dayStart && a.start < dayEnd
  const emitted = (options.anchors ?? []).filter(inWindow).sort((x, y) => x.start - y.start)
  // reserved spans block the lane exactly like an anchor but are never emitted:
  // they are blocks that already exist elsewhere in the day
  const anchors = [...emitted, ...(options.reserved ?? []).filter(inWindow)].sort(
    (x, y) => x.start - y.start
  )

  const anchorBlocks: ScheduleBlock[] = emitted.map((a) => ({
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
    actualMinutes: null,
    manual: false,
    promptedAt: null,
    plannedMinutes: null
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
