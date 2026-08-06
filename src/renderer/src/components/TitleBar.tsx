import { motion } from 'motion/react'
import { useData } from '../state/DataContext'
import { formatDateLabel } from '@shared/time'
import { PinIcon } from './icons'

function TitleBar(): React.JSX.Element {
  const { state, settings, dispatch } = useData()
  const pinned = settings.alwaysOnTop

  const togglePin = (): void => {
    const next = !pinned
    dispatch({ type: 'updateSettings', patch: { alwaysOnTop: next } })
    void window.api.setAlwaysOnTop(next)
  }

  return (
    <header className="titlebar">
      <span className="titlebar-date">{formatDateLabel(state.activeDate)}</span>
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
