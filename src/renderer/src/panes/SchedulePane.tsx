import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ScheduleBlock } from '@shared/types'
import { generateSchedule, type Anchor } from '@shared/schedule'
import { dayAnchors } from '@shared/anchors'
import { blockSpan, byStart, freeIntervals, isImmovable } from '@shared/blocks'
import { editBlock, moveBlock } from '@shared/reschedule'
import {
  formatClock,
  formatClockMinutes,
  formatHM,
  formatMinutes,
  minutesNow,
  parseHM
} from '@shared/time'
import { useData } from '../state/DataContext'
import { useTimer } from '../hooks/useTimer'
import { useEndedBlocks } from '../hooks/useEndedBlocks'
import EmptyState from '../components/EmptyState'
import BlockSheet from '../components/BlockSheet'
import { describeEditFailure } from '../components/editErrors'
import NewBlockSheet from '../components/NewBlockSheet'
import TimeField from '../components/TimeField'
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  CoffeeIcon,
  MoonIcon,
  PlayIcon,
  SkipIcon,
  PlusIcon,
  SparklesIcon,
  SunriseIcon
} from '../components/icons'

const PX_PER_MIN = 64 / 60

/** Below this a gap is real but not worth naming — the label would outsize the slot. */
const MIN_LABELLED_GAP = 15

const minutesOfISO = (iso: string): number => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

const timelineVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } }
}

/**
 * Deliberately does NOT animate `y`. Motion's `drag` writes to that same motion
 * value, so a variant setting `y: 0` and a drag setting `y: 120` fight each
 * other — any re-propagation from the parent snaps a half-dragged block back to
 * its origin. Scale carries the same entrance feeling and stays out of the way.
 */
const blockVariants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 380, damping: 28 } as const
  }
}

/** Minutes the grid snaps to while dragging — fine enough to be useful, coarse enough to hit. */
const SNAP_MINUTES = 5

/** Below this a block has no room for edge handles; use the sheet instead. */
const MIN_RESIZABLE_PX = 30

const snap = (minutes: number): number => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES

interface LaneProps {
  blocks: ScheduleBlock[]
  dayStartMin: number
  nowMin: number | null
  className: string
  runningId: string | null
  onSelect: (block: ScheduleBlock) => void
  /** dropped at a new start, duration unchanged */
  onMove: (block: ScheduleBlock, startMin: number) => void
  /** one edge dragged; the other stays put */
  onResize: (block: ScheduleBlock, edge: 'start' | 'end', minute: number) => void
}

