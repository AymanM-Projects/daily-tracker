import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { DateKey, RecurrenceFreq, RecurringTask } from '@shared/types'
import { formatMinutes } from '@shared/time'
import { useData } from '../state/DataContext'
import { PlusIcon, RepeatIcon, TrashIcon, XIcon } from './icons'

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FREQ_LABELS: Record<RecurrenceFreq, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly'
}

/** '1st', '2nd', '3rd', '21st' */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`
}

function describeRule(rule: RecurringTask): string {
  if (rule.freq === 'daily') return 'Every day'
  if (rule.freq === 'weekly') {
    if (rule.weekdays.length === 0) return 'Weekly — no days picked'
    return [...rule.weekdays]
      .sort((a, b) => a - b)
      .map((d) => DAY_SHORT[d])
      .join(', ')
  }
  return `Monthly on the ${ordinal(rule.dayOfMonth)}`
}

interface RecurringSheetProps {
  date: DateKey
  onClose: () => void
}

function RecurringSheet({ date, onClose }: RecurringSheetProps): React.JSX.Element {
  const { recurringTasks, dispatch } = useData()
  const [text, setText] = useState('')
  const [estimate, setEstimate] = useState('')
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly')
  const [weekdays, setWeekdays] = useState<number[]>([new Date().getDay()])
  const [dayOfMonth, setDayOfMonth] = useState('1')

  const dom = Number.parseInt(dayOfMonth, 10)
  const valid =
    text.trim().length > 0 &&
    (freq !== 'weekly' || weekdays.length > 0) &&
    (freq !== 'monthly' || (Number.isFinite(dom) && dom >= 1 && dom <= 31))

  const add = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!valid) return
    const mins = Number.parseInt(estimate, 10)
    dispatch({
      type: 'addRecurringTask',
      date,
      task: {
        text: text.trim(),
        estimateMinutes: Number.isFinite(mins) && mins > 0 ? mins : null,
        freq,
        weekdays: freq === 'weekly' ? weekdays : [],
        dayOfMonth: freq === 'monthly' ? dom : 1,
        active: true
      }
    })
    setText('')
    setEstimate('')
  }

  const toggleDay = (d: number): void =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  return (
    <>
      <motion.div
        className="sheet-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet sheet-tall"
        role="dialog"
        aria-label="Repeating tasks"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      >
        <div className="sheet-head">
          <div>
            <p className="sheet-title">Repeating tasks</p>
            <p className="sheet-sub">Added to your checklist automatically on the day</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <XIcon size={15} />
          </button>
        </div>

        <form onSubmit={add} className="recur-form">
          <div className="add-row">
            <input
              className="field"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Take out the bins"
              aria-label="Repeating task name"
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
          </div>

          <div className="seg" role="radiogroup" aria-label="How often">
            {(['daily', 'weekly', 'monthly'] as RecurrenceFreq[]).map((f) => (
              <button
                key={f}
                type="button"
                className={freq === f ? 'seg-btn active' : 'seg-btn'}
                onClick={() => setFreq(f)}
                role="radio"
                aria-checked={freq === f}
              >
                {FREQ_LABELS[f]}
              </button>
            ))}
          </div>

          {freq === 'weekly' && (
            <div className="daypick" role="group" aria-label="Days of the week">
              {DAY_LETTERS.map((letter, d) => (
                <button
                  key={DAY_NAMES[d]}
                  type="button"
                  className={weekdays.includes(d) ? 'daypick-btn active' : 'daypick-btn'}
                  onClick={() => toggleDay(d)}
                  aria-pressed={weekdays.includes(d)}
                  aria-label={DAY_NAMES[d]}
                >
                  {letter}
                </button>
              ))}
            </div>
          )}

          {freq === 'monthly' && (
            <>
              <label className="sheet-field">
                <span>Day of the month</span>
                <input
                  className="field field-time"
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  aria-label="Day of the month"
                />
              </label>
              {dom > 28 && (
                <p className="hint">
                  Months with no {ordinal(dom)} use their last day instead, so this never skips a
                  month.
                </p>
              )}
            </>
          )}

          <motion.button
            type="submit"
            className="btn-primary"
            disabled={!valid}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            <PlusIcon size={14} />
            Add repeating task
          </motion.button>
        </form>

        {recurringTasks.length === 0 ? (
          <p className="hint recur-empty">
            Nothing repeats yet. Chores, bills, weekly reviews — anything you&apos;d otherwise
            forget to write down.
          </p>
        ) : (
          <ul className="list recur-list">
            <AnimatePresence initial={false}>
              {recurringTasks.map((rule) => (
                <motion.li
                  key={rule.id}
                  className="card"
                  layout
                  exit={{ opacity: 0, x: -18, transition: { duration: 0.15 } }}
                >
                  <button
                    className={rule.active ? 'checkbox checked' : 'checkbox'}
                    onClick={() =>
                      dispatch({
                        type: 'updateRecurringTask',
                        task: { ...rule, active: !rule.active }
                      })
                    }
                    aria-label={rule.active ? `Pause ${rule.text}` : `Resume ${rule.text}`}
                    aria-pressed={rule.active}
                  >
                    {rule.active && <RepeatIcon size={11} />}
                  </button>
                  <div className="card-body">
                    <p className={rule.active ? 'card-name' : 'card-name muted'}>{rule.text}</p>
                    <div className="card-meta">
                      <span className="mono">{describeRule(rule)}</span>
                      {rule.estimateMinutes !== null && (
                        <span className="chip chip-est">{formatMinutes(rule.estimateMinutes)}</span>
                      )}
                      {!rule.active && <span className="chip">paused</span>}
                    </div>
                  </div>
                  <button
                    className="icon-btn danger"
                    onClick={() => dispatch({ type: 'deleteRecurringTask', id: rule.id })}
                    aria-label={`Delete rule ${rule.text}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </motion.div>
    </>
  )
}

export default RecurringSheet
