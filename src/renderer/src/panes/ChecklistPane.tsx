import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { formatMinutes, minutesNow, parseHM } from '@shared/time'
import { useData } from '../state/DataContext'
import EmptyState from '../components/EmptyState'
import RecurringSheet from '../components/RecurringSheet'
import { CheckIcon, CheckSquareIcon, PlusIcon, RepeatIcon, TrashIcon } from '../components/icons'

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } }
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 30 } as const }
}

function ChecklistPane(): React.JSX.Element {
  const { state, today, settings, dispatch } = useData()
  const [text, setText] = useState('')
  const [estimate, setEstimate] = useState('')
  const [showRecurring, setShowRecurring] = useState(false)
  const date = state.activeDate
  const doneCount = today.checklist.filter((i) => i.done).length

  // what's left to do, weighed against what's left of the day
  const plannedMinutes = today.checklist
    .filter((i) => !i.done)
    .reduce((sum, i) => sum + (i.estimateMinutes ?? 0), 0)
  const freeMinutes = Math.max(
    0,
    parseHM(settings.dayEnd) - Math.max(minutesNow(), parseHM(settings.dayStart))
  )
  const overcommitted = plannedMinutes > freeMinutes

  const add = (e: React.FormEvent): void => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    const mins = Number.parseInt(estimate, 10)
    dispatch({
      type: 'addChecklistItem',
      date,
      text: trimmed,
      estimateMinutes: Number.isFinite(mins) && mins > 0 ? mins : null
    })
    setText('')
    setEstimate('')
  }

  return (
    <div className="pane">
      <h2 className="pane-title">
        Today&apos;s checklist
        {today.checklist.length > 0 && (
          <span className="count">
            {doneCount}/{today.checklist.length}
          </span>
        )}
        <span className="grow" />
        <button
          className="btn-ghost"
          onClick={() => setShowRecurring(true)}
          aria-label="Manage repeating tasks"
        >
          <RepeatIcon size={13} />
          Repeating
        </button>
      </h2>

      {plannedMinutes > 0 && (
        <p className={overcommitted ? 'budget over' : 'budget'}>
          {formatMinutes(plannedMinutes)} of work left
          <span className="budget-sep">·</span>
          {freeMinutes > 0
            ? `${formatMinutes(freeMinutes)} before your day ends`
            : 'your day window is over'}
        </p>
      )}

      <form className="add-row" onSubmit={add}>
        <input
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task for today…"
          aria-label="New task"
        />
        <input
          className="field field-est"
          type="number"
          min={0}
          step={5}
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          placeholder="min"
          aria-label="Estimated minutes"
          title="Estimate in minutes (optional)"
        />
        <motion.button
          type="submit"
          className="btn-primary btn-square"
          disabled={!text.trim()}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          aria-label="Add task"
        >
          <PlusIcon size={16} />
        </motion.button>
      </form>

      {today.checklist.length === 0 ? (
        <EmptyState
          icon={<CheckSquareIcon size={20} />}
          title="Nothing on the list"
          hint="Add the tasks you want to knock out today. Checking one off logs it to your journal."
        />
      ) : (
        <motion.ul className="list" variants={listVariants} initial="hidden" animate="show">
          <AnimatePresence initial={false}>
            {today.checklist.map((item) => (
              <motion.li
                key={item.id}
                className="card"
                layout
                variants={itemVariants}
                exit={{ opacity: 0, x: -18, transition: { duration: 0.15 } }}
              >
                <button
                  className={item.done ? 'checkbox checked' : 'checkbox'}
                  onClick={() => dispatch({ type: 'toggleChecklistItem', date, id: item.id })}
                  aria-label={item.done ? `Uncheck ${item.text}` : `Check off ${item.text}`}
                  aria-pressed={item.done}
                >
                  {item.done && <CheckIcon size={13} />}
                </button>
                <span className={item.done ? 'check-text done' : 'check-text'}>
                  {item.text}
                  {item.source === 'recurring' && (
                    <span className="chip chip-repeat" title="Added by a repeating task">
                      <RepeatIcon size={8} />
                      repeats
                    </span>
                  )}
                </span>
                {item.estimateMinutes !== null && (
                  <span className="est mono">{formatMinutes(item.estimateMinutes)}</span>
                )}
                <button
                  className="icon-btn danger"
                  onClick={() => dispatch({ type: 'deleteChecklistItem', date, id: item.id })}
                  aria-label={`Delete ${item.text}`}
                >
                  <TrashIcon size={14} />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      <AnimatePresence>
        {showRecurring && <RecurringSheet date={date} onClose={() => setShowRecurring(false)} />}
      </AnimatePresence>
    </div>
  )
}

export default ChecklistPane
