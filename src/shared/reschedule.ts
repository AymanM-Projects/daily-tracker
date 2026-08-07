import type { BacklogTask, Priority, ScheduleBlock, ScheduleLane } from './types'
import type { Anchor } from './schedule'
import { avoidAnchors } from './schedule'
import {
  blockSpan,
  byStart,
  coalesceFree,
  isConsumable,
  isImmovable,
  isTransparent,
  makeFreeBlock,
  type IdFactory
} from './blocks'
import { formatHM } from './time'

/**
 * Every geometry mutation of a day lives here: one pure, clock-free module so
 * the reducer stays thin and all of this is testable without a running app.
 *
 * Two conventions hold throughout:
 *
 * - **Anchors are not passed in.** They are already in the block array as
 *   `kind: 'anchor'`, and `isImmovable` finds them. Barriers are derived, never
 *   supplied, so a caller cannot forget them.
 * - **Every function returns blocks in `byStart` order**, so results compare
 *   directly in tests and render without a second sort.
 */

/** A consumable left shorter than this is dropped — a 3-minute sliver is untappable and meaningless. */
export const MIN_CONSUMABLE = 5

export interface DayWindow {
  dayStart: number
  dayEnd: number
}

export interface ShiftOptions {
  makeId?: IdFactory
  minConsumable?: number
}

export interface BlockPatch {
  name?: string
  /** minutes since midnight */
  start?: number
  end?: number
}

export type EditFailure =
  | { code: 'not-found' }
  | { code: 'immovable'; blockName: string }
  | { code: 'generated-name' }
  | { code: 'inverted' }
  | { code: 'before-day-start' }
  | { code: 'collision'; withName: string; withStart: string; withEnd: string }

export type Result<T> = { ok: true; value: T } | { ok: false; error: EditFailure }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = <T>(error: EditFailure): Result<T> => ({ ok: false, error })

/** Blocks a user owns. Breaks and anchors are generated obligations, not edits. */
function isEditable(block: ScheduleBlock): boolean {
  return block.kind === 'activity' || block.kind === 'free'
}

function barriersFor(laneBlocks: ScheduleBlock[]): Anchor[] {
  return laneBlocks.filter(isImmovable).map((b) => {
    const span = blockSpan(b)
    return { name: b.name, start: span.start, end: span.end }
  })
}

/**
 * Insert or remove `delta` minutes at `fromMinute`, cascading the rest of the day.
 *
 * **This is not an inverse.** `+20` followed by `-20` does not restore a free
 * block that the first call consumed — those minutes were spent, and the second
 * call has no record they ever existed. Anything wanting undo must keep the
 * original blocks, not replay the arithmetic.
 */
export function shiftAfter(
  blocks: ScheduleBlock[],
  fromMinute: number,
  delta: number,
  options: ShiftOptions = {}
): ScheduleBlock[] {
  if (delta === 0) return [...blocks].sort(byStart)
  const minConsumable = options.minConsumable ?? MIN_CONSUMABLE
  const out: ScheduleBlock[] = []

  // per lane, independently — a four-hour 3D print must never push focus work
  for (const lane of ['focus', 'parallel'] as ScheduleLane[]) {
    const laneBlocks = blocks.filter((b) => b.lane === lane).sort(byStart)
    out.push(
      ...(delta > 0
        ? pushLane(laneBlocks, fromMinute, delta, minConsumable)
        : pullLane(laneBlocks, fromMinute, -delta))
    )
  }
  return out.sort(byStart)
}

