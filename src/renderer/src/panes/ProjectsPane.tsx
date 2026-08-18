import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Project } from '@shared/types'
import { formatMinutes, todayKey } from '@shared/time'
import { projectProgress } from '@shared/projects'
import { useData } from '../state/DataContext'
import EmptyState from '../components/EmptyState'
import { CheckIcon, FlagIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from '../components/icons'

const listVariants = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } }
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 30 } as const }
}

/** 'due today' / 'Nd left' / 'Nd overdue' — the deadline math itself lives in projectProgress. */
function deadlineLabel(daysUntilDeadline: number): string {
  if (daysUntilDeadline === 0) return 'due today'
  if (daysUntilDeadline > 0) return `${daysUntilDeadline}d left`
  return `${-daysUntilDeadline}d overdue`
}

/**
 * Long-horizon goals — a competition, an application, a language — that
 * activities and backlog tasks can be linked to via `ProjectField`. Structured
 * like `ChecklistPane`: an add form up top, active projects in a list, and
 * archived ones tucked behind a "Show N archived" toggle.
 */
function ProjectsPane(): React.JSX.Element {
  const { state, activities, backlog, dispatch } = useData()
  const projects = state.data.projects
  const today = todayKey()

  const [name, setName] = useState('')
  const [deadline, setDeadline] = useState('')
  const [targetHours, setTargetHours] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const active = useMemo(() => projects.filter((p) => !p.archived), [projects])
  const archived = useMemo(() => projects.filter((p) => p.archived), [projects])

  const valid = name.trim().length > 0

  const resetForm = (): void => {
    setName('')
    setDeadline('')
    setTargetHours('')
    setEditingId(null)
  }

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!valid) return
    const trimmed = name.trim()
    const hrs = Number.parseFloat(targetHours)
    const targetHoursPerWeek = Number.isFinite(hrs) && hrs > 0 ? hrs : null
    const deadlineKey = deadline === '' ? null : deadline

    if (editingId) {
      const existing = projects.find((p) => p.id === editingId)
      if (existing) {
        dispatch({
          type: 'updateProject',
          project: { ...existing, name: trimmed, deadline: deadlineKey, targetHoursPerWeek }
        })
      }
    } else {
      dispatch({
        type: 'addProject',
        project: { name: trimmed, deadline: deadlineKey, targetHoursPerWeek }
      })
    }
    resetForm()
  }

  const startEdit = (id: string): void => {
    const project = projects.find((p) => p.id === id)
    if (!project) return
    setEditingId(id)
    setName(project.name)
    setDeadline(project.deadline ?? '')
    setTargetHours(project.targetHoursPerWeek !== null ? String(project.targetHoursPerWeek) : '')
  }

  const renderCard = (project: Project): React.JSX.Element => {
    const progress = projectProgress(project, activities, backlog, state.data.days, today)
    return (
      <motion.li
        key={project.id}
        className="card"
        layout
        variants={itemVariants}
        exit={{ opacity: 0, x: -18, transition: { duration: 0.15 } }}
      >
        <div className="card-body">
          <p className={project.archived ? 'card-name muted' : 'card-name'}>{project.name}</p>
          <div className="card-meta">
            {progress.daysUntilDeadline !== null && (
              <span
                className={progress.daysUntilDeadline < 0 ? 'chip chip-overdue' : 'chip chip-due'}
              >
                {deadlineLabel(progress.daysUntilDeadline)}
              </span>
            )}
            {progress.tasksTotal > 0 && (
              <span className="chip chip-project">
                {progress.tasksDone}/{progress.tasksTotal} tasks
              </span>
            )}
            <span className="chip chip-project">
              <FlagIcon size={8} />
              {formatMinutes(progress.minutesLoggedThisWeek)}
              {progress.targetMinutesPerWeek !== null &&
                ` / ${formatMinutes(progress.targetMinutesPerWeek)}`}{' '}
              this week
            </span>
          </div>
        </div>
        <button
          className="btn-ghost"
          onClick={() =>
            dispatch({
              type: 'updateProject',
              project: { ...project, archived: !project.archived }
            })
          }
          aria-label={project.archived ? `Restore ${project.name}` : `Archive ${project.name}`}
        >
          {project.archived ? 'Restore' : 'Archive'}
        </button>
        <button
          className="icon-btn"
          onClick={() => startEdit(project.id)}
          aria-label={`Edit ${project.name}`}
        >
          <PencilIcon size={14} />
        </button>
        <button
          className="icon-btn danger"
          onClick={() => dispatch({ type: 'deleteProject', id: project.id })}
          aria-label={`Delete ${project.name}`}
        >
          <TrashIcon size={14} />
        </button>
      </motion.li>
    )
  }

  return (
    <div className="pane">
      <h2 className="pane-title">
        {editingId ? 'Edit project' : 'Projects'}
        {!editingId && active.length > 0 && <span className="count">{active.length}</span>}
      </h2>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name (e.g. Learn Spanish)"
          aria-label="Project name"
        />
        <div className="add-row">
          <input
            className="field"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            aria-label="Deadline"
          />
          <input
            className="field field-est"
            type="number"
            min={0}
            step={0.5}
            value={targetHours}
            onChange={(e) => setTargetHours(e.target.value)}
            placeholder="hrs/wk"
            aria-label="Target hours per week"
            title="Target hours per week"
          />
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
            {editingId ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
            {editingId ? 'Save changes' : 'Add project'}
          </motion.button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={resetForm}>
              <XIcon size={12} />
              Cancel
            </button>
          )}
        </div>
      </form>

      {active.length === 0 ? (
        <EmptyState
          icon={<FlagIcon size={20} />}
          title="No projects yet"
          hint="Give a month-long goal its own home — a competition, an application, a language. Link activities and to-dos to it as you go."
        />
      ) : (
        <motion.ul className="list" variants={listVariants} initial="hidden" animate="show">
          <AnimatePresence initial={false}>{active.map(renderCard)}</AnimatePresence>
        </motion.ul>
      )}

      {archived.length > 0 && (
        <>
          <button className="btn-ghost done-toggle" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide' : 'Show'} {archived.length} archived
          </button>
          <AnimatePresence initial={false}>
            {showArchived && (
              <motion.ul
                className="list"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                {archived.map(renderCard)}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

export default ProjectsPane
