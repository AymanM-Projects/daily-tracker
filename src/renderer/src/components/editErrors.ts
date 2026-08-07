import type { EditFailure } from '@shared/reschedule'
import { formatClock } from '@shared/time'

/**
 * Why a geometry edit was refused, in words.
 *
 * Its own module because three surfaces now share it — the block sheet, the
 * add-block sheet, and a refused drag on the timeline — and a refusal that is
 * phrased differently depending on how you triggered it reads as three
 * different bugs rather than one rule.
 *
 * `withStart` / `withEnd` arrive as storage-format 'HH:mm' and go through
 * `formatClock`, like every other time the user reads.
 */
export function describeEditFailure(error: EditFailure): string {
  switch (error.code) {
    case 'collision':
      return `Overlaps ${error.withName} (${formatClock(error.withStart)} – ${formatClock(error.withEnd)})`
    case 'inverted':
      return 'The end has to come after the start.'
    case 'before-day-start':
      return 'That starts before your day does.'
    case 'generated-name':
      return "This block's name comes from your task list, so it can't be renamed here."
    case 'immovable':
      return `${error.blockName} isn't yours to move.`
    case 'not-found':
      return 'That block is no longer here.'
  }
}