function pushLane(
  lane: ScheduleBlock[],
  fromMinute: number,
  delta: number,
  minConsumable: number
): ScheduleBlock[] {
  const barriers = barriersFor(lane)
  const out: ScheduleBlock[] = []
  let debt = delta

  for (const block of lane) {
    const span = blockSpan(block)
    const settled =
      span.end <= fromMinute || // already over
      isImmovable(block) || // an anchor, or history
      isTransparent(block) || // skipped: records a decision, so it stays put
      span.start < fromMinute || // straddling — in progress, that is extendBlock's job
      debt <= 0
    if (settled) {
      out.push(block)
      continue
    }

    const length = span.end - span.start

    if (isConsumable(block)) {
      // Free and break blocks give up minutes off their FRONT and keep their end,
      // so a shift that fits inside one costs the rest of the day nothing.
      if (length - Math.min(debt, length) < minConsumable) {
        debt = Math.max(0, debt - length)
        continue
      }
      const absorbed = Math.min(debt, length)
      debt -= absorbed
      out.push({ ...block, start: formatHM(span.start + absorbed) })
      continue
    }

    const start = avoidAnchors(span.start + debt, length, barriers)
    // clearing a barrier can cost more than the debt, and that surplus propagates
    debt = start - span.start
    out.push({ ...block, start: formatHM(start), end: formatHM(start + length) })
  }
  return out
}

function pullLane(lane: ScheduleBlock[], fromMinute: number, credit: number): ScheduleBlock[] {
  const out: ScheduleBlock[] = []
  // nothing may be pulled earlier than this; it rises past each barrier in turn
  let floor = fromMinute

  for (const block of lane) {
    const span = blockSpan(block)
    if (span.end <= fromMinute) {
      out.push(block)
      continue
    }
    // a skipped block holds its slot but is not a barrier — nothing happened in it
    if (isTransparent(block)) {
      out.push(block)
      continue
    }
    if (isImmovable(block) || span.start < fromMinute) {
      floor = Math.max(floor, span.end)
      out.push(block)
      continue
    }
    const length = span.end - span.start
    const start = Math.max(span.start - credit, floor)
    floor = start + length
    out.push({ ...block, start: formatHM(start), end: formatHM(start + length) })
  }
  return out
}

/**
 * Cut `span` out of every free block in the lane, trimming or splitting as
 * needed. Free time is the first place time is borrowed from, so a hand edit is
 * allowed to land on it where it would be refused anywhere else.
 */
function carveFree(
  blocks: ScheduleBlock[],
  lane: ScheduleLane,
  span: { start: number; end: number },
  makeId?: IdFactory
): ScheduleBlock[] {
  const out: ScheduleBlock[] = []
  for (const block of blocks) {
    const b = blockSpan(block)
    if (
      block.kind !== 'free' ||
      block.lane !== lane ||
      b.end <= span.start ||
      b.start >= span.end
    ) {
      out.push(block)
      continue
    }
    if (b.start < span.start) out.push({ ...block, end: formatHM(span.start) })
    if (b.end > span.end) {
      out.push(
        b.start < span.start
          ? makeFreeBlock(lane, span.end, b.end, { makeId, manual: block.manual })
          : { ...block, start: formatHM(span.end) }
      )
    }
  }
  return out
}

/**
 * First block in the lane that overlaps `span` and would genuinely be in the
 * way. Free blocks are carved, skipped blocks hold no work, and a break fully
 * covered by the span is absorbed — none of those are collisions.
 */
function collidesWith(
  blocks: ScheduleBlock[],
  lane: ScheduleLane,
  span: { start: number; end: number },
  exceptId: string
): ScheduleBlock | null {
  for (const block of blocks) {
    if (block.id === exceptId || block.lane !== lane) continue
    if (block.kind === 'free' || isTransparent(block)) continue
    const b = blockSpan(block)
    if (block.kind === 'break' && b.start >= span.start && b.end <= span.end) continue
    if (b.start < span.end && span.start < b.end) return block
  }
  return null
}

/**
 * Drop breaks the span now covers, carve the free time it lands on, recompute
 * overflow, coalesce. Every successful mutation ends here, so the invariants
 * live in exactly one place.
 */
function finalise(
  blocks: ScheduleBlock[],
  lane: ScheduleLane,
  span: { start: number; end: number },
  dayEnd: number,
  makeId?: IdFactory
): ScheduleBlock[] {
  const withoutCoveredBreaks = blocks.filter((b) => {
    if (b.kind !== 'break' || b.lane !== lane) return true
    const s = blockSpan(b)
    return !(s.start >= span.start && s.end <= span.end)
  })
  return coalesceFree(carveFree(withoutCoveredBreaks, lane, span, makeId)).map((b) =>
    b.kind === 'activity' ? { ...b, overflow: blockSpan(b).end > dayEnd } : b
  )
}

