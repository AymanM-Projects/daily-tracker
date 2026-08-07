import { AnimatePresence, motion } from 'motion/react'
import type { DateKey, Priority } from '@shared/types'
import { derivePriority, priorityLabel } from '@shared/priority'
import { formatDateLabel } from '@shared/time'

interface UrgencyFieldProps {
  priority: Priority
  dueDate: DateKey | null
  onChange: (next: { priority: Priority; dueDate: DateKey | null }) => void
  today: DateKey
}

/**
 * "How urgent is this" — answered either by hand or by a date.
 *
 * The two are deliberately exclusive rather than side by side. A deadline
 * overrides the manual level everywhere it is read (`effectivePriority`), so
 * showing both as editable would offer a control that silently does nothing.
 * Switching back to Priority clears the date, which is what makes
 * `dueDate === null` a reliable "the user chose a level by hand".
 */
function UrgencyField({
  priority,
  dueDate,
  onChange,
  today
}: UrgencyFieldProps): React.JSX.Element {
  const byDeadline = dueDate !== null
  const derived = dueDate ? derivePriority(dueDate, today) : null

  return (
    <div>
      <span className="seg-label">Urgency</span>
      <div className="seg" role="radiogroup" aria-label="How urgency is decided">
        <button
          type="button"
          className={byDeadline ? 'seg-btn' : 'seg-btn active'}
          onClick={() => onChange({ priority, dueDate: null })}
          role="radio"
          aria-checked={!byDeadline}
        >
          Priority
        </button>
        <button
          type="button"
          className={byDeadline ? 'seg-btn active' : 'seg-btn'}
          // default to today, so picking "Deadline" always lands on a real date
          onClick={() => onChange({ priority, dueDate: dueDate ?? today })}
          role="radio"
          aria-checked={byDeadline}
        >
          Deadline
        </button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {byDeadline ? (
          <motion.div
            key="deadline"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{ marginTop: 6 }}
          >
            <input
              className="field"
              type="date"
              value={dueDate}
              onChange={(e) => onChange({ priority, dueDate: e.target.value || today })}
              aria-label="Due date"
            />
            {derived !== null && (
              <p className="hint" style={{ marginTop: 5 }}>
                Due {formatDateLabel(dueDate)} — counts as{' '}
                <span className={`chip chip-p${derived}`}>{priorityLabel(derived)}</span> and rises
                as the date gets closer.
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="priority"
            className="seg"
            role="radiogroup"
            aria-label="Priority"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{ marginTop: 6 }}
          >
            {([1, 2, 3] as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                className={priority === p ? `seg-btn active p${p}` : 'seg-btn'}
                onClick={() => onChange({ priority: p, dueDate: null })}
                role="radio"
                aria-checked={priority === p}
              >
                {priorityLabel(p)}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default UrgencyField
