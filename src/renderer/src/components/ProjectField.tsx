import type { Project } from '@shared/types'

interface ProjectFieldProps {
  projectId: string | null
  projects: Project[]
  onChange: (projectId: string | null) => void
}

/**
 * Project picker shared by the Activities and Checklist add/edit forms — the
 * same slot pattern as `UrgencyField`.
 *
 * Lists non-archived projects plus the currently-selected one even if it turns
 * out to be archived, so editing an already-linked item never silently clears
 * the link just because the project was archived in the meantime.
 */
function ProjectField({ projectId, projects, onChange }: ProjectFieldProps): React.JSX.Element {
  const options = projects.filter((p) => !p.archived || p.id === projectId)

  return (
    <div>
      <span className="seg-label">Project</span>
      <select
        className="field"
        value={projectId ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        aria-label="Project"
      >
        <option value="">No project</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.archived ? ' (archived)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

export default ProjectField