function collisionError(block: ScheduleBlock): EditFailure {
  return {
    code: 'collision',
    withName: block.name,
    withStart: block.start,
    withEnd: block.end
  }
}

/**
 * Hand-edit one block. **Rejects rather than cascades**: a widened block that
 * collides is refused with the name of what is in the way, so the sheet can
 * offer an explicit "shift the rest" instead. Silent auto-shifting on a timeline
 * the user cannot drag reads as the app arguing with them.
 */
export function editBlock(
  blocks: ScheduleBlock[],
  id: string,
  patch: BlockPatch,
  window: DayWindow,
  options: ShiftOptions & { ripple?: boolean } = {}
): Result<ScheduleBlock[]> {
  const block = blocks.find((b) => b.id === id)
  if (!block) return fail({ code: 'not-found' })
  if (!isEditable(block) || isImmovable(block)) {
    return fail({ code: 'immovable', blockName: block.name })
  }
  // a placed task's name is generated — 'Essay (2 of 3)' — so renaming it here
  // would desync it from the backlog task that owns it
  if (patch.name !== undefined && block.backlogTaskId !== null) {
    return fail({ code: 'generated-name' })
  }

  const current = blockSpan(block)
  const start = patch.start ?? current.start
  const end = patch.end ?? current.end
  if (end <= start) return fail({ code: 'inverted' })
  if (start < window.dayStart) return fail({ code: 'before-day-start' })

  const moved: ScheduleBlock = {
    ...block,
    name: patch.name ?? block.name,
    start: formatHM(start),
    end: formatHM(end),
    manual: true
  }
  const span = { start, end }
  const others = blocks.filter((b) => b.id !== id)
  const blocker = collidesWith(others, block.lane, span, id)
  if (!blocker) {
    return ok(finalise([...others, moved], block.lane, span, window.dayEnd, options.makeId))
  }
  if (!options.ripple) return fail(collisionError(blocker))

  const pushed = shiftAfter(others, current.end, end - current.end, options)
  const still = collidesWith(pushed, block.lane, span, id)
  if (still) return fail(collisionError(still))
  return ok(finalise([...pushed, moved], block.lane, span, window.dayEnd, options.makeId))
}

export interface NewBlock {
  name: string
  lane: ScheduleLane
  start: number
  end: number
  activityId?: string | null
}

/** Insert a hand-made block. Same collision contract as `editBlock`. */
export function insertBlock(
  blocks: ScheduleBlock[],
  draft: NewBlock,
  window: DayWindow,
  options: ShiftOptions & { ripple?: boolean } = {}
): Result<ScheduleBlock[]> {
  if (draft.end <= draft.start) return fail({ code: 'inverted' })
  if (draft.start < window.dayStart) return fail({ code: 'before-day-start' })

  const block: ScheduleBlock = {
    id: (options.makeId ?? (() => crypto.randomUUID()))(),
    kind: 'activity',
    lane: draft.lane,
    activityId: draft.activityId ?? null,
    backlogTaskId: null,
    name: draft.name,
    start: formatHM(draft.start),
    end: formatHM(draft.end),
    overflow: draft.end > window.dayEnd,
    status: 'planned',
    actualMinutes: null,
    manual: true,
    promptedAt: null,
    plannedMinutes: null
  }

  const span = { start: draft.start, end: draft.end }
  const blocker = collidesWith(blocks, draft.lane, span, block.id)
  if (!blocker) {
    return ok(finalise([...blocks, block], draft.lane, span, window.dayEnd, options.makeId))
  }
  if (!options.ripple) return fail(collisionError(blocker))

  const pushed = shiftAfter(blocks, draft.start, draft.end - draft.start, options)
  const still = collidesWith(pushed, draft.lane, span, block.id)
  if (still) return fail(collisionError(still))
  return ok(finalise([...pushed, block], draft.lane, span, window.dayEnd, options.makeId))
}

