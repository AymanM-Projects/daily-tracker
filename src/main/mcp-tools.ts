import { z } from 'zod'
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import type { AppData, McpEntityCreated } from '../shared/types'
import { isValidDateKey, todayKey } from '../shared/time'
import {
  getContextBundle,
  listActivities,
  listBacklogTasks,
  listJournalEntries,
  listProjects
} from '../shared/mcpContext'
import { createActivity, createBacklogTask, createProject } from '../shared/mcpWrites'
import { flushPendingSave, loadData, scheduleSave } from './store'
import { refreshWidget } from './tray'

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Persist an MCP-originated change through the same store the renderer's
 * `data:save` IPC handler uses, then flush synchronously — a write tool only
 * reports success once this returns, so the change is durable on disk before
 * any client could see the response. Quitting mid-flight can therefore only
 * ever lose the response frame, never the data. `refreshWidget` keeps the
 * menu bar's counts in sync immediately rather than waiting on the debounce a
 * `data:save` round-trip would otherwise trigger.
 */
function persist(next: AppData): void {
  scheduleSave(next)
  flushPendingSave()
  refreshWidget()
}

/**
 * Registers the 8 MCP tools this server exposes: 5 read-only shapers over
 * `loadData()`, and 3 create-only writers. There is no update/delete/complete
 * tool anywhere in this file — that is structural, not just undocumented: an
 * external Claude session may add to the lists, and can never edit, finish,
 * or delete anything already there.
 *
 * Every write also calls `notify`, which `mcp-server.ts` wires to push the
 * created entity onto the renderer's `mcp:entity-created` channel. That is
 * the fix for the clobbering problem described in `mcp-server.ts`: writing
 * only through `store.ts` is not enough while the app window is open, because
 * `DataContext` sends its whole in-memory document back on every reducer
 * commit and would otherwise silently erase this write on the very next one.
 */
export function registerTools(server: McpServer, notify: (event: McpEntityCreated) => void): void {
  server.registerTool(
    'get_context_bundle',
    {
      title: 'Get context bundle',
      description:
        'The primary "what should I work on" entry point: recent journal entries, open backlog ' +
        'tasks, active projects, activities, and standing routines/recurring tasks. Excludes ' +
        'internal scheduling state (timers, pauses, settings, raw schedule geometry). Read-only.',
      inputSchema: z.object({
        days: z
          .number()
          .int()
          .positive()
          .max(90)
          .optional()
          .describe('How many past days of journal entries to include. Defaults to 7.'),
        includeCompleted: z
          .boolean()
          .optional()
          .describe('Include already-completed backlog tasks. Defaults to false.')
      })
    },
    async ({ days, includeCompleted }) => {
      const data = loadData()
      return textResult(getContextBundle(data, todayKey(), { days, includeCompleted }))
    }
  )

  server.registerTool(
    'list_journal_entries',
    {
      title: 'List journal entries',
      description: 'Journal entries between two dates (inclusive), YYYY-MM-DD. Read-only.',
      inputSchema: z.object({
        from: z.string().describe('Start date, YYYY-MM-DD'),
        to: z.string().describe('End date, YYYY-MM-DD, inclusive')
      })
    },
    async ({ from, to }) => {
      if (!isValidDateKey(from))
        return errorResult(`from must be a valid YYYY-MM-DD date, got "${from}"`)
      if (!isValidDateKey(to)) return errorResult(`to must be a valid YYYY-MM-DD date, got "${to}"`)
      return textResult(listJournalEntries(loadData(), from, to))
    }
  )

  server.registerTool(
    'list_backlog_tasks',
    {
      title: 'List backlog tasks',
      description: 'The standing to-do list. Filterable by project. Read-only.',
      inputSchema: z.object({
        includeDone: z.boolean().optional().describe('Include completed tasks. Defaults to false.'),
        projectId: z
          .string()
          .nullable()
          .optional()
          .describe('Only tasks linked to this project id, or null for unlinked tasks.')
      })
    },
    async ({ includeDone, projectId }) =>
      textResult(listBacklogTasks(loadData(), { includeDone, projectId }))
  )

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Long-horizon projects. Read-only.',
      inputSchema: z.object({
        includeArchived: z
          .boolean()
          .optional()
          .describe('Include archived projects. Defaults to false.')
      })
    },
    async ({ includeArchived }) => textResult(listProjects(loadData(), { includeArchived }))
  )

  server.registerTool(
    'list_activities',
    {
      title: 'List activities',
      description: 'The reusable activity library. Filterable by mode and project. Read-only.',
      inputSchema: z.object({
        mode: z.enum(['focus', 'background']).optional(),
        projectId: z
          .string()
          .nullable()
          .optional()
          .describe('Only activities linked to this project id, or null for unlinked activities.')
      })
    },
    async ({ mode, projectId }) => textResult(listActivities(loadData(), { mode, projectId }))
  )

  server.registerTool(
    'create_backlog_task',
    {
      title: 'Create backlog task',
      description:
        'Add a new to-do to the standing backlog. It lands in the list unplaced — nothing about ' +
        "today's schedule rearranges itself in the background; the next Regenerate or backlog " +
        'change places it normally. Create-only: there is no tool to edit, finish, or delete an ' +
        'existing task through this connection.',
      inputSchema: z.object({
        text: z.string().describe('What the task is'),
        priority: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe('1 = high, 2 = medium, 3 = low. Defaults to 2.'),
        estimateMinutes: z.number().positive().optional(),
        dueDate: z.string().optional().describe('YYYY-MM-DD'),
        projectId: z.string().optional().describe('An existing project id, from list_projects')
      })
    },
    async (input) => {
      const data = loadData()
      const result = createBacklogTask(data.backlog, data.projects, input)
      if (!result.ok) return errorResult(result.error)
      persist({ ...data, backlog: result.value.backlog })
      notify({ kind: 'backlogTask', task: result.value.task })
      return textResult(result.value.task)
    }
  )

  server.registerTool(
    'create_activity',
    {
      title: 'Create activity',
      description:
        'Add a new reusable activity to the library. Create-only: there is no tool to edit or ' +
        'delete an existing activity through this connection.',
      inputSchema: z.object({
        name: z.string(),
        durationMinutes: z.number().positive(),
        mode: z
          .enum(['focus', 'background'])
          .describe('"focus" fills the Focus lane, "background" fills the Parallel lane'),
        priority: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe('1 = high, 2 = medium, 3 = low. Defaults to 2.'),
        dueDate: z.string().optional().describe('YYYY-MM-DD'),
        projectId: z.string().optional().describe('An existing project id, from list_projects')
      })
    },
    async (input) => {
      const data = loadData()
      const result = createActivity(data.activities, data.projects, input)
      if (!result.ok) return errorResult(result.error)
      persist({ ...data, activities: result.value.activities })
      notify({ kind: 'activity', activity: result.value.activity })
      return textResult(result.value.activity)
    }
  )

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Stand up a new long-horizon project (a competition, a build, an exam) that tasks and ' +
        'activities can be linked to. Create-only: there is no tool to edit, archive, or delete an ' +
        'existing project through this connection.',
      inputSchema: z.object({
        name: z.string(),
        deadline: z.string().optional().describe('YYYY-MM-DD'),
        targetHoursPerWeek: z.number().positive().optional()
      })
    },
    async (input) => {
      const data = loadData()
      const result = createProject(data.projects, input)
      if (!result.ok) return errorResult(result.error)
      persist({ ...data, projects: result.value.projects })
      notify({ kind: 'project', project: result.value.project })
      return textResult(result.value.project)
    }
  )
}
