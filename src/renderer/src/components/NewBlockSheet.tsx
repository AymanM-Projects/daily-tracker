import { useState } from 'react'
import type { DateKey, ScheduleLane } from '@shared/types'
import { formatHM, parseHM } from '@shared/time'
import { insertBlock } from '@shared/reschedule'
import { getDay } from '@shared/defaults'
import { useData } from '../state/DataContext'
import Sheet from './Sheet'
import TimeField from './TimeField'
import { describeEditFailure } from './editErrors'
import { PlusIcon, TargetIcon, ZapIcon } from './icons'

interface NewBlockSheetProps {
  date: DateKey
  /** where the "+" was pressed from, so the sheet opens on a sensible hour */
  defaultStart: string
  onClose: () => void
}

/**
 * Add a block by hand.
 *
 * `insertBlock` has existed and been tested since the reschedule module landed
 * but had no caller — this is it. The block it makes is `manual`, so
 * Regenerate routes around it instead of discarding it.
 */
function NewBlockSheet({ date, defaultStart, onClose }: NewBlockSheetProps): React.JSX.Element {
  const { state, settings, activities, dispatch } = useData()
  const [name, setName] = useState('')
  const [start, setStart] = useState(defaultStart)
  const [end, setEnd] = useState(() => formatHM(parseHM(defaultStart) + 30))
  const [lane, setLane] = useState<ScheduleLane>('focus')
  const [error, setError] = useState<string | null>(null)

  const blocks = getDay(state.data, date).schedule ?? []
  const valid = name.trim().length > 0 && parseHM(end) > parseHM(start)

  const add = (): void => {
    if (!valid) return
    const result = insertBlock(
      blocks,
      { name: name.trim(), lane, start: parseHM(start), end: parseHM(end) },
      { dayStart: parseHM(settings.dayStart), dayEnd: parseHM(settings.dayEnd) },
      // the day makes room rather than refusing, matching what a drag does
      { ripple: true }
    )
    if (!result.ok) {
      setError(describeEditFailure(result.error))
      return
    }
    dispatch({ type: 'setDaySchedule', date, blocks: result.value })
    onClose()
  }

  return (
    <Sheet title="Add a block" subtitle="Put something on the day by hand" onClose={onClose}>
      <label className="sheet-field">
        <span>Name</span>
        <input
          className="field"
          list="new-block-names"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Call the bank"
        />
        {/* the activities already defined are the likeliest things to add */}
        <datalist id="new-block-names">
          {activities.map((a) => (
            <option key={a.id} value={a.name} />
          ))}
        </datalist>
      </label>

      <div className="sheet-row">
        <span className="time-label">
          Start
          <TimeField value={start} onChange={setStart} label="Block start" />
        </span>
        <span className="range-dash">–</span>
        <span className="time-label">
          End
          <TimeField value={end} onChange={setEnd} label="Block end" />
        </span>
      </div>

      <div>
        <span className="seg-label">Lane</span>
        <div className="seg" role="radiogroup" aria-label="Lane">
          <button
            type="button"
            className={lane === 'focus' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => setLane('focus')}
            role="radio"
            aria-checked={lane === 'focus'}
          >
            <TargetIcon size={12} />
            Focus
          </button>
          <button
            type="button"
            className={lane === 'parallel' ? 'seg-btn active mode-bg' : 'seg-btn'}
            onClick={() => setLane('parallel')}
            role="radio"
            aria-checked={lane === 'parallel'}
          >
            <ZapIcon size={12} />
            Parallel
          </button>
        </div>
      </div>

      {error && <p className="hint hint-warn">{error}</p>}

      <div className="sheet-actions">
        <button className="sheet-btn primary" onClick={add} disabled={!valid}>
          <PlusIcon size={14} />
          Add block
        </button>
      </div>
    </Sheet>
  )
}

export default NewBlockSheet
