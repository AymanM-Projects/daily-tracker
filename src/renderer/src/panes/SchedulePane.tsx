import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ScheduleBlock } from '@shared/types'
import { generateSchedule, type Anchor } from '@shared/schedule'
import { prayerTimes } from '@shared/prayer'
import { blockSpan, byStart } from '@shared/blocks'
import { formatClock, formatClockMinutes, minutesNow, parseHM } from '@shared/time'
import { useData } from '../state/DataContext'
import { useTimer } from '../hooks/useTimer'
import { useEndedBlocks } from '../hooks/useEndedBlocks'
import EmptyState from '../components/EmptyState'
import BlockSheet from '../components/BlockSheet'
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  CoffeeIcon,
  MoonIcon,
  PlayIcon,
  SkipIcon,
  SparklesIcon
} from '../components/icons'

const PX_PER_MIN = 64 / 60

const timelineVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } }
}

const blockVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 380, damping: 28 } as const }
}

interface LaneProps {
  blocks: ScheduleBlock[]
  dayStartMin: number
  nowMin: number | null
  className: string
  runningId: string | null
  onSelect: (block: ScheduleBlock) => void
}

function Lane({
  blocks,
  dayStartMin,
  nowMin,
  className,
  runningId,
  onSelect
}: LaneProps): React.JSX.Element {
  // DOM order is emission order — anchors, then focus, then parallel, with
  // replan appending placements afterwards. Blocks are absolutely positioned, so
  // without an explicit sort a later block paints over an earlier one wherever
  // two overlap. Chronological order plus a rising zIndex makes the stack read
  // the way the eye expects.
  const ordered = [...blocks].sort(byStart)

  return (
    <div className={className}>
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
              <MoonIcon size={10} />
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
        return isFixed ? (
          <motion.div
            key={block.id}
            className={classes}
            variants={blockVariants}
            style={{ top: (start - dayStartMin) * PX_PER_MIN, height, zIndex: index }}
          >
            {body}
          </motion.div>
        ) : (
          <motion.button
            key={block.id}
            className={classes}
            variants={blockVariants}
            style={{ top: (start - dayStartMin) * PX_PER_MIN, height, zIndex: index }}
            onClick={() => onSelect(block)}
            aria-label={
              isFree
                ? `Free time, ${formatClock(block.start)} to ${formatClock(block.end)}`
                : `${block.name}, ${formatClock(block.start)} to ${formatClock(block.end)}, ${block.status}`
            }
          >
            {body}
          </motion.button>
        )
      })}
    </div>
  )
}

function SchedulePane(): React.JSX.Element {
  const { state, today, activities, settings, prayer, dispatch } = useData()
  const date = state.activeDate
  const timer = useTimer()
  const { stale } = useEndedBlocks()
  const [nowMin, setNowMin] = useState(minutesNow())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const interval = setInterval(() => setNowMin(minutesNow()), 30_000)
    return () => clearInterval(interval)
  }, [])

  const dayStartMin = parseHM(settings.dayStart)
  const dayEndMin = parseHM(settings.dayEnd)
  const invalidWindow = dayEndMin <= dayStartMin
  const canGenerate = activities.length > 0 && !invalidWindow

  const generate = (): void => {
    // prayer times are resolved here, not in schedule.ts — the generator takes
    // anchors as plain data and knows nothing about what they represent
    const anchors: Anchor[] = prayer.enabled
      ? prayerTimes(date, prayer)
          .filter((t) => prayer.include.includes(t.name))
          .map((t) => ({
            name: t.name,
            start: t.minutes,
            end: t.minutes + prayer.blockMinutes
          }))
      : []
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

    const result = generateSchedule(activities, settings, { anchors: [...anchors, ...pinned] })
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

  const blocks = today.schedule ?? []
  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null
  const focusBlocks = blocks.filter((b) => b.lane === 'focus')
  const parallelBlocks = blocks.filter((b) => b.lane === 'parallel')
  const hasParallel = parallelBlocks.length > 0

  const maxEnd = blocks.reduce((max, b) => Math.max(max, blockSpan(b).end), dayEndMin)
  const timelineHeight = (maxEnd - dayStartMin) * PX_PER_MIN

  const hourLines: number[] = []
  for (let m = Math.ceil(dayStartMin / 60) * 60; m <= maxEnd; m += 60) {
    hourLines.push(m)
  }

  const showNowLine = today.schedule !== null && nowMin >= dayStartMin && nowMin <= maxEnd

  return (
    <div className="pane">
      <h2 className="pane-title">Day plan</h2>
      <div className="sched-controls">
        <div className="sched-row">
          <label className="time-label">
            Start
            <input
              className="field field-time"
              type="time"
              value={settings.dayStart}
              onChange={(e) =>
                dispatch({ type: 'updateSettings', patch: { dayStart: e.target.value } })
              }
            />
          </label>
          <span className="range-dash">–</span>
          <label className="time-label">
            End
            <input
              className="field field-time"
              type="time"
              value={settings.dayEnd}
              onChange={(e) =>
                dispatch({ type: 'updateSettings', patch: { dayEnd: e.target.value } })
              }
            />
          </label>
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
            key={blocks[0].id}
            className="timeline"
            style={{ height: timelineHeight + 12 }}
            variants={timelineVariants}
            initial="hidden"
            animate="show"
          >
            {hourLines.map((m) => (
              <div key={m} className="hourline" style={{ top: (m - dayStartMin) * PX_PER_MIN }}>
                <span className="hourline-label">{formatClockMinutes(m)}</span>
              </div>
            ))}
            <div className="lanes">
              <Lane
                blocks={focusBlocks}
                dayStartMin={dayStartMin}
                nowMin={showNowLine ? nowMin : null}
                runningId={timer?.block.id ?? null}
                onSelect={(b) => setSelectedId(b.id)}
                className="lane"
              />
              {hasParallel && (
                <Lane
                  blocks={parallelBlocks}
                  dayStartMin={dayStartMin}
                  nowMin={showNowLine ? nowMin : null}
                  runningId={timer?.block.id ?? null}
                  onSelect={(b) => setSelectedId(b.id)}
                  className="lane lane-parallel"
                />
              )}
            </div>
            {showNowLine && (
              <div className="nowline" style={{ top: (nowMin - dayStartMin) * PX_PER_MIN }} />
            )}
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