function Lane({
  blocks,
  dayStartMin,
  nowMin,
  className,
  runningId,
  onSelect,
  onMove,
  onResize
}: LaneProps): React.JSX.Element {
  // A drag ends with a click, and Motion does not swallow it — without this the
  // sheet would open every time a block is dropped.
  const draggedRef = useRef(false)
  const [dragMinutes, setDragMinutes] = useState<{ id: string; start: number; end: number } | null>(
    null
  )
  // Hovering an edge handle disables the block's own drag.
  //
  // The handles sit INSIDE the block, so both would otherwise start a gesture
  // from the same pointerdown. Stopping propagation cannot separate them:
  // Motion binds natively to each element, so by the time a React handler runs
  // both native listeners have already fired — and stopping it in the capture
  // phase kills the handle's gesture along with the block's. Choosing which
  // element is draggable before the press avoids the conflict entirely.
  const [onHandle, setOnHandle] = useState(false)
  // DOM order is emission order — anchors, then focus, then parallel, with
  // replan appending placements afterwards. Blocks are absolutely positioned, so
  // without an explicit sort a later block paints over an earlier one wherever
  // two overlap. Chronological order plus a rising zIndex makes the stack read
  // the way the eye expects.
  const ordered = [...blocks].sort(byStart)

  // Dead time between blocks, labelled so a packed morning and a scattered one
  // read differently at a glance. Derived from the same `freeIntervals` the
  // planner uses, so what the gap says is what the planner would fill. Short
  // gaps are left blank — a label longer than its own slot is just noise.
  const gaps =
    ordered.length === 0
      ? []
      : freeIntervals(
          ordered.map(blockSpan),
          blockSpan(ordered[0]).start,
          Math.max(...ordered.map((b) => blockSpan(b).end))
        ).filter((g) => g.end - g.start >= MIN_LABELLED_GAP)

  return (
    <div className={className}>
      {gaps.map((gap) => (
        <div
          key={`gap-${gap.start}`}
          className="gap"
          style={{
            top: (gap.start - dayStartMin) * PX_PER_MIN,
            height: (gap.end - gap.start) * PX_PER_MIN
          }}
          aria-hidden="true"
        >
          <span className="gap-label">{formatMinutes(gap.end - gap.start)} free</span>
        </div>
      ))}
      {ordered.map((block, index) => {
        const { start, end } = blockSpan(block)
        const rawHeight = (end - start) * PX_PER_MIN - 3
        const current = nowMin !== null && nowMin >= start && nowMin < end
        const running = block.id === runningId
        const isBreak = block.kind === 'break'
        const isAnchor = block.kind === 'anchor'
        const isFree = block.kind === 'free'
        // a block shorter than the 22px floor gets drawn taller than its slot and
        // laps its neighbour; a single-line variant clamps that to 14px instead
        const tiny = !isBreak && rawHeight < 22
        const height = Math.max(rawHeight, isBreak ? 8 : tiny ? 14 : 22)
        // neither a break nor a prayer is yours to mark done, so neither is
        // tappable. Free time is — it is where you put things.
        const isFixed = isBreak || isAnchor
        const classes = [
          'block',
          isBreak ? 'break' : '',
          isAnchor ? 'anchor' : '',
          isFree ? 'free' : '',
          tiny ? 'tiny' : '',
          block.backlogTaskId ? 'from-backlog' : '',
          block.lane === 'parallel' ? 'parallel' : '',
          block.overflow ? 'overflow' : '',
          current ? 'current' : '',
          running ? 'running' : '',
          block.status === 'done' ? 'is-done' : '',
          block.status === 'skipped' ? 'is-skipped' : ''
        ]
          .filter(Boolean)
          .join(' ')

        const range = `${formatClock(block.start)} – ${formatClock(block.end)}`
        const body = isBreak ? (
          height >= 15 && (
            <>
              <CoffeeIcon size={11} />
              <span className="block-name">Break</span>
            </>
          )
        ) : isAnchor ? (
          <>
            <span className="block-name">
              {/* a routine and a prayer are both anchors to the generator, but
                  telling them apart at a glance is the point of showing icons */}
              {block.anchorSource === 'routine' ? (
                <SunriseIcon size={10} />
              ) : (
                <MoonIcon size={10} />
              )}
              {block.name}
            </span>
            {height >= 30 && <span className="block-time">{range}</span>}
          </>
        ) : isFree ? (
          // no icon and no flags: protected time has no status to report, and
          // the hatch is already carrying the meaning
          <>
            <span className="block-name">{block.name}</span>
            {height >= 30 && <span className="block-time">{range}</span>}
          </>
        ) : (
          <>
            <span className="block-name">{block.name}</span>
            {height >= 34 && (
              <span className="block-time">
                {block.actualMinutes !== null ? `${range} · took ${block.actualMinutes}m` : range}
              </span>
            )}
            <span className="block-flags">
              {running && <PlayIcon size={11} />}
              {block.status === 'done' && <CheckIcon size={11} />}
              {block.status === 'skipped' && <SkipIcon size={11} />}
              {block.overflow && (
                <span title="Runs past your day end">
                  <AlertIcon size={11} />
                </span>
              )}
            </span>
          </>
        )

        // breaks and prayers aren't markable, so they stay non-interactive
        if (isFixed) {
          return (
            <motion.div
              key={block.id}
              className={classes}
              variants={blockVariants}
              style={{ top: (start - dayStartMin) * PX_PER_MIN, height, zIndex: index }}
            >
              {body}
            </motion.div>
          )
        }

        // Settled and skipped blocks still render as buttons, but `moveBlock`
        // refuses them — history does not move. Guarding here rather than
        // letting the drag start and fail keeps the refusal honest.
        const draggable = !isImmovable(block)
        const live = dragMinutes?.id === block.id ? dragMinutes : null

        return (
          <motion.button
            key={block.id}
            className={live ? `${classes} is-dragging` : classes}
            variants={blockVariants}
            style={{
              top: (start - dayStartMin) * PX_PER_MIN,
              height,
              // the day's first block has zIndex 0 and would slide under its
              // neighbours; lift whatever is being dragged clear of everything
              zIndex: live ? 500 : index
            }}
            drag={draggable && !onHandle ? 'y' : false}
            dragMomentum={false}
            dragSnapToOrigin
            onDragStart={() => {
              draggedRef.current = true
              setDragMinutes({ id: block.id, start, end })
            }}
            onDrag={(_e, info) => {
              const delta = snap(info.offset.y / PX_PER_MIN)
              setDragMinutes({ id: block.id, start: start + delta, end: end + delta })
            }}
            onDragEnd={(_e, info) => {
              setDragMinutes(null)
              const delta = snap(info.offset.y / PX_PER_MIN)
              if (delta !== 0) onMove(block, start + delta)
              // let the trailing click land first, then re-enable selection
              setTimeout(() => (draggedRef.current = false), 0)
            }}
            onClick={() => {
              if (draggedRef.current) return
              onSelect(block)
            }}
            aria-label={
              isFree
                ? `Free time, ${formatClock(block.start)} to ${formatClock(block.end)}`
                : `${block.name}, ${formatClock(block.start)} to ${formatClock(block.end)}, ${block.status}`
            }
          >
            {body}
            {live && (
              <span className="drag-time">
                {formatClockMinutes(live.start)} – {formatClockMinutes(live.end)}
              </span>
            )}
            {draggable && height >= MIN_RESIZABLE_PX && (
              <>
                <motion.span
                  className="resize-handle top"
                  drag="y"
                  dragMomentum={false}
                  dragSnapToOrigin
                  onPointerEnter={() => setOnHandle(true)}
                  onPointerLeave={() => setOnHandle(false)}
                  onDragStart={() => {
                    draggedRef.current = true
                    setDragMinutes({ id: block.id, start, end })
                  }}
                  onDrag={(_e, info) =>
                    setDragMinutes({
                      id: block.id,
                      start: Math.min(start + snap(info.offset.y / PX_PER_MIN), end - SNAP_MINUTES),
                      end
                    })
                  }
                  onDragEnd={(_e, info) => {
                    setDragMinutes(null)
                    const next = Math.min(
                      start + snap(info.offset.y / PX_PER_MIN),
                      end - SNAP_MINUTES
                    )
                    if (next !== start) onResize(block, 'start', next)
                    setTimeout(() => (draggedRef.current = false), 0)
                  }}
                  aria-hidden="true"
                />
                <motion.span
                  className="resize-handle bottom"
                  drag="y"
                  dragMomentum={false}
                  dragSnapToOrigin
                  onPointerEnter={() => setOnHandle(true)}
                  onPointerLeave={() => setOnHandle(false)}
                  onDragStart={() => {
                    draggedRef.current = true
                    setDragMinutes({ id: block.id, start, end })
                  }}
                  onDrag={(_e, info) =>
                    setDragMinutes({
                      id: block.id,
                      start,
                      end: Math.max(end + snap(info.offset.y / PX_PER_MIN), start + SNAP_MINUTES)
                    })
                  }
                  onDragEnd={(_e, info) => {
                    setDragMinutes(null)
                    const next = Math.max(
                      end + snap(info.offset.y / PX_PER_MIN),
                      start + SNAP_MINUTES
                    )
                    if (next !== end) onResize(block, 'end', next)
                    setTimeout(() => (draggedRef.current = false), 0)
                  }}
                  aria-hidden="true"
                />
              </>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}

function SchedulePane(): React.JSX.Element {
  // prayer is no longer read here — `dayAnchors` resolves it, along with routines
  const { state, today, activities, settings, dispatch } = useData()
  const date = state.activeDate
  const timer = useTimer()
  const { stale } = useEndedBlocks()
  const pause = state.data.dayPause
  const [liveNow, setLiveNow] = useState(minutesNow())
  // a stopped clock is the truthful rendering when the day's clock is stopped
  const nowMin = pause ? minutesOfISO(pause.pausedAt) : liveNow
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragError, setDragError] = useState<string | null>(null)
  const [addingBlock, setAddingBlock] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setLiveNow(minutesNow()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const dayStartMin = parseHM(settings.dayStart)
  const dayEndMin = parseHM(settings.dayEnd)
  const invalidWindow = dayEndMin <= dayStartMin
  const canGenerate = activities.length > 0 && !invalidWindow

  const generate = (): void => {
    // Prayers and routines are resolved here, not in schedule.ts — the generator
    // takes anchors as plain data and knows nothing about what they represent.
    // `dayAnchors` is the same resolver the backlog planner uses, so the day this
    // button builds and the day the planner sees agree on what is fixed.
    const anchors: Anchor[] = dayAnchors(state.data, date)
    // Anything hand-edited or already settled survives regeneration, fed back in
    // as anchors so the generator flows around it. The seam costs nothing:
    // `generateSchedule` takes anchors as plain {name, start, end} data, and a
    // manual block is exactly that shape.
    //
    // Only focus-lane blocks become anchors — anchors are focus-only, so a pinned
    // parallel block would otherwise wrongly block focus work. It still survives
    // untouched via `keep`.
    const keep = blocks.filter((b) => b.manual || b.status !== 'planned')
    const pinned: Anchor[] = keep
      .filter((b) => b.lane === 'focus')
      .map((b) => {
        const span = blockSpan(b)
        return { name: b.name, start: span.start, end: span.end }
      })

    // An activity that already has a kept block must not be scheduled a second
    // time — otherwise moving "Reading" by hand and regenerating leaves you with
    // the block you moved AND a fresh one back where it started.
    const alreadyPlaced = new Set(keep.map((b) => b.activityId).filter(Boolean))
    const result = generateSchedule(
      activities.filter((a) => !alreadyPlaced.has(a.id)),
      settings,
      // `today` lets an activity with a deadline sort by how close that date is
      { anchors, reserved: pinned, today: date }
    )
    dispatch({
      type: 'setSchedule',
      date,
      blocks: [...keep, ...result.blocks],
      unscheduled: result.unscheduled
    })
    // setSchedule replaces the day wholesale, which drops any backlog work that
    // had been placed in it — re-place it around the freshly generated blocks.
    // Regenerating is an explicit action, so rebuilding the day here is expected.
    dispatch({ type: 'replan', date })
  }

  /**
   * Commit a gesture, or say why it was refused.
   *
   * `ripple: true` throughout: dropping a block onto an occupied slot pushes the
   * rest of the day down, absorbing into breaks and free time first. Asking
   * mid-gesture is not an option, and refusing a drop the user clearly meant is
   * worse than moving the day — which is undoable by dragging back.
   */
  const commit = (result: ReturnType<typeof moveBlock>): void => {
    if (!result.ok) {
      setDragError(describeEditFailure(result.error))
      return
    }
    setDragError(null)
    dispatch({ type: 'setDaySchedule', date, blocks: result.value })
  }

  const onMove = (block: ScheduleBlock, startMin: number): void =>
    commit(moveBlock(blocks, block.id, startMin, dayWindow, { ripple: true }))

  const onResize = (block: ScheduleBlock, edge: 'start' | 'end', minute: number): void =>
    commit(editBlock(blocks, block.id, { [edge]: minute }, dayWindow, { ripple: true }))

  const blocks = today.schedule ?? []
  const dayWindow = { dayStart: dayStartMin, dayEnd: dayEndMin }
  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null
  const focusBlocks = blocks.filter((b) => b.lane === 'focus')
  const parallelBlocks = blocks.filter((b) => b.lane === 'parallel')
  const hasParallel = parallelBlocks.length > 0

  const maxEnd = blocks.reduce((max, b) => Math.max(max, blockSpan(b).end), dayEndMin)
  const timelineHeight = (maxEnd - dayStartMin) * PX_PER_MIN

  // Every 30 minutes: the hour gets a label, the half gets a fainter unlabelled
  // tick. At 64px/hour a 30-minute block is 32px tall, which is hard to size by
  // eye against hour lines alone.
  const hourLines: number[] = []
  for (let m = Math.ceil(dayStartMin / 30) * 30; m <= maxEnd; m += 30) {
    hourLines.push(m)
  }

  const showNowLine = today.schedule !== null && nowMin >= dayStartMin && nowMin <= maxEnd

  return (
    <div className="pane">
      <h2 className="pane-title">
        Day plan
        <span className="grow" />
        {today.schedule && (
          <button
            className="btn-ghost"
            onClick={() => setAddingBlock(true)}
            aria-label="Add a block by hand"
          >
            <PlusIcon size={13} />
            Add block
          </button>
        )}
      </h2>
      <div className="sched-controls">
        <div className="sched-row">
          <span className="time-label">
            Start
            <TimeField
              value={settings.dayStart}
              onChange={(dayStart) => dispatch({ type: 'updateSettings', patch: { dayStart } })}
              step={15}
              label="Day start"
            />
          </span>
          <span className="range-dash">–</span>
          <span className="time-label">
            End
            <TimeField
              value={settings.dayEnd}
              onChange={(dayEnd) => dispatch({ type: 'updateSettings', patch: { dayEnd } })}
              step={15}
              label="Day end"
            />
          </span>
        </div>
        <div className="sched-row">
          <button
            className="switch"
            role="switch"
            aria-checked={settings.breaksEnabled}
            onClick={() =>
              dispatch({
                type: 'updateSettings',
                patch: { breaksEnabled: !settings.breaksEnabled }
              })
            }
          >
            Breaks
            <span className="switch-track">
              <motion.span
                layout
                className="switch-thumb"
                transition={{ type: 'spring', stiffness: 600, damping: 32 }}
              />
            </span>
          </button>
          <motion.button
            className="btn-primary grow"
            onClick={generate}
            disabled={!canGenerate}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            <SparklesIcon size={14} />
            {today.schedule ? 'Regenerate schedule' : 'Generate schedule'}
          </motion.button>
        </div>
        {invalidWindow && <p className="hint hint-warn">End time must be after start time.</p>}
        {activities.length === 0 && (
          <p className="hint">
            Add activities in the Activities tab first — they fuel the schedule.
          </p>
        )}
      </div>

      {/*
        Being asked at 4pm whether you finished the 3:50 block is the feature;
        being asked about the 9am one is noise. Anything past the window lands
        here instead of interrupting. "Leave them" stamps promptedAt with no
        status change — the record then says "we asked, you declined to answer",
        which is true, rather than inventing an outcome.
      */}
      {stale.length > 0 && (
        <div className="catchup">
          <span className="catchup-text">
            {stale.length} block{stale.length === 1 ? '' : 's'} ended while you were away
          </span>
          <button
            className="sheet-btn"
            onClick={() =>
              stale.forEach((b) => dispatch({ type: 'markBlockPrompted', date, blockId: b.id }))
            }
          >
            Leave them
          </button>
        </div>
      )}

      {today.schedule === null || blocks.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon size={20} />}
          title="No schedule yet"
          hint="Set your day window above and generate a plan from your activities."
        />
      ) : (
        <>
          {hasParallel && (
            <div className="lane-headers">
              <span className="spacer-focus">
                <span className="lane-chip focus">Focus</span>
              </span>
              <span className="spacer-parallel">
                <span className="lane-chip parallel">Parallel</span>
              </span>
            </div>
          )}
          <motion.div
            key={date}
            className={pause ? 'timeline is-paused' : 'timeline'}
            style={{ height: timelineHeight + 12 }}
            variants={timelineVariants}
            initial="hidden"
            animate="show"
          >
            {/*
              One coordinate origin for the ruler, the lanes and the now-line.
              The hour lines used to be absolute against `.timeline`, whose
              padding-top pushed `.lanes` 7px lower — so every hour label sat 7px
              off the block it was marking, all the way down the day.
            */}
            <div className="timeline-body" style={{ height: timelineHeight }}>
              {hourLines.map((m) => (
                <div
                  key={m}
                  className={m % 60 === 0 ? 'hourline' : 'hourline half'}
                  style={{ top: (m - dayStartMin) * PX_PER_MIN }}
                >
                  {m % 60 === 0 && <span className="hourline-label">{formatClockMinutes(m)}</span>}
                </div>
              ))}
              {/* a refused gesture has no sheet to report into, so it says so here */}
              <AnimatePresence>
                {dragError && (
                  <motion.button
                    className="drag-error"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setDragError(null)}
                  >
                    {dragError}
                  </motion.button>
                )}
              </AnimatePresence>
              <div className="lanes">
                <Lane
                  blocks={focusBlocks}
                  dayStartMin={dayStartMin}
                  nowMin={showNowLine ? nowMin : null}
                  runningId={timer?.block.id ?? null}
                  onSelect={(b) => setSelectedId(b.id)}
                  onMove={onMove}
                  onResize={onResize}
                  className="lane"
                />
                {hasParallel && (
                  <Lane
                    blocks={parallelBlocks}
                    dayStartMin={dayStartMin}
                    nowMin={showNowLine ? nowMin : null}
                    runningId={timer?.block.id ?? null}
                    onSelect={(b) => setSelectedId(b.id)}
                    onMove={onMove}
                    onResize={onResize}
                    className="lane lane-parallel"
                  />
                )}
              </div>
              {showNowLine && (
                <div className="nowline" style={{ top: (nowMin - dayStartMin) * PX_PER_MIN }} />
              )}
            </div>
          </motion.div>
          {today.unscheduled && today.unscheduled.length > 0 && (
            <div className="unscheduled">
              <span className="unscheduled-title">
                <AlertIcon size={12} />
                Didn&apos;t fit in the day
              </span>
              <div className="chips">
                {today.unscheduled.map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {addingBlock && (
          <NewBlockSheet
            date={date}
            // opening on the next round hour beats opening on dayStart, which is
            // usually hours behind by the time you want to add something
            defaultStart={formatHM(Math.min(Math.ceil(nowMin / 60) * 60, dayEndMin))}
            onClose={() => setAddingBlock(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selectedBlock && (
          <BlockSheet
            key={selectedBlock.id}
            block={selectedBlock}
            date={date}
            onClose={() => setSelectedId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default SchedulePane
