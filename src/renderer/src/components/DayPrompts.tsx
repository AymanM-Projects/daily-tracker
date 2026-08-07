import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ScheduleBlock } from '@shared/types'
import { blockSpan } from '@shared/blocks'
import { formatClock, formatMinutes } from '@shared/time'
import { useData } from '../state/DataContext'
import { useEndedBlocks } from '../hooks/useEndedBlocks'
import Sheet from './Sheet'
import { CheckIcon, ClockIcon, PlayIcon } from './icons'

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
 * Finished ahead of the slot. The released span becomes protected free time by
 * default, because the alternative — leaving a bare gap — means the next replan
 * reclaims those minutes and "I finished early" silently resolves to "here is
 * more work".
 */
function EarlyFinishPrompt({
  block,
  onDone
}: {
  block: ScheduleBlock
  onDone: () => void
}): React.JSX.Element {
  const { state, dispatch } = useData()
  const date = state.activeDate
  const span = blockSpan(block)
  const freed = span.end - (span.start + (block.actualMinutes ?? 0))

  const choose = (fill: 'free' | 'pull', thenStart?: boolean): void => {
    dispatch({
      type: 'truncateBlock',
      date,
      blockId: block.id,
      actualMinutes: block.actualMinutes ?? 0,
      fill
    })
    if (thenStart) {
      // deliberately a separate decision: pulling the day earlier and choosing
      // to start the next thing right now are two different intents
      const next = (state.data.days[date]?.schedule ?? [])
        .filter((b) => b.kind === 'activity' && b.status === 'planned' && b.id !== block.id)
        .sort((a, b) => blockSpan(a).start - blockSpan(b).start)[0]
      if (next) dispatch({ type: 'startTimer', date, blockId: next.id })
    }
    onDone()
  }

  return (
    <Sheet
      title={`${formatMinutes(freed)} back`}
      subtitle={`You finished ${block.name} early. What should happen to the time?`}
      className="sheet-prompt"
      dismissOnScrim={false}
      // dismissing DOES settle this one: it is an offer, and declining an offer
      // is a real answer. The mirror image of the completion prompt's defer.
      onClose={() => {
        dispatch({ type: 'markBlockPrompted', date, blockId: block.id })
        onDone()
      }}
    >
      <div className="stack">
        <button className="sheet-btn primary" autoFocus onClick={() => choose('free')}>
          <CheckIcon size={14} />
          Keep it free
        </button>
        <button className="sheet-btn" onClick={() => choose('pull')}>
          <ClockIcon size={14} />
          Pull the rest of the day earlier
        </button>
        <button className="sheet-btn" onClick={() => choose('pull', true)}>
          <PlayIcon size={14} />
          Start the next task now
        </button>
      </div>
    </Sheet>
  )
}

/**
 * Mounted outside the pane `AnimatePresence` in `App.tsx`: panes unmount on tab
 * switch, and a prompt has to survive that.
 */
function DayPrompts(): React.JSX.Element {
  const { current, earlyFinish, defer } = useEndedBlocks()
  const [answered, setAnswered] = useState<string | null>(null)

  // an early finish is about the block you just closed, so it outranks a
  // question about one that merely ran out
  const showEarly = earlyFinish && earlyFinish.id !== answered
  const showEnded = !showEarly && current && current.id !== answered

  return (
    <AnimatePresence>
      {showEarly && (
        <EarlyFinishPrompt
          key={`early-${earlyFinish.id}`}
          block={earlyFinish}
          onDone={() => setAnswered(earlyFinish.id)}
        />
      )}
      {showEnded && (
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
