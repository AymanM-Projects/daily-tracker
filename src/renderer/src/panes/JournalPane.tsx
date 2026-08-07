import { useRef, useState } from 'react'
import { motion } from 'motion/react'
import { formatDateLabel, formatTimestamp, shiftDateKey } from '@shared/time'
import { getDay } from '@shared/defaults'
import { useData } from '../state/DataContext'
import EmptyState from '../components/EmptyState'
import {
  BookIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  TrashIcon
} from '../components/icons'

function JournalPane(): React.JSX.Element {
  const { state, dispatch } = useData()
  const [viewDate, setViewDate] = useState(state.activeDate)
  const [text, setText] = useState('')
  const paneRef = useRef<HTMLDivElement>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // snap back to the new day when the date rolls over (adjust-state-during-render pattern)
  const [lastActiveDate, setLastActiveDate] = useState(state.activeDate)
  if (lastActiveDate !== state.activeDate) {
    setLastActiveDate(state.activeDate)
    setViewDate(state.activeDate)
    // an editor left open across midnight would be pointed at yesterday's entry
    setEditingId(null)
  }

  const day = getDay(state.data, viewDate)
  const entries = [...day.journal].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const isToday = viewDate === state.activeDate

  const saveEdit = (id: string): void => {
    const trimmed = draft.trim()
    if (!trimmed) return
    dispatch({ type: 'updateJournalEntry', date: viewDate, id, text: trimmed })
    setEditingId(null)
  }

  const add = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    dispatch({ type: 'addJournalEntry', date: viewDate, text: trimmed })
    setText('')
  }

  return (
    <div className="pane" ref={paneRef}>
      <div className="day-nav">
        <button
          className="icon-btn"
          onClick={() => setViewDate(shiftDateKey(viewDate, -1))}
          aria-label="Previous day"
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span className="day-nav-label">{isToday ? 'Today' : formatDateLabel(viewDate)}</span>
        {!isToday && (
          <button className="btn-ghost" onClick={() => setViewDate(state.activeDate)}>
            Today
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => setViewDate(shiftDateKey(viewDate, 1))}
          disabled={isToday}
          style={isToday ? { opacity: 0.3, cursor: 'default' } : undefined}
          aria-label="Next day"
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<BookIcon size={20} />}
          title={isToday ? 'Nothing logged yet' : 'No entries this day'}
          hint={
            isToday
              ? 'Completed checklist items land here automatically, or write a note below.'
              : 'Use the arrows to browse other days.'
          }
        />
      ) : (
        <div className="list" key={viewDate}>
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              className="journal-entry"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ root: paneRef, once: true, margin: '0px 0px -10% 0px' }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <span className="journal-time">{formatTimestamp(entry.timestamp)}</span>
              <div className="journal-body">
                {entry.kind === 'auto' && (
                  <span className="chip chip-auto">
                    <CheckIcon size={9} />
                    Done
                  </span>
                )}
                {editingId === entry.id ? (
                  <>
                    <textarea
                      className="field"
                      rows={2}
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingId(null)
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(entry.id)
                      }}
                      aria-label="Edit entry"
                    />
                    {entry.kind === 'auto' && (
                      // saying this before the fact beats the entry quietly
                      // changing character after the first save
                      <p className="hint">
                        Editing this makes it yours — it will stop tracking the block it came from.
                      </p>
                    )}
                    <div className="journal-edit-actions">
                      <button className="btn-ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                      <button
                        className="btn-primary"
                        onClick={() => saveEdit(entry.id)}
                        disabled={!draft.trim()}
                      >
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="journal-text">{entry.text}</p>
                )}
              </div>
              {editingId !== entry.id && (
                <div className="journal-actions">
                  <button
                    className="icon-btn"
                    onClick={() => {
                      setEditingId(entry.id)
                      setDraft(entry.text)
                    }}
                    aria-label={`Edit entry: ${entry.text}`}
                  >
                    <PencilIcon size={13} />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() =>
                      dispatch({ type: 'deleteJournalEntry', date: viewDate, id: entry.id })
                    }
                    aria-label={`Delete entry: ${entry.text}`}
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <div className="composer">
        <textarea
          className="field"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              add()
            }
          }}
          placeholder={
            isToday ? 'What did you work on? (⌘↩ to log)' : 'Backfill a note for this day…'
          }
          aria-label="Journal entry"
        />
        <div className="composer-actions">
          <motion.button
            className="btn-primary"
            onClick={add}
            disabled={!text.trim()}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            Log entry
          </motion.button>
        </div>
      </div>
    </div>
  )
}

export default JournalPane