/**
 * Remove a block. `vacate: 'free'` protects the span it leaves behind, which is
 * mandatory for backlog-placed work: otherwise the very next `replan` finds the
 * gap plus the minutes it just released and puts the block straight back, so
 * Delete looks like it did nothing.
 */
export function removeBlock(
  blocks: ScheduleBlock[],
  id: string,
  options: { vacate: 'free' | 'gap'; makeId?: IdFactory }
): ScheduleBlock[] {
  const block = blocks.find((b) => b.id === id)
  if (!block) return [...blocks].sort(byStart)
  const rest = blocks.filter((b) => b.id !== id)
  if (options.vacate === 'gap') return rest.sort(byStart)
  const span = blockSpan(block)
  return coalesceFree([
    ...rest,
    makeFreeBlock(block.lane, span.start, span.end, { makeId: options.makeId })
  ])
}

export interface ExtendResult {
  blocks: ScheduleBlock[]
  /** minutes taken from free or break time, costing the rest of the day nothing */
  absorbed: number
  /** minutes the rest of the day actually moved by */
  pushed: number
}

/** Grow a block in place, letting the day absorb what it can before pushing. */
export function extendBlock(
  blocks: ScheduleBlock[],
  id: string,
  extraMinutes: number,
  options: ShiftOptions = {}
): ExtendResult {
  const block = blocks.find((b) => b.id === id)
  if (!block || extraMinutes <= 0) {
    return { blocks: [...blocks].sort(byStart), absorbed: 0, pushed: 0 }
  }
  const span = blockSpan(block)
  const others = blocks.filter((b) => b.id !== id)

  const before = firstWorkStart(others, block.lane, span.end)
  const shifted = shiftAfter(others, span.end, extraMinutes, options)
  const after = firstWorkStart(shifted, block.lane, span.end)
  const pushed = before === null || after === null ? 0 : Math.max(0, after - before)

  const grown: ScheduleBlock = {
    ...block,
    end: formatHM(span.end + extraMinutes),
    manual: true,
    plannedMinutes: block.plannedMinutes ?? span.end - span.start
  }
  return {
    blocks: [...shifted, grown].sort(byStart),
    absorbed: Math.max(0, extraMinutes - pushed),
    pushed
  }
}

/**
 * Where real work next begins in the lane, at or after `minute`.
 *
 * Consumables are excluded deliberately: eating into a free block is the whole
 * point of absorption, so counting its start would report every absorbed minute
 * as a push and `absorbed` would always be zero.
 */
function firstWorkStart(
  blocks: ScheduleBlock[],
  lane: ScheduleLane,
  minute: number
): number | null {
  const starts = blocks
    .filter((b) => b.lane === lane && !isImmovable(b) && !isTransparent(b) && !isConsumable(b))
    .map((b) => blockSpan(b).start)
    .filter((s) => s >= minute)
  return starts.length === 0 ? null : Math.min(...starts)
}

export interface SpilledWork {
  name: string
  minutes: number
  backlogTaskId: string | null
  activityId: string | null
}

export interface SpillResult {
  blocks: ScheduleBlock[]
  spilled: SpilledWork[]
}

/**
 * Move whatever no longer fits before `dayEnd` off the day.
 *
 * A straddling block keeps its head if that head is still worth doing
 * (`minChunkMinutes`, the same floor `planBacklog` uses, so spill and the
 * planner agree on what a useless sliver is) and spills only its tail;
 * otherwise the whole block goes.
 *
 * Free and break blocks past the end are **dropped, not spilled** — protected
 * time is not work, and banking rest as a task to be rescheduled is absurd.
 */
