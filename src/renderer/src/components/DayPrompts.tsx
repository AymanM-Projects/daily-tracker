import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ScheduleBlock } from '@shared/types'
import { formatClock, formatMinutes } from '@shared/time'
import { useData } from '../state/DataContext'
import { useEndedBlocks } from '../hooks/useEndedBlocks'
import Sheet from './Sheet'
import { CheckIcon, ClockIcon } from './icons'

const MORE_OPTIONS = [10, 15, 30]

type Stage = 'finished' | 'more'
type Placement = 'now' | 'later'

interface PromptProps {
  block: ScheduleBlock
  onDone: () => void
  onDefer: () => void
}

/**
 * "Did you finish X?" — a bottom sheet rather than a centred dialog, because
 * every modal surface here is one and the timeline staying visible above it is
 * exactly the context needed to answer. It is differentiated by weight, not
 * geometry: an accent hairline and a scrim that does not dismiss.
 */
function BlockPrompt({ block, onDone, onDefer }: PromptProps): React.JSX.Element {
  const { state, dispatch } = useData()
  const [stage, setStage] = useState<Stage>('finished')
  const [minutes, setMinutes] = useState(15)
  const [placement, setPlacement] = useState<Placement>('now')
  const date = state.activeDate

  const finish = (): void => {
    dispatch({ type: 'setBlockStatus', date, blockId: block.id, status: 'done' })
    dispatch({ type: 'markBlockPrompted', date, blockId: block.id })
    onDone()
  }

  const commitMore = (): void => {
    dispatch(
      placement === 'now'
        ? { type: 'extendBlock', date, blockId: block.id, minutes }
        : { type: 'bankBlockTime', date, blockId: block.id, minutes }
    )
    // bankBlockTime stamps promptedAt itself, as part of settling the block
    if (placement === 'now') dispatch({ type: 'markBlockPrompted', date, blockId: block.id })
    onDone()
  }

  return (
    <Sheet
      title={stage === 'finished' ? `Did you finish ${block.name}?` : 'How much more?'}
      subtitle={
        stage === 'finished'
          ? `Ended at ${formatClock(block.end)}`
          : `${block.name} · ${formatClock(block.start)} – ${formatClock(block.end)}`
      }
      className="sheet-prompt"
      dismissOnScrim={false}
      onClose={onDefer}
    >
      <AnimatePresence mode="wait">
        {stage === 'finished' ? (
          <motion.div
            key="finished"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="sheet-actions"
          >
            {/* autofocused, so Enter answers the common case */}
            <button className="sheet-btn primary" autoFocus onClick={finish}>
              <CheckIcon size={14} />
              Yes, done
            </button>
            <button className="sheet-btn" onClick={() => setStage('more')}>
              <ClockIcon size={14} />
              Not yet
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="more"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="block-edit"
          >
            <div className="seg-row">
              <span className="seg-label">Add</span>
              <div className="seg">
                {MORE_OPTIONS.map((m) => (
                  <button
                    key={m}
                    className={minutes === m ? 'active' : undefined}
                    onClick={() => setMinutes(m)}
                  >
                    +{m}m
                  </button>
                ))}
              </div>
            </div>

            <div className="seg-row">
              <span className="seg-label">Where</span>
              <div className="seg">
                <button
                  className={placement === 'now' ? 'active' : undefined}
                  onClick={() => setPlacement('now')}
                >
                  More now
                </button>
                <button
                  className={placement === 'later' ? 'active' : undefined}
                  onClick={() => setPlacement('later')}
                >
                  Keep for later
                </button>
              </div>
            </div>

            {/* spell out the consequence rather than making the user infer it */}
            <p className="hint">
              {placement === 'now'
                ? `${block.name} runs ${formatMinutes(minutes)} longer. Free time absorbs what it can; the rest of the day shifts by whatever is left.`
                : `This block closes as partly done, and ${formatMinutes(minutes)} goes back on your list to be scheduled later.`}
            </p>

            <div className="sheet-actions">
              <button className="sheet-btn" onClick={() => setStage('finished')}>
                Back
              </button>
              <button className="sheet-btn primary" onClick={commitMore}>
                <CheckIcon size={14} />
                Confirm
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  )
}

/**
 * Mounted outside the pane `AnimatePresence` in `App.tsx`: panes unmount on tab
 * switch, and a prompt has to survive that.
 */
function DayPrompts(): React.JSX.Element {
  const { current, defer } = useEndedBlocks()
  const [answered, setAnswered] = useState<string | null>(null)

  return (
    <AnimatePresence>
      {current && current.id !== answered && (
        <BlockPrompt
          key={current.id}
          block={current}
          onDone={() => setAnswered(current.id)}
          onDefer={() => defer(current.id)}
        />
      )}
    </AnimatePresence>
  )
}

export default DayPrompts
