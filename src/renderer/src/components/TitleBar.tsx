import { AnimatePresence, motion } from 'motion/react'
import { useData } from '../state/DataContext'
import { useTimer } from '../hooks/useTimer'
import { formatDuration } from '@shared/timer'
import { formatDateLabel } from '@shared/time'
import { CheckIcon, PauseIcon, PinIcon, PlayIcon, XIcon } from './icons'

function TitleBar(): React.JSX.Element {
  const { state, settings, dispatch } = useData()
  const timer = useTimer()
  const pinned = settings.alwaysOnTop

  const togglePin = (): void => {
    const next = !pinned
    dispatch({ type: 'updateSettings', patch: { alwaysOnTop: next } })
    void window.api.setAlwaysOnTop(next)
  }

  return (
    <header className="titlebar">
      <AnimatePresence mode="wait" initial={false}>
        {timer ? (
          <motion.div
            key="timer"
            className="tb-timer"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
          >
            <span
              className={
                timer.overrun ? 'tb-clock over' : timer.paused ? 'tb-clock paused' : 'tb-clock'
              }
            >
              {formatDuration(timer.elapsed)}
            </span>
            <span className="tb-block-name">{timer.block.name}</span>
            <div className="tb-actions">
              <motion.button
                className="tb-btn"
                onClick={() => dispatch({ type: timer.paused ? 'resumeTimer' : 'pauseTimer' })}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                aria-label={timer.paused ? 'Resume timer' : 'Pause timer'}
              >
                {timer.paused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
              </motion.button>
              <motion.button
                className="tb-btn done"
                onClick={() => dispatch({ type: 'completeTimer' })}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                aria-label="Finish and mark done"
              >
                <CheckIcon size={13} />
              </motion.button>
              <motion.button
                className="tb-btn"
                onClick={() => dispatch({ type: 'cancelTimer' })}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                aria-label="Discard timer"
              >
                <XIcon size={13} />
              </motion.button>
            </div>
          </motion.div>
        ) : (
          <motion.span
            key="date"
            className="titlebar-date"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
          >
            {formatDateLabel(state.activeDate)}
          </motion.span>
        )}
      </AnimatePresence>
      <motion.button
        className={pinned ? 'pin-btn active' : 'pin-btn'}
        onClick={togglePin}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        aria-label={pinned ? 'Stop keeping window on top' : 'Keep window on top'}
        aria-pressed={pinned}
        title={pinned ? 'Unpin from top' : 'Pin on top of other windows'}
      >
        <PinIcon size={15} />
      </motion.button>
    </header>
  )
}

export default TitleBar
