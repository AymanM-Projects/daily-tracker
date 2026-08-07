import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { BacklogTask, DateKey, Priority } from '@shared/types'
import { formatClock, formatDateLabel, formatMinutes, todayKey } from '@shared/time'
import { useData } from '../state/DataContext'
import EmptyState from '../components/EmptyState'
import RecurringSheet from '../components/RecurringSheet'
import { CheckIcon, CheckSquareIcon, PlusIcon, RepeatIcon, TrashIcon } from '../components/icons'

const PRIORITY_LABELS: Record<Priority, string> = { 1: 'High', 2: 'Med', 3: 'Low' }

const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } }
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 30 } as const }
}

/** Priority, then soonest deadline, then oldest — the same order the planner uses. */
function sortBacklog(tasks: BacklogTask[]): BacklogTask[] {
  return [...tasks].sort(
    (a, b) =>
      a.priority - b.priority ||
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
      a.createdAt.localeCompare(b.createdAt)
  )
}

function dueLabel(due: DateKey): string {
  const today = todayKey()
  if (due === today) return 'today'
  if (due < today) return 'overdue'
  return formatDateLabel(due).replace(/,.*/, '')
}

function ChecklistPane(): React.JSX.Element {
  const { state, backlog, dispatch } = useData()
  const [text, setText] = useState('')
  const [estimate, setEstimate] = useState('')
  const [priority, setPriority] = useState<Priority>(2)
  const [due, setDue] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [showRecurring, setShowRecurring] = useState(false)
  const date = state.activeDate

  const open = useMemo(() => sortBacklog(backlog.filter((t) => !t.done)), [backlog])
  const done = useMemo(() => backlog.filter((t) => t.done), [backlog])

  /** Where each task's work actually landed, so the list can say when it happens. */
  const placedAt = useMemo(() => {
    const map = new Map<string, { date: DateKey; start: string }>()
    for (const [day, data] of Object.entries(state.data.days)) {
      for (const b of data.schedule ?? []) {
        if (!b.backlogTaskId) continue
        const prev = map.get(b.backlogTaskId)
        if (!prev || day < prev.date || (day === prev.date && b.start < prev.start)) {
          map.set(b.backlogTaskId, { date: day, start: b.start })
        }
      }
    }
    return map
  }, [state.data.days])

  const totalLeft = open.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0)

  const add = (e: React.FormEvent): void => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    const mins = Number.parseInt(estimate, 10)
    dispatch({
      type: 'addBacklogTask',
      date,
      text: trimmed,
      estimateMinutes: Number.isFinite(mins) && mins > 0 ? mins : null,
      priority,
      dueDate: due || null
    })
    setText('')
    setEstimate('')
    setDue('')
  }

  return (
    <div className="pane">
      <h2 className="pane-title">
        Everything to do
        {open.length > 0 && <span className="count">{open.length}</span>}
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

      {totalLeft > 0 && <p className="budget">{formatMinutes(totalLeft)} of work on the list</p>}

      <form className="add-row" onSubmit={add}>
        <input
          className="field"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add anything you have to do…"
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
          title="Estimate in minutes — needed for it to be scheduled"
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

      <div className="add-meta">
        <div className="seg seg-sm" role="radiogroup" aria-label="Priority">
          {([1, 2, 3] as Priority[]).map((p) => (
            <button
              key={p}
              type="button"
              className={priority === p ? `seg-btn active p${p}` : 'seg-btn'}
              onClick={() => setPriority(p)}
              role="radio"
              aria-checked={priority === p}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
        <input
          className="field field-due"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date (optional)"
          title="Due date (optional)"
        />
      </div>

      {open.length === 0 ? (
        <EmptyState
          icon={<CheckSquareIcon size={20} />}
          title="Nothing left to do"
          hint="Add anything — an assignment, a chore, a someday idea. Give it a time estimate and it gets scheduled into your free time automatically."
        />
      ) : (
        <motion.ul className="list" variants={listVariants} initial="hidden" animate="show">
          <AnimatePresence initial={false}>
            {open.map((task) => {
              const at = placedAt.get(task.id)
              return (
                <motion.li
                  key={task.id}
                  className="card"
                  layout
                  variants={itemVariants}
                  exit={{ opacity: 0, x: -18, transition: { duration: 0.15 } }}
                >
                  <button
                    className="checkbox"
                    onClick={() => dispatch({ type: 'toggleBacklogTask', date, id: task.id })}
                    aria-label={`Check off ${task.text}`}
                    aria-pressed={false}
                  />
                  <div className="card-body">
                    <p className="card-name">{task.text}</p>
                    <div className="card-meta">
                      <span className={`chip chip-p${task.priority}`}>
                        {PRIORITY_LABELS[task.priority]}
                      </span>
                      {task.estimateMinutes !== null && (
                        <span className="chip chip-est">{formatMinutes(task.estimateMinutes)}</span>
                      )}
                      {task.dueDate && (
                        <span
                          className={
                            task.dueDate < todayKey() ? 'chip chip-overdue' : 'chip chip-due'
                          }
                        >
                          {dueLabel(task.dueDate)}
                        </span>
                      )}
                      {task.recurringTaskId && (
                        <span className="chip chip-repeat">
                          <RepeatIcon size={8} />
                          repeats
                        </span>
                      )}
                      {at ? (
                        <span className="scheduled-at">
                          {at.date === todayKey() ? 'today' : dueLabel(at.date)}{' '}
                          {formatClock(at.start)}
                        </span>
                      ) : (
                        task.estimateMinutes === null && (
                          <span className="scheduled-at muted">add an estimate to schedule it</span>
                        )
                      )}
                    </div>
                  </div>
                  <button
                    className="icon-btn danger"
                    onClick={() => dispatch({ type: 'deleteBacklogTask', date, id: task.id })}
                    aria-label={`Delete ${task.text}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </motion.ul>
      )}

      {done.length > 0 && (
        <>
          <button className="btn-ghost done-toggle" onClick={() => setShowDone((v) => !v)}>
            <CheckIcon size={12} />
            {showDone ? 'Hide' : 'Show'} {done.length} done
          </button>
          <AnimatePresence initial={false}>
            {showDone && (
              <motion.ul
                className="list"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                {done.map((task) => (
                  <li key={task.id} className="card">
                    <button
                      className="checkbox checked"
                      onClick={() => dispatch({ type: 'toggleBacklogTask', date, id: task.id })}
                      aria-label={`Uncheck ${task.text}`}
                      aria-pressed
                    >
                      <CheckIcon size={13} />
                    </button>
                    <span className="check-text done">{task.text}</span>
                    <button
                      className="icon-btn danger"
                      onClick={() => dispatch({ type: 'deleteBacklogTask', date, id: task.id })}
                      aria-label={`Delete ${task.text}`}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}

      <AnimatePresence>
        {showRecurring && <RecurringSheet date={date} onClose={() => setShowRecurring(false)} />}
      </AnimatePresence>
    </div>
  )
}

export default ChecklistPane
