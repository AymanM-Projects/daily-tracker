import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Routine } from '@shared/types'
import { formatClock, formatMinutes } from '@shared/time'
import { useData } from '../state/DataContext'
import Sheet from './Sheet'
import TimeField from './TimeField'
import { PlusIcon, SunriseIcon, TrashIcon } from './icons'

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function describeRoutine(routine: Routine): string {
  const when = `${formatClock(routine.start)} · ${formatMinutes(routine.durationMinutes)}`
  if (routine.weekdays.length === 0) return `${when} · every day`
  return `${when} · ${[...routine.weekdays]
    .sort((a, b) => a - b)
    .map((d) => DAY_SHORT[d])
    .join(', ')}`
}

interface RoutineSheetProps {
  onClose: () => void
}

/**
 * Wake, lunch, dinner — the fixed shape of a day.
 *
 * These become anchors, exactly like prayer times, so the generator routes focus
 * work around them instead of packing activities shoulder to shoulder from
 * dayStart. Adding one does not touch a day that already exists: regeneration is
 * a button, and a plan you are partway through is never rewritten underneath you.
 */
function RoutineSheet({ onClose }: RoutineSheetProps): React.JSX.Element {
  const { routines, dispatch } = useData()
  const [name, setName] = useState('')
  const [start, setStart] = useState('12:30')
  const [duration, setDuration] = useState('45')
  const [weekdays, setWeekdays] = useState<number[]>([])

  const mins = Number.parseInt(duration, 10)
  const valid = name.trim().length > 0 && Number.isFinite(mins) && mins >= 5

  const add = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!valid) return
    dispatch({
      type: 'addRoutine',
      routine: { name: name.trim(), start, durationMinutes: mins, weekdays, active: true }
    })
    setName('')
  }

  const toggleDay = (d: number): void =>
    setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  return (
    <Sheet
      title="Daily routines"
      subtitle="Fixed parts of your day the schedule works around"
      className="sheet-tall"
      onClose={onClose}
    >
      <form onSubmit={add} className="recur-form">
        <div className="add-row">
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lunch"
            aria-label="Routine name"
          />
          <input
            className="field field-est"
            type="number"
            min={5}
            step={5}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            aria-label="Duration in minutes"
            title="How long it takes"
          />
        </div>

        <div className="routine-when">
          <span className="seg-label">Starts at</span>
          <TimeField value={start} onChange={setStart} label="Routine start" />
        </div>

        <div>
          <span className="seg-label">Days</span>
          <div className="daypick" role="group" aria-label="Days this routine applies">
            {DAY_LETTERS.map((letter, index) => (
              <button
                key={DAY_NAMES[index]}
                type="button"
                className={weekdays.includes(index) ? 'daypick-btn active' : 'daypick-btn'}
                onClick={() => toggleDay(index)}
                aria-label={DAY_NAMES[index]}
                aria-pressed={weekdays.includes(index)}
              >
                {letter}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 5 }}>
            {weekdays.length === 0
              ? 'No days picked means every day.'
              : 'Only the days you picked.'}
          </p>
        </div>

        <motion.button
          type="submit"
          className="btn-primary"
          disabled={!valid}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
        >
          <PlusIcon size={14} />
          Add routine
        </motion.button>
      </form>

      {routines.length === 0 ? (
        <p className="hint recur-empty">
          Nothing yet. Add when you wake, eat, or anything else that happens at a set time — the
          schedule will leave room for it instead of booking straight through.
        </p>
      ) : (
        <ul className="list recur-list">
          <AnimatePresence initial={false}>
            {[...routines]
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((routine) => (
                <motion.li
                  key={routine.id}
                  className="card"
                  layout
                  exit={{ opacity: 0, x: -18, transition: { duration: 0.15 } }}
                >
                  <button
                    className={routine.active ? 'checkbox checked' : 'checkbox'}
                    onClick={() =>
                      dispatch({
                        type: 'updateRoutine',
                        routine: { ...routine, active: !routine.active }
                      })
                    }
                    aria-label={routine.active ? `Pause ${routine.name}` : `Resume ${routine.name}`}
                    aria-pressed={routine.active}
                  >
                    {routine.active && <SunriseIcon size={11} />}
                  </button>
                  <div className="card-body">
                    <p className={routine.active ? 'card-name' : 'card-name muted'}>
                      {routine.name}
                    </p>
                    <div className="card-meta">
                      <span className="mono">{describeRoutine(routine)}</span>
                      {!routine.active && <span className="chip">paused</span>}
                    </div>
                  </div>
                  <button
                    className="icon-btn danger"
                    onClick={() => dispatch({ type: 'deleteRoutine', id: routine.id })}
                    aria-label={`Delete routine ${routine.name}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                </motion.li>
              ))}
          </AnimatePresence>
        </ul>
      )}

      <p className="hint" style={{ marginTop: 10 }}>
        Routines apply the next time you press Regenerate — a day already underway is never
        rewritten.
      </p>
    </Sheet>
  )
}

export default RoutineSheet
