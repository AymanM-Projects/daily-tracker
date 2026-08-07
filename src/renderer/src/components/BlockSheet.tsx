import { useState } from 'react'
import type { BlockStatus, DateKey, ScheduleBlock } from '@shared/types'
import { formatClock, parseHM } from '@shared/time'
import { getDay } from '@shared/defaults'
import { editBlock, removeBlock, type EditFailure } from '@shared/reschedule'
import { useData } from '../state/DataContext'
import { useTimer } from '../hooks/useTimer'
import Sheet from './Sheet'
import { describeEditFailure } from './editErrors'
import TimeField from './TimeField'
import { CheckIcon, ChevronRightIcon, PauseIcon, PlayIcon, SkipIcon, TrashIcon } from './icons'

interface BlockSheetProps {
  block: ScheduleBlock
  date: DateKey
  onClose: () => void
}

/**
 * Tapping a block opens this rather than cycling status in place — blocks can be
 * as short as 14px, and an accidental tap silently rewriting the record is worse
 * than one extra tap.
 *
 * Editing sits behind a disclosure so the default face stays the four-control
 * surface it has always been: the common case is marking a block, not moving it.
 */
function BlockSheet({ block, date, onClose }: BlockSheetProps): React.JSX.Element {
  const { state, activities, settings, dispatch } = useData()
  const timer = useTimer()
  const [actual, setActual] = useState(
    block.actualMinutes === null ? '' : String(block.actualMinutes)
  )
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(block.name)
  const [start, setStart] = useState(block.start)
  const [end, setEnd] = useState(block.end)
  const [ripple, setRipple] = useState(false)
  const [error, setError] = useState<EditFailure | null>(null)

  const blocks = getDay(state.data, date).schedule ?? []
  const dayWindow = { dayStart: parseHM(settings.dayStart), dayEnd: parseHM(settings.dayEnd) }
  const isRunning = timer?.block.id === block.id
  const isFree = block.kind === 'free'
  const status = block.status
  const generatedName = block.backlogTaskId !== null

  const commitActual = (): void => {
    const trimmed = actual.trim()
    const parsed = trimmed === '' ? null : Number.parseInt(trimmed, 10)
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return
    dispatch({ type: 'setBlockActualMinutes', date, blockId: block.id, minutes: parsed })
  }

  const setStatus = (next: BlockStatus): void => {
    dispatch({ type: 'setBlockStatus', date, blockId: block.id, status: next })
    onClose()
  }

  /** Geometry is computed here so a refusal can name what is in the way. */
  const apply = (nextStart: number, nextEnd: number, nextName?: string): void => {
    const result = editBlock(
      blocks,
      block.id,
      { start: nextStart, end: nextEnd, ...(nextName === undefined ? {} : { name: nextName }) },
      dayWindow,
      { ripple }
    )
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    dispatch({ type: 'setDaySchedule', date, blocks: result.value })
    onClose()
  }

  const nudge = (deltaStart: number, deltaEnd: number): void =>
    apply(parseHM(start) + deltaStart, parseHM(end) + deltaEnd)

  const remove = (): void => {
    // backlog work must leave protected time behind, or the next replan finds the
    // gap plus the minutes it just released and puts the block straight back
    dispatch({
      type: 'setDaySchedule',
      date,
      blocks: removeBlock(blocks, block.id, { vacate: generatedName ? 'free' : 'gap' })
    })
    onClose()
  }

  return (
    <Sheet
      title={block.name}
      subtitle={
        <>
          {formatClock(block.start)} – {formatClock(block.end)}
          {block.actualMinutes !== null && ` · took ${block.actualMinutes}m`}
        </>
      }
      ariaLabel={`Actions for ${block.name}`}
      onClose={onClose}
    >
      {!isFree && (
        <>
          <div className="sheet-actions">
            {isRunning ? (
              <>
                <button
                  className="sheet-btn"
                  onClick={() => dispatch({ type: timer.paused ? 'resumeTimer' : 'pauseTimer' })}
                >
                  {timer.paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
                  {timer.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  className="sheet-btn primary"
                  onClick={() => {
                    dispatch({ type: 'completeTimer' })
                    onClose()
                  }}
                >
                  <CheckIcon size={14} />
                  Finish
                </button>
              </>
            ) : (
              <button
                className="sheet-btn primary"
                onClick={() => {
                  dispatch({ type: 'startTimer', date, blockId: block.id })
                  onClose()
                }}
              >
                <PlayIcon size={14} />
                Start timer
              </button>
            )}
          </div>

          <div className="sheet-actions">
            <button
              className={status === 'done' ? 'sheet-btn active-done' : 'sheet-btn'}
              onClick={() => setStatus(status === 'done' ? 'planned' : 'done')}
            >
              <CheckIcon size={14} />
              {status === 'done' ? 'Mark not done' : 'Mark done'}
            </button>
            <button
              className={status === 'skipped' ? 'sheet-btn active-skip' : 'sheet-btn'}
              onClick={() => setStatus(status === 'skipped' ? 'planned' : 'skipped')}
            >
              <SkipIcon size={14} />
              {status === 'skipped' ? 'Unskip' : 'Skip'}
            </button>
          </div>

          <label className="sheet-field">
            <span>Actual minutes</span>
            <input
              className="field"
              type="number"
              min={0}
              step={5}
              value={actual}
              placeholder="—"
              onChange={(e) => setActual(e.target.value)}
              onBlur={commitActual}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitActual()
                  onClose()
                }
              }}
            />
          </label>
        </>
      )}

      <button
        className={open ? 'disclosure is-open' : 'disclosure'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRightIcon size={13} />
        {isFree ? 'Edit this free time' : 'Move or resize'}
      </button>

      {open && (
        <div className="block-edit">
          <div className="seg-row">
            <span className="seg-label">Move</span>
            <div className="seg">
              <button onClick={() => nudge(-15, -15)}>−15m</button>
              <button onClick={() => nudge(15, 15)}>+15m</button>
            </div>
          </div>
          <div className="seg-row">
            <span className="seg-label">Length</span>
            <div className="seg">
              <button onClick={() => nudge(0, -15)}>−15m</button>
              <button onClick={() => nudge(0, 15)}>+15m</button>
            </div>
          </div>

          {!isFree && (
            <label className="sheet-field">
              <span>Name</span>
              <input
                className="field"
                list="activity-names"
                value={name}
                disabled={generatedName}
                onChange={(e) => setName(e.target.value)}
              />
              <datalist id="activity-names">
                {activities.map((a) => (
                  <option key={a.id} value={a.name} />
                ))}
              </datalist>
            </label>
          )}

          <div className="sheet-row">
            <span className="time-label">
              Start
              <TimeField value={start} onChange={setStart} label="Block start" />
            </span>
            <span className="range-dash">–</span>
            <span className="time-label">
              End
              <TimeField value={end} onChange={setEnd} label="Block end" />
            </span>
          </div>

          {error && (
            <div className="edit-error">
              <p className="hint hint-warn">{describeEditFailure(error)}</p>
              {error.code === 'collision' && (
                <button
                  className="switch"
                  role="switch"
                  aria-checked={ripple}
                  onClick={() => setRipple((v) => !v)}
                >
                  Shift the rest of the day
                  <span className="switch-track">
                    <span className="switch-thumb" />
                  </span>
                </button>
              )}
            </div>
          )}

          <div className="sheet-actions">
            <button className="sheet-btn danger" onClick={remove}>
              <TrashIcon size={14} />
              Delete
            </button>
            {/* an Apply button, not onBlur — a half-typed time is a destructive commit */}
            <button
              className="sheet-btn primary"
              onClick={() =>
                apply(parseHM(start), parseHM(end), isFree || generatedName ? undefined : name)
              }
            >
              <CheckIcon size={14} />
              Apply
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

export default BlockSheet
