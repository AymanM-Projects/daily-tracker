import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { ActivityMode, Priority } from '@shared/types'
import { useData } from '../state/DataContext'
import EmptyState from '../components/EmptyState'
import {
  ListIcon,
  PencilIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
  XIcon,
  ZapIcon
} from '../components/icons'

const PRIORITY_LABELS: Record<Priority, string> = { 1: 'High', 2: 'Medium', 3: 'Low' }

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } }
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 30 } as const }
}

function ActivitiesPane(): React.JSX.Element {
  const { activities, dispatch } = useData()
  const [name, setName] = useState('')
  const [duration, setDuration] = useState('30')
  const [priority, setPriority] = useState<Priority>(2)
  const [mode, setMode] = useState<ActivityMode>('focus')
  const [editingId, setEditingId] = useState<string | null>(null)

  const durationNum = Number.parseInt(duration, 10)
  const valid = name.trim().length > 0 && Number.isFinite(durationNum) && durationNum >= 5

  const resetForm = (): void => {
    setName('')
    setDuration('30')
    setPriority(2)
    setMode('focus')
    setEditingId(null)
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!valid) return
    const trimmed = name.trim()
    if (editingId) {
      const existing = activities.find((a) => a.id === editingId)
      if (existing) {
        dispatch({
          type: 'updateActivity',
          activity: {
            ...existing,
            name: trimmed,
            durationMinutes: durationNum,
            priority,
            mode
          }
        })
      }
    } else {
      dispatch({ type: 'addActivity', name: trimmed, durationMinutes: durationNum, priority, mode })
    }
    resetForm()
  }

  const startEdit = (id: string): void => {
    const activity = activities.find((a) => a.id === id)
    if (!activity) return
    setEditingId(id)
    setName(activity.name)
    setDuration(String(activity.durationMinutes))
    setPriority(activity.priority)
    setMode(activity.mode)
  }

  return (
    <div className="pane">
      <h2 className="pane-title">
        {editingId ? 'Edit activity' : 'Daily activities'}
        {!editingId && activities.length > 0 && <span className="count">{activities.length}</span>}
      </h2>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="add-row">
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Activity name (e.g. Deep work)"
            aria-label="Activity name"
          />
          <input
            className="field field-est"
            type="number"
            min={5}
            step={5}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            aria-label="Duration in minutes"
            title="Duration (minutes)"
          />
        </div>
        <div>
          <span className="seg-label">Priority</span>
          <div className="seg" role="radiogroup" aria-label="Priority">
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
        </div>
        <div>
          <span className="seg-label">Mode</span>
          <div className="seg" role="radiogroup" aria-label="Mode">
            <button
              type="button"
              className={mode === 'focus' ? 'seg-btn active' : 'seg-btn'}
              onClick={() => setMode('focus')}
              role="radio"
              aria-checked={mode === 'focus'}
            >
              <TargetIcon size={12} />
              Focus
            </button>
            <button
              type="button"
              className={mode === 'background' ? 'seg-btn active mode-bg' : 'seg-btn'}
              onClick={() => setMode('background')}
              role="radio"
              aria-checked={mode === 'background'}
            >
              <ZapIcon size={12} />
              Parallel
            </button>
          </div>
          <p className="hint" style={{ marginTop: 5 }}>
            Parallel = runs on its own (vibecoding session, 3D print) alongside focus work.
          </p>
        </div>
        <div className="add-row">
          <motion.button
            type="submit"
            className="btn-primary"
            style={{ flex: 1 }}
            disabled={!valid}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            <PlusIcon size={14} />
            {editingId ? 'Save changes' : 'Add activity'}
          </motion.button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={resetForm}>
              <XIcon size={12} />
              Cancel
            </button>
          )}
        </div>
      </form>

      {activities.length === 0 ? (
        <EmptyState
          icon={<ListIcon size={20} />}
          title="No activities yet"
          hint="These are the building blocks of your day — the schedule is generated from them."
        />
      ) : (
        <motion.ul className="list" variants={listVariants} initial="hidden" animate="show">
          <AnimatePresence initial={false}>
            {activities.map((activity) => (
              <motion.li
                key={activity.id}
                className="card"
                layout
                variants={itemVariants}
                exit={{ opacity: 0, x: -18, transition: { duration: 0.15 } }}
              >
                <div className="card-body">
                  <p className="card-name">{activity.name}</p>
                  <div className="card-meta">
                    <span className="mono">{activity.durationMinutes} min</span>
                    <span className={`chip chip-p${activity.priority}`}>
                      {PRIORITY_LABELS[activity.priority]}
                    </span>
                    {activity.mode === 'background' && (
                      <span className="chip chip-parallel">
                        <ZapIcon size={9} />
                        Parallel
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => startEdit(activity.id)}
                  aria-label={`Edit ${activity.name}`}
                >
                  <PencilIcon size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  onClick={() => dispatch({ type: 'deleteActivity', id: activity.id })}
                  aria-label={`Delete ${activity.name}`}
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

export default ActivitiesPane
