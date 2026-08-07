import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { BacklogTask, DateKey, Priority } from '@shared/types'
import { formatClock, formatDateLabel, formatMinutes, todayKey } from '@shared/time'
import { effectivePriority } from '@shared/priority'
import { byStart } from '@shared/blocks'
import { useData } from '../state/DataContext'
import EmptyState from '../components/EmptyState'
import RecurringSheet from '../components/RecurringSheet'
import UrgencyField from '../components/UrgencyField'
import { CheckIcon, CheckSquareIcon, PlusIcon, RepeatIcon, TrashIcon } from '../components/icons'

/** Short forms, because a backlog chip has less room than the Activities card. */
const SHORT_PRIORITY: Record<Priority, string> = { 1: 'High', 2: 'Med', 3: 'Low' }

const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } }
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 30 } as const }
}

/** Priority, then soonest deadline, then oldest — the same order the planner uses. */
function sortBacklog(tasks: BacklogTask[], today: DateKey): BacklogTask[] {
  return [...tasks].sort(
    (a, b) =>
      effectivePriority(a, today) - effectivePriority(b, today) ||
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
  const { state, today: todayData, backlog, dispatch } = useData()
  const [text, setText] = useState('')
  const [estimate, setEstimate] = useState('')
  const [priority, setPriority] = useState<Priority>(2)
  const [due, setDue] = useState<DateKey | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [showRecurring, setShowRecurring] = useState(false)
  const date = state.activeDate
  const today = todayKey()

  const open = useMemo(
    () =>
      sortBacklog(
        backlog.filter((t) => !t.done),
        today
      ),
    [backlog, today]
  )
  const done = useMemo(() => backlog.filter((t) => t.done), [backlog])

  /**
   * Today's scheduled activity work, as checkable items.
   *
   * Derived from the schedule rather than stored, so adding an activity and
   * regenerating updates this list with no bookkeeping. Only blocks that came
   * from an Activity appear: backlog work carries `backlogTaskId` and is already
   * listed below with its own scheduled-at line, so including it would show the
   * same task twice.
   */
  const todayBlocks = useMemo(
    () =>
      (todayData.schedule ?? [])
        .filter((b) => b.kind === 'activity' && b.activityId !== null)
        .sort(byStart),
    [todayData.schedule]
  )

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
      dueDate: due
    })
    setText('')
    setEstimate('')
    setDue(null)
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

      <UrgencyField
        priority={priority}
        dueDate={due}
        today={today}
        onChange={(next) => {
          setPriority(next.priority)
          setDue(next.dueDate)
        }}
      />

      {todayBlocks.length > 0 && (
        <>
          <h3 className="section-title">
            On today&apos;s schedule
            <span className="count">
              {todayBlocks.filter((b) => b.status === 'done').length}/{todayBlocks.length}
            </span>
          </h3>
          <motion.ul className="list" variants={listVariants} initial="hidden" animate="show">
            {todayBlocks.map((block) => {
              const checked = block.status === 'done'
              return (
                <motion.li
                  key={block.id}
                  className={checked ? 'card is-checked' : 'card'}
                  layout
                  variants={itemVariants}
                >
                  <button
                    className={checked ? 'checkbox checked' : 'checkbox'}
                    // one source of truth: this marks the BLOCK, and the reducer
                    // writes the journal entry exactly as the schedule tab would
                    onClick={() =>
                      dispatch({
                        type: 'setBlockStatus',
                        date,
                        blockId: block.id,
                        status: checked ? 'planned' : 'done'
                      })
                    }
                    aria-label={`${checked ? 'Uncheck' : 'Check off'} ${block.name}`}
                    aria-pressed={checked}
                  >
                    {checked && <CheckIcon size={11} />}
                  </button>
                  <div className="card-body">
                    <p className="card-name">{block.name}</p>
                    <div className="card-meta">
                      <span className="scheduled-at">
                        {formatClock(block.start)} – {formatClock(block.end)}
                      </span>
                      {block.status === 'partial' && <span className="chip chip-est">partial</span>}
                      {block.status === 'skipped' && (
                        <span className="chip chip-overdue">skipped</span>
                      )}
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </motion.ul>
          <h3 className="section-title">Everything else</h3>
        </>
      )}

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
                      <span className={`chip chip-p${effectivePriority(task, today)}`}>
                        {SHORT_PRIORITY[effectivePriority(task, today)]}
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
                      ) : task.estimateMinutes === null ? (
                        <span className="scheduled-at muted">add an estimate to schedule it</span>
                      ) : (
                        /* it has an estimate and still landed nowhere, which
                           means the planner found no room inside its horizon —
                           derived here rather than stored, like every other
                           "what does the schedule imply" signal in the app */
                        <span className="scheduled-at warn">no room in the next two weeks</span>
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
