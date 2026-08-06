import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useData } from '../state/DataContext'
import EmptyState from '../components/EmptyState'
import { CheckIcon, CheckSquareIcon, PlusIcon, TrashIcon } from '../components/icons'

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } }
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 30 } as const }
}

function ChecklistPane(): React.JSX.Element {
  const { state, today, dispatch } = useData()
  const [text, setText] = useState('')
  const date = state.activeDate
  const doneCount = today.checklist.filter((i) => i.done).length

  const add = (e: React.FormEvent): void => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    dispatch({ type: 'addChecklistItem', date, text: trimmed })
    setText('')
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
      </h2>
      <form className="add-row" onSubmit={add}>
        <input
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task for today…"
          aria-label="New task"
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
                <span className={item.done ? 'check-text done' : 'check-text'}>{item.text}</span>
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
    </div>
  )
}

export default ChecklistPane
