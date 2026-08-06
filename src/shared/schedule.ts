import type { Activity, ScheduleBlock, ScheduleLane, Settings } from './types'
import { formatHM, parseHM } from './time'

export interface ScheduleResult {
  blocks: ScheduleBlock[]
  unscheduled: string[]
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
  settings: Settings
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
    const end = cursor + activity.durationMinutes
    const overflow = end > dayEnd
    blocks.push({
      id: crypto.randomUUID(),
      kind: 'activity',
      lane,
      activityId: activity.id,
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
    if (withBreaks && remaining && cursor + settings.breakMinutes <= dayEnd) {
      blocks.push({
        id: crypto.randomUUID(),
        kind: 'break',
        lane,
        activityId: null,
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
export function generateSchedule(activities: Activity[], settings: Settings): ScheduleResult {
  if (activities.length === 0 || parseHM(settings.dayEnd) <= parseHM(settings.dayStart)) {
    return { blocks: [], unscheduled: [] }
  }
  const focus = fillLane(
    activities.filter((a) => a.mode === 'focus'),
    'focus',
    settings
  )
  const parallel = fillLane(
    activities.filter((a) => a.mode === 'background'),
    'parallel',
    settings
  )
  return {
    blocks: [...focus.blocks, ...parallel.blocks],
    unscheduled: [...focus.unscheduled, ...parallel.unscheduled]
  }
}
