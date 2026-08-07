import { AnimatePresence, motion } from 'motion/react'
import { useData } from '../state/DataContext'
import { useTimer } from '../hooks/useTimer'
import { formatDuration } from '@shared/timer'
import { formatDateLabel } from '@shared/time'
import { CheckIcon, MoonIcon, PauseIcon, PinIcon, PlayIcon, SunIcon, XIcon } from './icons'

function TitleBar(): React.JSX.Element {
  const { state, settings, dispatch } = useData()
  const timer = useTimer()
  const pinned = settings.alwaysOnTop
  const paused = state.data.dayPause !== null

  const togglePin = (): void => {
    const next = !pinned
    dispatch({ type: 'updateSettings', patch: { alwaysOnTop: next } })
    void window.api.setAlwaysOnTop(next)
  }

  // Resolve 'system' to what is actually on screen before flipping it. Toggling
  // the stored value alone would make the first press from 'system' a no-op
  // whenever the OS already matched — the button has to do what its icon says.
  const isDark =
    settings.theme === 'system'
      ? !window.matchMedia('(prefers-color-scheme: light)').matches
      : settings.theme === 'dark'

  const toggleTheme = (): void => {
    dispatch({ type: 'updateSettings', patch: { theme: isDark ? 'light' : 'dark' } })
  }

  return (
    <header className={paused ? 'titlebar is-paused' : 'titlebar'}>
      <AnimatePresence mode="wait" initial={false}>
        {/* paused outranks the timer, which outranks the date: a frozen day is a
            global mode and the title bar is the only surface that survives a tab
            switch, so it has to say so */}
        {paused ? (
          <motion.div
            key="paused"
            className="tb-timer"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
          >
            <span className="tb-clock paused">Paused</span>
            <span className="tb-block-name">Day on hold</span>
            <div className="tb-actions">
              <motion.button
                className="tb-btn done"
                onClick={() => dispatch({ type: 'resumeDay' })}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                aria-label="Resume the day"
              >
                <PlayIcon size={13} />
              </motion.button>
            </div>
          </motion.div>
        ) : timer ? (
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
      {!paused && (
        <motion.button
          className="pin-btn"
          onClick={() => dispatch({ type: 'pauseDay', date: state.activeDate })}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          aria-label="Pause the day"
          title="Something came up — freeze the day"
        >
          <PauseIcon size={15} />
        </motion.button>
      )}
      <motion.button
        className="pin-btn"
        onClick={toggleTheme}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Light mode' : 'Dark mode'}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={isDark ? 'sun' : 'moon'}
            className="theme-icon"
            initial={{ opacity: 0, rotate: -60 }}
            animate={{ opacity: 1, rotate: 0 }}
            exit={{ opacity: 0, rotate: 60 }}
            transition={{ duration: 0.16 }}
          >
            {isDark ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          </motion.span>
        </AnimatePresence>
      </motion.button>
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
