# Daily Tracker — Full Project Context

> **What this document is:** a complete, self-contained description of a macOS desktop app called Daily Tracker. It is written to be pasted into a fresh chat that has no access to the source code or the machine it runs on. Everything you need to reason about the app — features, data model, algorithms, architecture, current gaps — is contained here.
>
> **What I want help with:** (1) how to actually use this well day-to-day as a productivity system, and (2) what to build or change next to make it better.

---

## 1. What this is

Daily Tracker is a small always-available desktop widget for macOS that runs a single person's day. It has four parts:

1. **Activities** — a reusable library of the things you do (Deep work, Email, Gym, Reading). Each has an estimated duration and a priority.
2. **Checklist** — today's to-do list.
3. **Journal** — a timestamped log of work done, browsable by day.
4. **Schedule** — an automatically generated day plan with real time blocks, built from your activities.

The distinctive idea is the **two-lane schedule**. Activities are tagged either *Focus* (needs your attention) or *Parallel* (runs mostly on its own — an AI coding session, a 3D print, a long render, laundry). The generated schedule shows two side-by-side columns so background work is planned *concurrently* with focused work, instead of eating into it. That reflects how a day with AI tooling and machines actually works: you kick something off, and it runs while you do something else.

It is a desktop app, not a website. The window is deliberately small (360×560 px) and can be pinned on top of other windows so it sits in the corner of the screen while you work.

### Current status — honest assessment

| Aspect | State |
|---|---|
| Core functionality | Complete and working |
| Verification | Every feature exercised end-to-end in the running app via the Chrome DevTools Protocol; screenshots confirmed layout |
| Type safety | `tsc` clean across both TypeScript projects |
| Linting | ESLint clean, Prettier formatted |
| Automated tests | **None.** No test framework is installed |
| Packaging | Never run. The app has only ever launched in dev mode; `.app` bundling is untested |
| App icon | Still the default Electron logo |
| Version control | **Not a git repository.** `git init` has never been run |
| Data state | Contains leftover sample data from the verification run (Deep work, Email sweep, Reading, Vibecoding session) |

So: a working, polished, verified prototype that has n alnever left the development machine.

---

## 2. Tech stack

- **Electron 39** — desktop shell (macOS, Apple Silicon)
- **React 19 + TypeScript 5.9** — UI
- **electron-vite 5 / Vite 7** — build tooling and hot reload
- **Motion 13** (`motion/react`, formerly Framer Motion) — all animation
- **electron-builder 26** — packaging (configured, never executed)

Notably absent, by choice: no CSS framework (no Tailwind), no state management library (no Redux/Zustand), no date library (no date-fns/dayjs), no database (no SQLite), no icon library, no test runner.

Total source: 22 files, roughly 2,400 lines including a ~900-line hand-written stylesheet.

---

## 3. Quick start

```bash
npm install
npm run dev          # launches the app with hot reload
npm run typecheck    # type-checks both TS projects
npm run lint         # ESLint
npm run build:mac    # would package a .app (never yet run)
```

**One environment gotcha worth knowing:** terminals spawned from VS Code inherit an environment variable `ELECTRON_RUN_AS_NODE=1`, which makes the Electron binary boot as plain Node instead of as Electron. The app then crashes instantly with `Cannot read properties of undefined (reading 'isPackaged')`. The npm scripts work around this by wrapping themselves in `env -u ELECTRON_RUN_AS_NODE`, so `npm run dev` works from anywhere. If those scripts are ever rewritten, that wrapper has to survive.

**Where the data lives:** a single JSON file at

```
~/Library/Application Support/daily-tracker/daily-tracker-data.json
```

Delete that file to reset the app to a clean slate. There is no cloud sync, no account, no telemetry — everything is local.

---

## 4. Feature walkthrough