export function spill(
  blocks: ScheduleBlock[],
  dayEnd: number,
  options: { minChunk?: number } = {}
): SpillResult {
  const minChunk = options.minChunk ?? 30
  const out: ScheduleBlock[] = []
  const spilled: SpilledWork[] = []

  for (const block of blocks) {
    const span = blockSpan(block)
    // history and anchors stay wherever they are; a skipped block is a record,
    // not work, so there is nothing in it to move
    if (span.end <= dayEnd || isImmovable(block) || isTransparent(block)) {
      out.push(block)
      continue
    }
    if (isConsumable(block)) {
      if (span.start < dayEnd) out.push({ ...block, end: formatHM(dayEnd) })
      continue
    }

    const record = (minutes: number): void => {
      spilled.push({
        name: block.name,
        minutes,
        backlogTaskId: block.backlogTaskId,
        activityId: block.activityId
      })
    }

    if (dayEnd - span.start >= minChunk) {
      out.push({
        ...block,
        end: formatHM(dayEnd),
        plannedMinutes: block.plannedMinutes ?? span.end - span.start
      })
      record(span.end - dayEnd)
      continue
    }
    record(span.end - span.start)
  }
  return { blocks: out.sort(byStart), spilled }
}

/**
 * Give spilled work somewhere to live in the backlog.
 *
 * **Placed work needs no change at all**, which is the part worth stating
 * plainly: `planBacklog` derives remaining as estimate minus minutes already
 * placed, so shortening or dropping a block reopens exactly those minutes on its
 * own and the planner re-places them. Adding to the estimate here would count
 * the same work twice.
 *
 * A generated activity block is the only real case. It has no `BacklogTask`, and
 * `planBacklog` has no notion of `Activity` — so without minting one the work
 * has no representation the planner can move, and spilling would silently lose
 * it. The minutes come from the block itself, so nothing is being guessed.
 */
export function bankSpilled(
  spilled: SpilledWork[],
  backlog: BacklogTask[],
  options: {
    makeId?: IdFactory
    now?: string
    priorityOf?: (activityId: string | null) => Priority
  } = {}
): BacklogTask[] {
  const mint = spilled.filter((s) => s.backlogTaskId === null && s.minutes > 0)
  if (mint.length === 0) return backlog
  const makeId = options.makeId ?? ((): string => crypto.randomUUID())
  const now = options.now ?? new Date().toISOString()

  return [
    ...backlog,
    ...mint.map((s) => ({
      id: makeId(),
      text: s.name,
      priority: options.priorityOf?.(s.activityId) ?? (2 as Priority),
      estimateMinutes: s.minutes,
      dueDate: null,
      done: false,
      completedAt: null,
      createdAt: now
    }))
  ]
}

export interface TruncateResult {
  blocks: ScheduleBlock[]
  freedMinutes: number
  /** id of the protected block created over the released span, if any */
  freeBlockId: string | null
}

/**
 * Finish early. The released span becomes **protected free time**, never a bare
 * gap: `planBacklog` fills anything it can see, so a gap would mean "I finished
 * early" silently resolves to "here is more work".
 *
 * `actualMinutes` is the timer's measured value and wins over arithmetic.
 */
export function truncate(
  blocks: ScheduleBlock[],
  id: string,
  actualMinutes: number,
  options: ShiftOptions = {}
): TruncateResult {
  const block = blocks.find((b) => b.id === id)
  if (!block) return { blocks: [...blocks].sort(byStart), freedMinutes: 0, freeBlockId: null }

  const span = blockSpan(block)
  const planned = span.end - span.start
  const kept = Math.max(0, Math.min(actualMinutes, planned))
  const freed = planned - kept
  if (freed <= 0) {
    return { blocks: [...blocks].sort(byStart), freedMinutes: 0, freeBlockId: null }
  }

  const shortened: ScheduleBlock = {
    ...block,
    end: formatHM(span.start + kept),
    actualMinutes: kept,
    plannedMinutes: block.plannedMinutes ?? planned
  }
  const free = makeFreeBlock(block.lane, span.start + kept, span.end, { makeId: options.makeId })
  return {
    blocks: coalesceFree([...blocks.filter((b) => b.id !== id), shortened, free]),
    freedMinutes: freed,
    freeBlockId: free.id
  }
}
