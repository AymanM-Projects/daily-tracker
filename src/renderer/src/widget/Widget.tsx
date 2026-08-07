import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../hooks/useTheme'
import { MotionConfig, motion } from 'motion/react'
import type { WidgetBlock, WidgetSummary } from '@shared/types'
import { formatClock, formatMinutes } from '@shared/time'
import { CalendarIcon, CheckIcon, CoffeeIcon } from '../components/icons'

const rise = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0 }
}

function Row({ block, upcoming }: { block: WidgetBlock; upcoming?: boolean }): React.JSX.Element {
  const classes = ['widget-row', block.lane]
  if (block.kind === 'break') classes.push('break')
  if (block.overflow) classes.push('overflow')
  if (upcoming) classes.push('upcoming')

  return (
    <motion.div className={classes.join(' ')} variants={rise}>
      <div className="widget-row-top">
        <span className="widget-lane" />
        {block.kind === 'break' && <CoffeeIcon size={12} />}
        <span className="widget-name">{block.name}</span>
        <span className="widget-away">
          {upcoming
            ? `in ${formatMinutes(block.minutesAway)}`
            : `${formatMinutes(block.minutesAway)} left`}
        </span>
      </div>
      {upcoming ? (
        <div className="widget-range">starts {formatClock(block.start)}</div>
      ) : (
        <>
          <div className="widget-track">
            <motion.div
              className="widget-fill"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(block.progress * 100)}%` }}
              transition={{ type: 'spring', stiffness: 150, damping: 26 }}
            />
          </div>
          <div className="widget-range">
            {formatClock(block.start)} – {formatClock(block.end)}
          </div>
        </>
      )}
    </motion.div>
  )
}

function Content({ summary }: { summary: WidgetSummary }): React.JSX.Element {
  const { now, next, checklist, timer } = summary

  return (
    <>
      <div className="widget-head">
        <span className="widget-clock">
          <strong>{summary.clock}</strong>
          <span className="widget-meridiem">{summary.meridiem}</span>
        </span>
        <span className="widget-date">{summary.dateLabel}</span>
      </div>

      {!summary.hasSchedule && (
        <div className="widget-empty">
          <CalendarIcon size={18} />
          <span className="widget-empty-text">
            <strong>No schedule today</strong>
            <span>Click to open and generate one</span>
          </span>
        </div>
      )}

      {summary.hasSchedule && summary.dayComplete && (
        <div className="widget-empty">
          <CheckIcon size={18} />
          <span className="widget-empty-text">
            <strong>Nothing left today</strong>
            <span>Every block is done or behind you</span>
          </span>
        </div>
      )}

      {summary.hasSchedule && !summary.dayComplete && (
        <motion.div
          className="widget-body"
          initial="hidden"
          animate="shown"
          variants={{ shown: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } } }}
        >
          {now.length > 0 && (
            <>
              <motion.div className="widget-label" variants={rise}>
                Now
              </motion.div>
              {now.map((block) => (
                <Row key={block.id} block={block} />
              ))}
            </>
          )}
          {next && (
            <>
              <motion.div className="widget-label" variants={rise}>
                {now.length > 0 ? 'Next' : 'Up next'}
              </motion.div>
              <Row block={next} upcoming />
            </>
          )}
        </motion.div>
      )}

      {(checklist.total > 0 || timer) && (
        <div className="widget-foot">
          <span className="widget-chip">
            {checklist.total > 0 && (
              <>
                <CheckIcon size={11} />
                {checklist.done}/{checklist.total} done
              </>
            )}
          </span>
          {timer && (
            <span className={timer.paused ? 'widget-chip paused' : 'widget-chip running'}>
              <motion.span
                className="widget-dot"
                animate={timer.paused ? { opacity: 0.5 } : { opacity: [1, 0.25, 1] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              />
              {timer.paused ? 'paused' : timer.display}
            </span>
          )}
        </div>
      )}
    </>
  )
}

function Widget(): React.JSX.Element {
  const [summary, setSummary] = useState<WidgetSummary | null>(null)
  // the popover is its own document with its own bundle, so it stamps its own
  // <html> rather than inheriting the app window's attribute
  useTheme(summary?.theme ?? 'system')
  const shellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsubscribe = window.api.onWidgetUpdate(setSummary)
    // tells main the panel is mounted, so the first hover isn't blank
    void window.api.widgetReady()
    return unsubscribe
  }, [])

  // the panel's height depends on how many blocks are in play, so the window
  // is sized to the content rather than the content padded to the window
  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const report = (): void => {
      void window.api.widgetResize(el.getBoundingClientRect().height)
    }
    const observer = new ResizeObserver(report)
    observer.observe(el)
    report()
    return () => observer.disconnect()
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <div className="widget-shell" ref={shellRef}>
        <motion.button
          type="button"
          className="widget-card"
          aria-label="Open Daily Tracker"
          onClick={() => void window.api.widgetOpenApp()}
          // remount on each hover-open so the panel animates in every time
          key={summary?.revision ?? 'boot'}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        >
          {summary && <Content summary={summary} />}
        </motion.button>
      </div>
    </MotionConfig>
  )
}

export default Widget