The window has a title bar at top (showing today's date and a pin button) and a four-tab bar at the bottom. Only one pane is visible at a time.

### 4.1 Activities pane

Your reusable library of things you do. This is the input that the schedule is generated from.

**To add an activity you provide:**

- **Name** — free text, e.g. "Deep work"
- **Duration** — in minutes, minimum 5, stepped in 5s (default 30)
- **Priority** — a three-way choice: High, Medium, Low
- **Mode** — a two-way choice: **Focus** or **Parallel**

Mode is the important one. *Focus* means the activity needs you present. *Parallel* means it mostly runs without you — the UI hints "runs on its own (vibecoding session, 3D print) alongside focus work."

**Each saved activity shows** its name, duration, a color-coded priority chip, and a blue "Parallel" chip if it's a background activity. Two buttons per row: edit (loads it back into the form for changes) and delete.

**Important characteristic:** activities are **global, not per-day**. There is one master list, and every day's schedule is generated from that same list. You cannot currently have a weekday set and a weekend set.

### 4.2 Schedule pane

Where the day plan is generated and viewed.

**Controls at the top:**

- **Start** and **End** time pickers — your working window (defaults 09:00–17:00)
- **Breaks** toggle — whether to insert 10-minute breaks between focus activities
- **Generate schedule** button (reads "Regenerate schedule" once a schedule exists)

**The timeline below** shows hour gridlines down the left, and one or two lanes:

- The **Focus** lane (wider, green accent) holds your focus activities and break blocks
- The **Parallel** lane (narrower, blue accent) holds background activities

The Parallel lane is hidden entirely if you have no background activities, so the view stays simple for a normal day.

**Other timeline behavior:**

- A **red line** marks the current time, updating every 30 seconds
- Blocks that run past your end time get an **amber border and a warning triangle** — the app shows the honest end time rather than truncating the block
- Activities that couldn't fit at all appear in an amber **"Didn't fit in the day"** panel below the timeline
- The block containing the current time gets a green glow

**Regeneration is manual only.** Editing activities or changing your day window never silently rewrites an existing schedule — you press the button when you want a new plan. This is deliberate: a schedule you're halfway through shouldn't rearrange itself under you.

### 4.3 Checklist pane

Today's to-do list. Simple by design.

- A text field and + button to add a task
- Each task has a checkbox, its text, and a delete button
- Checked tasks show a green filled checkbox and struck-through, dimmed text
- The header shows a live count, e.g. "2/5"

**The one clever behavior:** checking a task off **automatically writes an entry into the journal** with the current timestamp, reading `Completed: <task text>`. Unchecking the task **removes** that journal entry again, so the journal never claims you did something you didn't. Deleting the task, however, **keeps** the journal entry — completed work stays in your history even if you tidy the list.

### 4.4 Journal pane

Your log of work done, one day at a time.

- **Day navigation** at the top: left/right arrows, a label showing "Today" or a date like "Wed, Aug 6", and a "Today" shortcut button when you've navigated away. The right arrow is disabled on today — you can't browse into the future.
- **Entries** are listed chronologically, each showing its time (e.g. `16:09`) and text. Auto-generated entries carry a small green "Done" badge so you can tell them from things you wrote yourself.
- **A composer** at the bottom: a two-line text area and a "Log entry" button. Pressing **⌘↩** logs the entry without reaching for the mouse.

You can write entries for past days too (the placeholder changes to "Backfill a note for this day…"), which is useful for reconstructing a day you forgot to log.

### 4.5 Title bar

Shows today's date, and a **pin button**. Pinning makes the window float above all other applications — the intended mode for keeping it in the corner of your screen while working. The pin state persists across restarts.

---

## 5. A worked example day

This is real output from the app, not an invented illustration.

**Setup — four activities in the library:**

| Activity | Duration | Priority | Mode |
|---|---|---|---|
| Deep work | 90 min | High | Focus |
| Email sweep | 30 min | Medium | Focus |
| Reading | 45 min | Low | Focus |
| Vibecoding session | 120 min | Medium | Parallel |

**Day window:** 09:00–17:00, breaks on.

**Press Generate. The result:**

```
        FOCUS LANE                PARALLEL LANE
09:00   ┌────────────────┐        ┌────────────────┐
        │ Deep work      │        │ Vibecoding     │
        │ 09:00–10:30    │        │ session        │
10:30   ├────────────────┤        │ 09:00–11:00    │
        │ ☕ Break        │        │                │
10:40   ├────────────────┤        │                │
        │ Email sweep    │        │                │
        │ 10:40–11:10    │        │                │
11:10   ├────────────────┤        └────────────────┘
        │ ☕ Break        │
11:20   ├────────────────┤
        │ Reading        │
        │ 11:20–12:05    │
12:05   └────────────────┘
```

Note what happened: the focus activities chained in priority order with breaks between them, while the two-hour vibecoding session ran **concurrently from 09:00**, overlapping the first three focus blocks. That overlap is the entire point of the design.

**Now shrink the day to 09:00–10:30 and regenerate:**

- Deep work: 09:00–10:30 — fits exactly
- Email sweep: 10:30–11:00 — **flagged as overflow** (amber, warning icon)
- Reading: never placed — appears under **"Didn't fit in the day"**
- Vibecoding session: 09:00–11:00 — also flagged overflow

**Then during the day:** you add checklist items, tick them off as you go, and each tick silently lands in the journal with a timestamp. At the end of the day the Journal tab is a complete record — auto entries for what you completed, plus anything you wrote by hand.

---

## 6. The two-lane scheduling model

This deserves its own section because it's the app's one genuinely opinionated idea.

**The problem it solves.** Conventional day planners assume every task consumes your attention for its whole duration. But a modern working day is full of things that don't: an AI coding agent working through a task, a 3D print running for three hours, a long build, a batch render, a wash cycle. If you schedule those as ordinary blocks, your calendar fills up with time you're not actually spending.

**The model.** Every activity declares a mode:

- **Focus** — needs you. Goes in the left lane. Chains sequentially; breaks are inserted between items.
- **Parallel/Background** — runs itself. Goes in the right lane. Also chains sequentially within its own lane, but **starts at the same time as the focus lane** and overlaps it freely.

Both lanes start at your day start time and fill forward independently. Neither lane knows about the other.

**Consequences worth understanding:**

- Two background activities will *not* overlap each other — they queue in their own lane. Only focus-vs-background overlaps.
- There are no breaks in the parallel lane, since background work is passive.
- Nothing checks whether a background activity *should* start at the day's beginning. Everything simply starts as early as it can.

---

## 7. Data model

All types, complete and verbatim from the source:

```ts
export type DateKey = string // 'YYYY-MM-DD', local time

/** 1 = high, 2 = medium, 3 = low */
export type Priority = 1 | 2 | 3

/** 'background' activities run mostly unattended (AI coding, 3D prints) and fill the Parallel lane */
export type ActivityMode = 'focus' | 'background'

export interface Activity {
  id: string
  name: string
  durationMinutes: number
  priority: Priority
  mode: ActivityMode
  createdAt: string // ISO, sort tiebreaker
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  createdAt: string // ISO
  completedAt: string | null // ISO, set when checked
}

export interface JournalEntry {
  id: string
  kind: 'auto' | 'manual'
  text: string
  timestamp: string // ISO
  checklistItemId?: string // only on kind 'auto' — links to the checklist item
}

export type ScheduleLane = 'focus' | 'parallel'

export interface ScheduleBlock {
  id: string
  kind: 'activity' | 'break'
  lane: ScheduleLane
  activityId: string | null // null for breaks
  name: string // snapshot of activity name at generation time
  start: string // 'HH:mm'
  end: string // 'HH:mm'
  overflow: boolean // true if the block runs past settings.dayEnd
}

export interface Settings {
  dayStart: string // 'HH:mm'
  dayEnd: string // 'HH:mm'
  breaksEnabled: boolean
  breakMinutes: number
  alwaysOnTop: boolean
}

export interface DayData {
  checklist: ChecklistItem[]
  journal: JournalEntry[]
  schedule: ScheduleBlock[] | null // null = never generated for this day
  unscheduled: string[] | null // activity names that didn't fit
}

export interface AppData {
  version: 1
  activities: Activity[]
  settings: Settings
  days: Record<DateKey, DayData>
}
```

**Design notes on the shape:**

- **Per-day keying.** Everything daily lives under `days['YYYY-MM-DD']`, using the **local** date. Activities and settings are global, outside `days`.
- **No date library.** Dates are formatted by hand; all time arithmetic is integer minutes-since-midnight, converted via small `parseHM` / `formatHM` helpers. `'09:00'` becomes `540`, and back.
- **The auto-journal link.** `JournalEntry.checklistItemId` is what makes uncheck-retracts-the-entry possible: unchecking filters out any journal entry carrying that ID.
- **Name snapshots.** `ScheduleBlock.name` copies the activity name at generation time, so deleting or renaming an activity later cannot corrupt an already-generated day.

**Sample of the on-disk JSON** (synthetic values):

```json
{
  "version": 1,
  "activities": [
    {
      "id": "a1b2c3d4-...",
      "name": "Deep work",
      "durationMinutes": 90,
      "priority": 1,
      "mode": "focus",
      "createdAt": "2026-08-06T14:07:11.482Z"
    }
  ],
  "settings": {
    "dayStart": "09:00",
    "dayEnd": "17:00",
    "breaksEnabled": true,
    "breakMinutes": 10,
    "alwaysOnTop": false
  },
  "days": {
    "2026-08-06": {
      "checklist": [
        { "id": "...", "text": "Ship the widget", "done": true,
          "createdAt": "2026-08-06T14:08:00.000Z",
          "completedAt": "2026-08-06T16:09:22.104Z" }
      ],
      "journal": [
        { "id": "...", "kind": "auto", "text": "Completed: Ship the widget",
          "timestamp": "2026-08-06T16:09:22.104Z", "checklistItemId": "..." }
      ],
      "schedule": [
        { "id": "...", "kind": "activity", "lane": "focus", "activityId": "a1b2c3d4-...",
          "name": "Deep work", "start": "09:00", "end": "10:30", "overflow": false }
      ],
      "unscheduled": []
    }
  }
}
```

---

## 8. The schedule algorithm

A pure function with no side effects and no dependencies on React or Electron. Verbatim:

```ts
function sortForSchedule(activities: Activity[]): Activity[] {
  return [...activities].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.durationMinutes - b.durationMinutes ||
      a.createdAt.localeCompare(b.createdAt)
  )
}

function fillLane(
  activities: Activity[],
  lane: ScheduleLane,
  settings: Settings
): { blocks: ScheduleBlock[]; unscheduled: string[] } {
  const dayStart = parseHM(settings.dayStart)
  const dayEnd = parseHM(settings.dayEnd)
  const withBreaks = settings.breaksEnabled && lane === 'focus'
  const sorted = sortForSchedule(activities)
  const blocks: ScheduleBlock[] = []
  const unscheduled: string[] = []
  let cursor = dayStart

  for (let i = 0; i < sorted.length; i++) {
    const activity = sorted[i]
    const end = cursor + activity.durationMinutes
    const overflow = end > dayEnd
    blocks.push({
      id: crypto.randomUUID(),
      kind: 'activity',
      lane,
      activityId: activity.id,
      name: activity.name,
      start: formatHM(cursor),
      end: formatHM(end),
      overflow
    })
    if (overflow) {
      unscheduled.push(...sorted.slice(i + 1).map((a) => a.name))
      break
    }
    cursor = end
    const remaining = i < sorted.length - 1
    if (withBreaks && remaining && cursor + settings.breakMinutes <= dayEnd) {
      blocks.push({
        id: crypto.randomUUID(),
        kind: 'break',
        lane,
        activityId: null,
        name: 'Break',
        start: formatHM(cursor),
        end: formatHM(cursor + settings.breakMinutes),
        overflow: false
      })
      cursor += settings.breakMinutes
    }
  }

  return { blocks, unscheduled }
}

export function generateSchedule(activities: Activity[], settings: Settings): ScheduleResult {
  if (activities.length === 0 || parseHM(settings.dayEnd) <= parseHM(settings.dayStart)) {
    return { blocks: [], unscheduled: [] }
  }
  const focus = fillLane(activities.filter((a) => a.mode === 'focus'), 'focus', settings)
  const parallel = fillLane(activities.filter((a) => a.mode === 'background'), 'parallel', settings)
  return {
    blocks: [...focus.blocks, ...parallel.blocks],
    unscheduled: [...focus.unscheduled, ...parallel.unscheduled]
  }
}
```

**In plain English:**

1. Bail out early if there are no activities, or if the end time isn't after the start time.
2. Split activities into focus and background sets.
3. Sort each set: priority first (High before Low), then shorter durations first, then creation order as a tiebreak.
4. Walk each set placing blocks end-to-end from the day start. Insert a break after each focus activity if breaks are on, there's another activity coming, and the break fits.
5. If a block ends past the day end, flag it `overflow` (don't shorten it), dump every remaining activity into `unscheduled`, and stop that lane.
6. Concatenate both lanes' results.

**Behaviors that follow, worth being aware of:**

- Shorter-first sorting within a priority tier means more items fit, but a long High-priority task can still be pushed later than a short Medium one — priority always wins over duration.
- The `unscheduled` list is names only, not activity IDs, and both lanes share one list.
- Everything starts at `dayStart` regardless of what time it actually is when you press Generate.

---

## 9. Architecture

Electron apps have separate processes; this one splits responsibilities cleanly.

```
┌──────────────────────────────────────────────────────┐
│  RENDERER (React)                                    │
│  Owns all application state in one reducer.          │
│                                                      │
│    DataContext ── every change ──┐                   │
└──────────────────────────────────┼───────────────────┘
                                   │ IPC 'data:save'
                          (whole document)
                                   ▼
┌──────────────────────────────────────────────────────┐
│  MAIN (Node)                                         │
│  Owns the disk. Debounce, atomic write, recovery.    │
│                                                      │
│    store.ts ──► daily-tracker-data.json              │
└──────────────────────────────────────────────────────┘
```

**Three build targets plus a shared module.** The build produces `main` (Node process: window creation, IPC), `preload` (the security bridge), and `renderer` (the React UI). A fourth directory, `shared/`, is compiled into *both* the Node and web TypeScript projects — it holds the types, the time helpers, and the schedule algorithm, so identical logic is available on both sides without duplication.

**State management.** The entire `AppData` object lives in a single React `useReducer`. There's no state library. Every committed change triggers an effect that ships the *whole document* to the main process. At this data size (a few hundred KB even after years of use) whole-document saves are simpler and fast enough.

**Persistence guarantees, all in the main process:**

- Saves are **debounced 300 ms**, so rapid typing doesn't thrash the disk
- Writes are **atomic** — content goes to a temp file, then gets renamed over the real one, so a crash mid-write can't produce a half-written file
- A **flush on quit** means an edit followed instantly by ⌘Q still persists
- If the JSON is ever corrupt on load, the app **renames it to `*.corrupt-<timestamp>.json` and starts fresh** rather than crashing or silently deleting your data

**The IPC surface is deliberately tiny** — exactly three calls exposed to the UI:

```ts
loadData(): Promise<AppData>
saveData(data: AppData): Promise<void>
setAlwaysOnTop(flag: boolean): Promise<void>
```

Context isolation is on and Node integration is off in the renderer, so the UI can only reach these three functions and nothing else of Electron or Node.

**Day rollover.** A 30-second interval compares the current local date against the active one; when it changes (i.e. midnight passes with the app open), the app switches to a fresh day. Yesterday remains reachable through the Journal's day navigation.

---

## 10. Design and UI

**Visual language:** a dark OLED-friendly theme. Near-black background (`#020617`), slate surfaces, off-white text. Colors carry meaning rather than decoration:

- **Green** — the primary accent, focus work, completed things
- **Blue** — parallel/background work, everywhere it appears
- **Amber** — overflow warnings and "didn't fit"
- **Red** — the current-time line and destructive actions

**Layout constraints:** the window is 360×560 by default, minimum 320×480, capped at 480 wide. It uses macOS's inset title bar style, so the top strip is a drag handle that clears the traffic-light buttons. Navigation is a bottom tab bar rather than a sidebar, because at 360 px wide a sidebar would eat the content.

**Styling approach:** one hand-written stylesheet of about 900 lines, organized around CSS custom properties on `:root`. No Tailwind, no CSS-in-JS. Changing the whole palette means editing roughly 20 variables in one place.

**Icons:** inline SVG React components (24×24 viewBox, `currentColor` stroke) — no icon library dependency, no emoji used as UI icons.

**Animation** uses Motion throughout:

- Tab switches cross-fade with a slide
- The active tab indicator physically slides between tabs (shared-layout animation)
- List items animate in with a stagger and animate out when deleted; the list reflows smoothly
- Schedule blocks cascade in when a plan is generated
- Buttons and checkboxes have spring-based hover and tap feedback
- Journal entries fade in as they scroll into view
- All of it respects the system "reduce motion" accessibility setting

---

## 11. File map

| File | Purpose |
|---|---|
| `src/shared/types.ts` | Every data type in the app |
| `src/shared/schedule.ts` | The two-lane schedule generator (pure function) |
| `src/shared/time.ts` | Date keys, `HH:mm` ↔ minutes conversion, date labels |
| `src/shared/defaults.ts` | Default settings, empty-day factory, `getDay()` accessor |
| `src/main/index.ts` | App lifecycle, window configuration, IPC handler registration |
| `src/main/store.ts` | JSON persistence: load, debounced atomic save, corruption recovery |
| `src/preload/index.ts` | The three-function bridge exposed to the UI |
| `src/preload/index.d.ts` | Type declaration for that bridge |
| `src/renderer/src/App.tsx` | Root component, tab state, animated pane switching |
| `src/renderer/src/state/DataContext.tsx` | The reducer — all state transitions and business rules |
| `src/renderer/src/panes/SchedulePane.tsx` | Day-window controls, generate button, two-lane timeline |
| `src/renderer/src/panes/ChecklistPane.tsx` | Task list; triggers the auto-journal rule |
| `src/renderer/src/panes/ActivitiesPane.tsx` | Activity CRUD, priority and mode selectors |
| `src/renderer/src/panes/JournalPane.tsx` | Day navigation, entry list, manual composer |
| `src/renderer/src/components/TitleBar.tsx` | Date label and always-on-top pin |
| `src/renderer/src/components/TabBar.tsx` | Four-tab bottom navigation |
| `src/renderer/src/components/EmptyState.tsx` | Shared empty-state presentation |
| `src/renderer/src/components/icons.tsx` | All inline SVG icons |
| `src/renderer/src/assets/main.css` | The entire design system |

Plus `electron.vite.config.ts`, two `tsconfig` files, `electron-builder.yml`, and `CLAUDE.md` (guidance for AI agents working in the repo).

---

## 12. Decisions already made, and why

Please don't suggest reverting these without a strong reason — each was a deliberate choice with alternatives considered.

| Decision | Alternatives rejected | Reasoning |
|---|---|---|
| Schedule auto-fills from durations | Fixed times per activity; a hybrid of pinned + auto | Wanted zero-friction planning: describe your activities once, get a plan. Pinning would require conflict resolution UI |
| Two visually separate lanes | Overlapping strips in one timeline; explicitly pairing background work to specific focus tasks | Two lanes read most clearly at 360 px wide and keep the concurrency obvious at a glance |
| Journal is auto + manual | Manual only; auto only | Auto-logging captures completions for free; manual entries capture the things a checklist can't express |
| Hand-rolled JSON store | `electron-store` | ~50 lines, no dependency, and gives direct control over corruption recovery and whole-document semantics |
| Regeneration is manual | Auto-regenerate whenever activities or settings change | A plan you're partway through must not rearrange itself under you |
| Standard dock app window | Menu-bar/tray popover | A pinnable window is simpler and stays visible; a tray popover was considered and deferred |
| No state library, no CSS framework | Redux/Zustand, Tailwind | The app is small enough that a reducer and a stylesheet are less machinery, not more |
| Overflow blocks are flagged, not truncated | Cut the block at the day end | Showing the honest end time tells you *how much* you overcommitted |

---

## 13. Known limitations

An honest inventory of what's missing or rough. Nothing here is a bug — these are unbuilt things.

**Scheduling**
- Generation always starts at `dayStart`, even if you press Generate at 3pm. There's no "plan the rest of my day from now."
- No fixed-time activities. You can't say "gym is always at 07:00" or pin anything to a specific slot.
- No recurring or templated schedules — no notion of a weekday routine versus a weekend one.
- The parallel lane never inserts breaks and doesn't reason about whether background work should really start at the day's opening.
- No sense of energy levels or optimal ordering beyond priority and duration.

**Activities**
- Activities are **global, not per-day**. One master list drives every day, so you can't maintain separate weekday/weekend sets without editing the list.
- No drag-to-reorder; ordering is entirely derived from priority and duration.
- No categories, tags, or colors.
- No sense of which activities you actually completed — the schedule is a plan, and nothing reconciles it against reality.

**Checklist**
- Task text can't be edited after creation — only added, toggled, and deleted.
- No reordering, no sub-tasks, no due times, no priorities on tasks.
- Unfinished tasks don't carry over to the next day; they simply stay in that day's list.
- No link between checklist items and activities or schedule blocks.

**Journal**
- No search across days.
- No export — you can't get a week's log out as Markdown, CSV, or anything else without reading the raw JSON.
- Entries can't be edited or deleted once written.
- No tags or structure; entries are plain text.
- Browsing is one day at a time via arrows — no calendar picker, no week/month overview.

**Notifications and awareness**
- Nothing tells you when a block starts or ends. The app is entirely passive; you have to look at it.
- No menu-bar presence, no badge, no Do Not Disturb integration.

**Data and engineering**
- **No automated tests at all**, despite the schedule generator and reducer being pure, easily testable functions.
- `version: 1` is hardcoded with **no migration function** — changing the schema will break existing saved data.
- `days` accumulate forever with no pruning or archiving.
- No undo for any destructive action.
- No import/export or backup, beyond copying the JSON file by hand.
- Not under version control, so there's no history and no safe way to experiment.
- No packaged build has ever been produced or tested.
- The app still uses the default Electron icon.

**Analytics**
- No statistics whatsoever: no completion rates, no time-spent trends, no streaks, no weekly review.

---

## 14. Improvement backlog, ranked

My own assessment of what to build next. Roughly ordered by value per unit of effort.

### Tier 1 — highest value, modest effort

1. **Per-day or template activity sets.** The single biggest structural limitation. A "weekday" and "weekend" template, or activity sets you pick from at generation time. Touches the data model (activities move into named sets), the Activities pane, and the generator's input.
2. **Generate from now, not from day start.** A small change to the algorithm — pass a "start from" time defaulting to the current time when it's later than `dayStart`. Makes the app useful at 2pm, not just at 8am.
3. **Block-start notifications.** Native macOS notifications when a scheduled block begins. Turns a passive display into something that actually drives the day. Requires a timer in the main process plus Electron's Notification API.
4. **Carry unfinished tasks forward.** On day rollover, offer to move incomplete checklist items to the new day. Small reducer change, meaningful daily benefit.

### Tier 2 — quality of life

5. **Journal search and Markdown export.** Search across all days; export a date range as Markdown. High value for weekly reviews, and straightforward given the data is already structured.
6. **Editable text.** Let checklist items and journal entries be edited in place — currently a typo means delete and retype.
7. **Reconcile plan against reality.** Let a schedule block be marked done/skipped, so the journal records what actually happened rather than only what was planned.
8. **Drag to reorder activities**, with a manual ordering mode as an alternative to priority sorting.
9. **A calendar/week overview** in the Journal, instead of stepping one day at a time.

### Tier 3 — bigger swings

10. **Menu-bar mode.** Live in the macOS menu bar with a dropdown panel, in addition to or instead of a dock window. This was considered at design time and deferred.
11. **Statistics view.** Completion rates over time, hours by activity, streaks. Needs a fifth tab and some aggregation, but all the raw data already exists.
12. **Fixed-time activities.** Pin specific things to specific times and let the generator fill around them. This was explicitly deferred at design time; revisiting it means designing conflict handling.
13. **Calendar import.** Read macOS Calendar events as immovable blocks the schedule must work around.
14. **Smarter scheduling.** Energy-aware ordering (hard work when you're sharp), or learning typical durations from history.

### Tier 4 — engineering hygiene, do before the app grows

15. **`git init`.** There's no version history at all right now. This should honestly be done first.
16. **A test suite.** `generateSchedule` is a pure function with rich edge cases (overflow, empty lanes, invalid windows, break-fitting) and the reducer's auto-journal rule has real asymmetries. Both are near-trivial to test and currently untested. Vitest would fit the existing Vite tooling.
17. **A data migration path.** Add a version-upgrade function *before* the schema next changes, so saved data survives.
18. **Package and run the real `.app`.** The build has never been executed; there may be surprises around icons, signing, or paths.
19. **A real app icon.**

---

## 15. Extension recipes

If you want to suggest a change, here's what it would actually touch.

**Adding a field to Activity** (say, a category or color): add it to the `Activity` interface in `shared/types.ts`; extend the `addActivity` reducer action and the update path in `state/DataContext.tsx`; add the input control to `panes/ActivitiesPane.tsx`; display it in the activity list row and optionally on schedule blocks. Because there's no migration system, also decide what happens to activities saved without the field — an optional property or a default at read time.

**Adding a fifth tab/pane:** add the ID to the `TabId` union and the tab list in `components/TabBar.tsx` (with an icon in `components/icons.tsx`); add a case to the switch in `App.tsx`; create the pane component in `panes/`. The tab bar is a four-column grid in the stylesheet, so that value would need updating too.

**Adding a persisted setting:** add it to the `Settings` interface and to `defaultSettings()` in `shared/defaults.ts`; it will then flow through the existing `updateSettings` reducer action and persist automatically. Add the control wherever it belongs in the UI.

**Changing scheduling behavior:** everything lives in `shared/schedule.ts`, which is a pure function taking `(activities, settings)` and returning `{ blocks, unscheduled }`. If a change needs new inputs — a "start from" time, fixed-time pins, calendar busy blocks — extend that signature and update the single call site in `panes/SchedulePane.tsx`. Because it's pure and dependency-free, this is also the easiest place in the codebase to add tests.

**Adding an IPC capability** (notifications, file export, tray): three files must change together — register the handler in `main/index.ts`, expose the function in `preload/index.ts`, and declare it on the `Api` interface in `preload/index.d.ts`. The renderer then calls it as `window.api.yourFunction()`.

---

## 16. Questions I'd like help with

1. **How should I actually use this day-to-day?** How should I structure my activity library — a few broad blocks, or many specific ones? How should I use priorities given that they drive ordering? What's a sensible daily routine around generating the schedule and reviewing the journal?
2. **Is the two-lane model right?** Does separating focus from background work the way this does match how a day really goes, or is there a better mental model?
3. **What's the highest-value thing to build next?** Do you agree with my Tier 1, or is something further down the list actually more important?
4. **What am I not seeing?** Is there an obvious feature or framing this app is missing that would make it substantially more useful?
