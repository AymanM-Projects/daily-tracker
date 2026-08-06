import { useState } from 'react'
import { motion } from 'motion/react'
import type { BlockStatus, DateKey, ScheduleBlock } from '@shared/types'
import { useData } from '../state/DataContext'
import { useTimer } from '../hooks/useTimer'
import { CheckIcon, PauseIcon, PlayIcon, SkipIcon, XIcon } from './icons'

interface BlockSheetProps {
  block: ScheduleBlock
  date: DateKey
  onClose: () => void
}

/**
 * Tapping a block opens this rather than cycling status in place — blocks can be
 * as short as 22px, and an accidental tap silently rewriting the record is worse
 * than one extra tap.
 */
function BlockSheet({ block, date, onClose }: BlockSheetProps): React.JSX.Element {
  const { dispatch } = useData()
  const timer = useTimer()
  const [actual, setActual] = useState(
    block.actualMinutes === null ? '' : String(block.actualMinutes)
  )

  const isRunning = timer?.block.id === block.id
  const status = block.status

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

  return (
    <>
      <motion.div
        className="sheet-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet"
        role="dialog"
        aria-label={`Actions for ${block.name}`}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      >
        <div className="sheet-head">
          <div>
            <p className="sheet-title">{block.name}</p>
            <p className="sheet-sub">
              {block.start}–{block.end}
              {block.actualMinutes !== null && ` · took ${block.actualMinutes}m`}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </button>
        </div>

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
      </motion.div>
    </>
  )
}

export default BlockSheet
