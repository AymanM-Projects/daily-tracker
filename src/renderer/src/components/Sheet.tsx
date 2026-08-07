import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { XIcon } from './icons'

interface SheetProps {
  title: string
  subtitle?: ReactNode
  ariaLabel?: string
  /** extra classes on the panel, e.g. 'sheet-tall' */
  className?: string
  /** clicking the scrim closes by default; prompts that demand an answer opt out */
  dismissOnScrim?: boolean
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * The bottom sheet every modal surface in this app is built from.
 *
 * **Portalled to `document.body` on purpose.** `.pane-wrap` in `App.tsx` is a
 * `motion.div` animating `y`, and a transformed ancestor becomes the containing
 * block for `position: fixed` descendants — so a sheet rendered inside a pane is
 * positioned against the animating wrapper rather than the viewport, and drifts
 * during the tab transition.
 *
 * Escape closes and focus is trapped, neither of which the two hand-rolled
 * copies this replaces did.
 */
function Sheet({
  title,
  subtitle,
  ariaLabel,
  className,
  dismissOnScrim = true,
  onClose,
  children
}: SheetProps): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // focus moves into the sheet so Escape and Tab reach it without a click first
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const edge = e.shiftKey ? items[0] : items[items.length - 1]
      if (document.activeElement === edge) {
        e.preventDefault()
        ;(e.shiftKey ? items[items.length - 1] : items[0]).focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <motion.div
        className="sheet-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={dismissOnScrim ? onClose : undefined}
      />
      <motion.div
        ref={panel}
        className={className ? `sheet ${className}` : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      >
        <div className="sheet-head">
          <div>
            <p className="sheet-title">{title}</p>
            {subtitle !== undefined && <p className="sheet-sub">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </button>
        </div>
        {children}
      </motion.div>
    </>,
    document.body
  )
}

export default Sheet
