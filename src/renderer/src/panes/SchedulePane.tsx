import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ScheduleBlock } from '@shared/types'
import { generateSchedule, type Anchor } from '@shared/schedule'
import { prayerTimes } from '@shared/prayer'
import { formatClock, formatClockMinutes, minutesNow, parseHM } from '@shared/time'
import { useData } from '../state/DataContext'
import { useTimer } from '../hooks/useTimer'
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

function blockBounds(block: ScheduleBlock): { start: number; end: number } {
  const start = parseHM(block.start)
  let end = parseHM(block.end)
  if (end <= start) end += 1440
  return { start, end }
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
  return (
    <div className={className}>
      {blocks.map((block) => {
        const { start, end } = blockBounds(block)
        const rawHeight = (end - start) * PX_PER_MIN - 3
        const height = Math.max(rawHeight, block.kind === 'break' ? 8 : 22)
        const current = nowMin !== null && nowMin >= start && nowMin < end
        const running = block.id === runningId
        const isBreak = block.kind === 'break'
        const isAnchor = block.kind === 'anchor'
        // neither a break nor a prayer is yours to mark done, so neither is tappable
        const isFixed = isBreak || isAnchor
        const classes = [
          'block',
          isBreak ? 'break' : '',
          isAnchor ? 'anchor' : '',
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
            style={{ top: (start - dayStartMin) * PX_PER_MIN, height }}
          >
            {body}
          </motion.div>
        ) : (
          <motion.button
            key={block.id}
            className={classes}
            variants={blockVariants}
            style={{ top: (start - dayStartMin) * PX_PER_MIN, height }}
            onClick={() => onSelect(block)}
            aria-label={`${block.name}, ${formatClock(block.start)} to ${formatClock(block.end)}, ${block.status}`}
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
    const result = generateSchedule(activities, settings, { anchors })
    dispatch({ type: 'setSchedule', date, blocks: result.blocks, unscheduled: result.unscheduled })
  }

  const blocks = today.schedule ?? []
  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null
  const focusBlocks = blocks.filter((b) => b.lane === 'focus')
  const parallelBlocks = blocks.filter((b) => b.lane === 'parallel')
  const hasParallel = parallelBlocks.length > 0

  const maxEnd = blocks.reduce((max, b) => Math.max(max, blockBounds(b).end), dayEndMin)
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
