# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Daily Tracker — a compact macOS desktop widget (Electron + React + TypeScript, scaffolded with electron-vite) that tracks daily activities, a checklist, a work journal, and an auto-generated two-lane day schedule.

## Commands

```bash
npm run dev          # dev mode with HMR (renderer) + auto-restart (main/preload)
npm run typecheck    # both TS projects; run before considering work done
npm run lint         # eslint --cache .
npm run format       # prettier --write .
npm run build        # typecheck + electron-vite build
npm run build:mac    # package a .app via electron-builder
npm test             # vitest run — the whole suite, once
```

```bash
npx vitest run src/shared/plan.test.ts            # one file
npx vitest run -t 'never places over an anchor'   # one test, by name
npx vitest                                        # watch mode
```

`build:mac` writes `dist/mac-arm64/daily-tracker.app` plus a `.dmg` and `.zip`. It is **unsigned** — there is no Developer ID, so electron-builder skips signing. A locally built app opens fine; one that has been downloaded or AirDropped picks up a quarantine flag and needs right-click → Open once.

Two things in `electron-builder.yml` that must not drift: `productName: daily-tracker` decides `app.getPath('userData')`, so renaming it strands the existing data file; and `asarUnpack: resources/**` is what lets `nativeImage.createFromPath` read the tray icons at runtime.

There is no vitest config file — vitest runs on defaults and picks up `src/**/*.test.ts`. **Only `src/shared/` is tested**, because that is where the pure logic lives; main and renderer have no test harness, so UI and IPC changes are still verified by running the app (see below).

Tests are written in one house style, set by `plan.test.ts`: local factories taking `Partial<T>` overrides, no mocks, and **no clock** — every module that needs the time or the date takes it as an argument. Assertions flatten results into readable strings (`'DATE HH:mm-HH:mm name'`) rather than comparing object graphs. Follow it; a test that reaches for `vi.mock` or `new Date()` is a sign the module under test has the wrong seam.

### Launching Electron from this environment

Shells spawned from the VS Code extension inherit `ELECTRON_RUN_AS_NODE=1`, which makes the Electron binary run as plain Node — `electron.app` is undefined and startup crashes with `Cannot read properties of undefined (reading 'isPackaged')`. The `dev` and `start` scripts already wrap themselves in `env -u ELECTRON_RUN_AS_NODE`; keep that wrapper if you edit them.

To verify UI changes end-to-end, launch with a debugging port and drive the app over the Chrome DevTools Protocol (Node 22+ has a global `WebSocket`, so no dependencies are needed):

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev -- -- --remote-debugging-port=9223
curl -s http://127.0.0.1:9223/json/list   # get webSocketDebuggerUrl for the page target
```

From there, `Runtime.evaluate` drives the UI and `Page.captureScreenshot` confirms layout. `window.api.loadData()` in the page context reads the persisted state directly, which is the fastest way to assert on reducer behavior.

## Architecture

### Three build targets, one shared module

`electron.vite.config.ts` builds `src/main`, `src/preload`, and `src/renderer` separately. `src/shared/` is compiled into **both** the node and web TS projects (it appears in the `include` of `tsconfig.node.json` and `tsconfig.web.json`, and is aliased to `@shared` in the renderer). Anything main and renderer both need — types, time math, the schedule generator — belongs there. Renderer code imports it as `@shared/types`; main and preload use relative paths (`../shared/types`), because the alias is only registered for the renderer build.

The renderer target has **two HTML entries**: `index.html` (the app window) and `widget.html` (the menu bar popover), declared as separate rollup inputs. They are separate documents with separate React roots, so the popover never loads the panes, the reducer or `DataContext`.

### Block geometry lives in exactly one module

`src/shared/blocks.ts` owns everything that reasons about where a block sits in time: `blockSpan` / `blockMinutes` / `blockEnd`, `overlaps`, `freeIntervals`, `byStart`, `coalesceFree`, `makeFreeBlock`, and the `isImmovable` / `isTransparent` / `isConsumable` predicates.

**`blockSpan` is the only place the past-midnight unwrap is written.** `formatHM` wraps, so an overflow block ending at 00:30 stores `end: "00:30"` — below its own start. Reading `parseHM(end)` raw yields an inverted interval that every sweep in this codebase silently discards, which makes a 23:00–00:30 block invisible and gets scheduled straight over. That unwrap was independently duplicated in four modules before it moved here; if you find yourself writing `parseHM(block.end)`, use `blockSpan` instead.

`freeIntervals` lives here rather than in `plan.ts` on purpose: `plan.ts` already imports from `schedule.ts`, so leaving it there and having `schedule.ts` import it creates a cycle.

### The menu bar widget

`src/main/tray.ts` owns a `Tray` plus a frameless, transparent, non-focusable popover window. Hovering the icon shows the panel; clicking it opens the app window.

The key inversion from the rest of the app: **this summary is derived in main, not the renderer.** `buildWidgetSummary()` in `src/shared/widget.ts` is a pure function over `AppData`, and main feeds it from `loadData()`, which returns the same in-memory document the renderer is editing. That means the widget keeps working with the app window closed. The renderer never computes it — it only receives `WidgetSummary` snapshots on the `widget:update` channel and renders them.

Three things that are easy to get wrong here:

- **Hover-out is decided by polling the cursor** (`screen.getCursorScreenPoint()` every 120 ms against the tray and popover rects), not by DOM `mouseleave` — a non-focusable window does not deliver those reliably. The popover is positioned flush against the menu bar so the pointer never crosses a dead gap; the visible float is transparent CSS padding inside the window.
- **The panel sizes itself.** A `ResizeObserver` in the renderer reports its height back over `widget:resize`, and main applies it to the window bounds. Content height varies with how many blocks are in play, so the window is sized to the content rather than the reverse.
- **Tray hover events are macOS-only**, so `initTray()` is guarded on `process.platform === 'darwin'`. The tray title (`trayTitle()`) is deliberately near-empty: a running timer, else minutes left on the current focus block, else nothing.

Main polls at 1 s while the panel is open or a timer runs, and 15 s otherwise; `data:save` also triggers a refresh so the panel never waits on the 300 ms save debounce.

### Data flow

The renderer owns all state; main owns the disk.

```
DataContext (useReducer)  --IPC 'data:save'-->  store.ts  -->  daily-tracker-data.json
      ^                                                              |
      +----------------- IPC 'data:load' <--------------------------+
```

- `src/renderer/src/state/DataContext.tsx` holds the entire `AppData` in one reducer. Every committed change triggers a `saveData` effect that ships the **whole document** to main.
- `src/main/store.ts` debounces those saves 300 ms, writes atomically (tmp file + rename), and flushes synchronously on `before-quit`. A parse failure renames the bad file to `*.corrupt-<epoch>.json` rather than discarding it.
- The preload bridge (`src/preload/index.ts`, typed in `index.d.ts`) exposes eleven calls: `loadData`, `saveData`, `setAlwaysOnTop`, `setTimerAlarm`, `aiStatus`, `aiSetKey`, `aiTest`, `onWidgetUpdate`, `widgetReady`, `widgetResize`, `widgetOpenApp`. Adding an IPC channel means touching main, preload, and the `Api` interface together.

### The AI key

`src/main/ai-config.ts` stores a Gemini API key in the macOS Keychain (via Electron's `safeStorage`), with the `GEMINI_API_KEY` environment variable taking priority when set. `SettingsPane` drives it.

**The key never crosses the IPC boundary.** The renderer only ever sees `AiStatus` — whether one is configured, where it came from, and the last four characters. `aiSetKey` sends a key _in_; nothing sends one back out. Keep that direction, or the key ends up in renderer memory and, worse, in the saved document.

Nothing consumes the key yet: this is storage only, and the app is fully usable without one.

### Schema versions and migration

`AppData.version` is currently **9**. `src/shared/migrate.ts` is a chain of one-way `vNToVN+1` pure functions, applied in sequence by `migrate()`, so a document several versions behind walks through each step in turn. Never edit an old migration to add a new field — write the next one.

Changing the schema means bumping the version in **three** places that must agree: `CURRENT_VERSION` in `migrate.ts`, the literal on `AppData` in `types.ts`, and the default in `defaults.ts`. Miss one and the app either re-migrates every launch or quarantines its own file.

`store.ts` guards the file on load: a parse failure or a version _newer_ than `CURRENT_VERSION` renames the file aside (`*.corrupt-<epoch>.json`, `*.newer-v<n>-<epoch>.json`) rather than discarding it, and an older version is copied to `*.pre-v<n>-<epoch>.json` before migrating. Those backups accumulate in `~/Library/Application Support/daily-tracker/` and are never cleaned up.

**A migration must not invent history.** `v6ToV7` deliberately creates no free blocks on already-generated days — a day keeps the exact shape the user last saw until they press Regenerate. `v8ToV9` follows the same rule from the other direction: it stamps `carriedForward: true` on every day that already exists, because the carry-forward sweep turns unfinished blocks into backlog work and defaulting these to false would harvest months of history on the first launch after the upgrade.

### Deadlines and derived priority

`src/shared/priority.ts` is the only place urgency is decided. `Activity` and `BacklogTask` both carry an optional `dueDate`, and **a deadline overrides the hand-set `priority`** — `effectivePriority(item, today)` returns the derived level whenever `dueDate` is non-null.

- **Derived at read time, never stored.** That is what lets a task escalate on its own as its date approaches without anything rewriting the document. Both `sortForSchedule` and `sortForPlanning` call it; `GenerateOptions.today` and `PlanInput.fromDate` supply the date, keeping both modules clock-free.
- The ladder is deliberately coarse and distance-only (High ≤1 day, Medium ≤4, else Low). Estimates are optional and often wrong; a priority the user can predict beats one that is merely clever.
- `UrgencyField` presents Priority and Deadline as **exclusive** options. Showing both as editable would offer a control that silently does nothing, since the deadline always wins.

### Routines

`AppData.routines` holds standing daily commitments — waking, lunch, dinner. `src/shared/routines.ts` resolves them to anchors for a date; an empty `weekdays` array means every day.

**`src/shared/anchors.ts` (`dayAnchors`) is the single resolver** for everything fixed on a day, prayers and routines together. It replaced two hand-copied prayer expressions in `SchedulePane.generate()` and `DataContext.replan()` — with two copies, a routine added to one and not the other would make the generated day disagree with the day the planner sees.

Routines block the **focus lane only**, exactly like prayer: eating lunch does not stop a 3D print, and occupying the parallel lane would also tell `planBacklog` the whole day is booked. `Anchor.source` rides through `schedule.ts` untouched onto `ScheduleBlock.anchorSource`, purely so the timeline can pick an icon — the generator still treats every anchor identically.

### Carrying unfinished work forward

`src/shared/carry.ts` sweeps days that have passed and reports the work left on them, which the reducer mints as backlog tasks and `replan` then places into the days ahead.

- **The past is never rewritten.** Yesterday's blocks keep the shape the user last saw; only new backlog work is created.
- `'planned'` carries in full, `'partial'` carries `plannedMinutes - actualMinutes`. **`'done'` and `'skipped'` carry nothing** — skipping is a decision, and re-carrying it would override the user by hand.
- Blocks with a `backlogTaskId` are skipped: the planner already derives that task's remaining minutes as estimate-minus-placed, so minting more would double-count.
- `DayData.carriedForward` is the per-day idempotency record, for the same reason as `recurringApplied` — a carried task the user deleted has to stay deleted. `carriedFromBlockId` on the task is the second guard.

### Per-day keying

Daily data lives under `AppData.days['YYYY-MM-DD']` using the **local** date from `todayKey()`. There is no date library — all time arithmetic is integer minutes-since-midnight via `parseHM`/`formatHM` in `src/shared/time.ts`. `getDay()` (in `src/shared/defaults.ts`) returns an empty day shape for missing keys so panes never null-check. A 30-second interval in `DataContext` dispatches `setActiveDate` when the date rolls over.

### The backlog and multi-day placement

`AppData.backlog` is a standing, dateless list ordered by priority — it replaced the per-day checklist in v6. `src/shared/plan.ts` (`planBacklog`) distributes unfinished work into free time across a rolling horizon.

- **It only ever writes into gaps.** Existing blocks are inputs, never outputs. That is what makes it safe to re-run on every add without violating the rule that nothing silently rewrites a day already underway.
- **Idempotency comes from arithmetic, not bookkeeping.** A task's remaining work is its estimate minus the minutes already carrying its `backlogTaskId`. A second run finds nothing left, so `hydrate` re-running placement can never duplicate.
- **Anchors are passed in, never computed there** — `DataContext.replan()` resolves prayer times per day, so `plan.ts` stays prayer-agnostic and testable without a clock. Same seam as `generateSchedule`.
- Tasks with **no estimate are never placed**; they still list. Guessing at how much of a day to spend is worse than leaving it to the user.
- A task is never scheduled past its own `dueDate`, and work that doesn't fit the horizon comes back as `unplaced` rather than being dropped. `replan` discards it; `ChecklistPane` re-derives the same fact (an estimate, but zero placed minutes) as a "no room in the next two weeks" note, so it stays derived rather than stored.
- Split work is named `"Task (Part 2 of 3)"`, counting the blocks that already carry the task id. Counting merely _whether_ any minutes were placed — as it once did — numbered the fourth piece of a task as its second, and the labels drifted on every re-plan.
- Completing or deleting a task drops its **future** placements only; past blocks stay as history.

`setSchedule` replaces a day wholesale, so `SchedulePane.generate()` dispatches `replan` straight after to re-place backlog work around the newly generated blocks.

### Recurring checklist tasks

`AppData.recurringTasks` holds standing rules (daily / weekly-on-weekdays / monthly-on-day). `src/shared/recurrence.ts` is a pure function pair — `dueOn` and `pendingRules` — and is the only place recurrence logic belongs.

Three rules that are easy to break:

- **Materialisation happens in the reducer**, on `hydrate` and `setActiveDate`, not in an effect. `setActiveDate` is dispatched from exactly one place — the 30-second rollover interval — so it always means "the real calendar date changed". The Journal browses history with local `viewDate` state and never dispatches it, which is what keeps browsing the past from creating tasks there. If that ever changes, materialisation must be guarded on `date === todayKey()`.
- **`DayData.recurringApplied` is per-day on purpose.** It records which rule ids a day has already had applied. A global "last run" marker would resurrect a generated task the moment the user deleted it and reopened the app — saying "not today" has to stick.
- **Rules only ever fill in today.** There is no backfill and no carry-forward; a missed occurrence leaves no trace, so the journal never claims the user saw a task they never did.

A monthly rule set past the end of a short month clamps to that month's last day — a "31st" rule fires on 28 February rather than skipping four months a year.

### Business rules that live in the reducer

The auto-journal link is the important one: `toggleBacklogTask` inserts a `JournalEntry` with `kind: 'auto'` and `checklistItemId` set when an item is checked, and removes that linked entry when it's unchecked. (The field name is a leftover from the per-day checklist that `v5ToV6` retired — it holds a backlog task id. `DayData.checklist` still exists but is always empty, kept so an older build still finds the field it expects.)

`ChecklistPane` renders two things: `AppData.backlog`, and a **"On today's schedule" section derived from `today.schedule`** — the activity blocks with an `activityId`. Ticking one dispatches `setBlockStatus`, so the block and its journal entry are written by the same reducer path the Schedule tab uses; there is no second copy of the state. Blocks carrying a `backlogTaskId` are excluded from that section because the task itself is already listed below with its scheduled-at line. Deleting a checklist item deliberately keeps its journal entry — completed work stays in history. Keep this rule in the reducer rather than in pane components so it holds for every caller.

### Clock display vs clock storage

`formatHM` is a **storage** format: `schedule.ts` uses it to write `block.start` / `block.end`, which persist as `"09:00"` and are read back with `parseHM`. `formatClock` / `formatClockMinutes` are the **display** helpers that render 12-hour (`"9:00 AM"`). Never render with `formatHM`, and never store with `formatClock` — swapping them corrupts every saved schedule.

Two things used to break this rule and no longer do. `formatTimestamp` reached for `formatHM` and printed 24-hour journal entries. And **`<input type="time">` renders in Chromium's own UI locale, not the document's**, so the day window could read `13:00` while every other time in the app said `1:00 PM` — a native control sidestepping the rule entirely. `TimeField` replaces all four of those inputs with plain selects; its `value`/`onChange` stay in `'HH:mm'`, so only the presentation changed. Do not reintroduce `input[type=time]`.

### Prayer anchors

`src/shared/prayer.ts` computes prayer times from solar geometry — hand-written, no package, pure. `PrayerSettings` on `AppData` holds the location (Richmond VA), the method angles, and `asrFactor`.

- **No timezone library, on purpose.** Times are computed in UT and shifted by `Date.getTimezoneOffset()` _for that date_, which already returns −5h in January and −4h in August. This assumes the machine's clock matches the zone the user prays in.
- **`schedule.ts` knows nothing about prayer.** It takes `GenerateOptions.anchors` as plain `{name, start, end}` data; `SchedulePane` resolves prayer times and passes them in. Keep that seam — any future fixed commitment (class, work shift) becomes an anchor with no change to the generator.
- **Anchors block the focus lane only.** A 3D print or vibecoding run keeps going through salah, which is the point of the parallel lane.
- Anchors are not markable — `applyBlockStatus` refuses anything where `kind !== 'activity'`.

### Two-lane schedule generation

`src/shared/schedule.ts` is a pure function and the only place scheduling logic belongs. Activities split by `mode`: `'focus'` fills the Focus lane (with optional 10-minute breaks between consecutive items), `'background'` fills the Parallel lane. **Both lanes start at `dayStart`** — that overlap is the feature, letting a vibecoding session or 3D print run concurrently with focused work. Within a lane, sort is priority → duration → `createdAt`.

Blocks that run past `dayEnd` are flagged `overflow: true` rather than truncated; once a lane overflows, its remaining activities go to the shared `unscheduled` list. `ScheduleBlock.name` snapshots the activity name at generation time, so deleting an activity later doesn't corrupt an already-generated day.

Regeneration is **manual only** (the Generate/Regenerate button). Editing activities or settings never silently rewrites a schedule mid-day.

### Editing a day after it exists

`src/shared/reschedule.ts` is the only place a day's geometry is mutated: `shiftAfter`, `editBlock`, `insertBlock`, `removeBlock`, `extendBlock`, `truncate`, `spill`, `bankSpilled`. Pure and clock-free, so the reducer stays thin and all of it is testable without a running app.

- **Anchors are never passed in.** They are already in the block array as `kind: 'anchor'` and `isImmovable` finds them — barriers are derived, so a caller cannot forget them.
- **`shiftAfter` is not an inverse.** `+20` then `-20` does not restore a free block the first call consumed. Asserted in a test, because it is exactly what the next reader assumes.
- **Consumables give up minutes off their front, never their end**, so a shift absorbed by free time costs the rest of the day nothing. One left under 5 minutes is dropped.
- **A skipped block never moves but is never a barrier** — nothing happened in it.
- **`editBlock` rejects rather than cascades.** A collision is refused with the name of what is in the way, and the sheet offers an explicit "shift the rest". Silent auto-shifting on a timeline you cannot drag reads as the app arguing with you.
- Geometry is computed in the **component** and only the result is dispatched (`setDaySchedule`), matching the seam `SchedulePane.generate()` already used. That keeps actions plain serialisable data instead of threading error callbacks through the reducer.

**Regenerate keeps hand edits.** Blocks that are `manual` or already settled are retained and fed back as `GenerateOptions.reserved` — spans the generator routes around but does _not_ emit. `anchors` are emitted, `reserved` are not; passing a pinned block as an anchor duplicates it as an anchor-shaped copy of itself. Activities that already own a kept block are filtered out of the regeneration, or moving a block by hand leaves you with it _and_ a fresh copy back where it started.

### Prompts and pause

Both prompt queues are **derived, never stored** (`useEndedBlocks`). Answering changes a status or stamps `promptedAt`, which removes the block from the derivation. That is why "the app was closed for five hours" needs no special code.

- **A dismissal must never be readable as an answer.** Deferring the end-of-block prompt is held in memory and writes nothing, so relaunching re-asks. The early-finish prompt is the mirror image: it _does_ stamp `promptedAt`, because it is an offer and declining an offer is a real answer.
- `status: 'partial'` exists so `syncBlockJournal` can write `Worked on:` instead of `Completed:` — without it, "keep for later" would have to record `done` and the journal would claim finished work that isn't.
- `pauseDay` freezes the day **and** the running timer in one reducer case; two dispatches would mean two whole-document writes and a timer recording the pause as work.
- A pause is a **within-day** device. Crossing midnight or running over ~8h clears it with **no shift**, enforced on `hydrate` and `setActiveDate` as well as on resume.

### The timeline's coordinate origin

Hour lines, both lanes and the now-line are absolutely positioned inside **`.timeline-body`**, which exists solely so all three share one origin. They used to be positioned against `.timeline`, whose `padding-top: 7px` offsets its in-flow children but not its absolute ones — so `.lanes` began 7px below the ruler and **every hour label sat 7px off the block it marked**, the whole way down the day. If you add anything positioned by minute, put it inside `.timeline-body`.

The 54px gutter left of the lanes belongs to the hour labels; `.lane-headers` and `.nowline` are aligned to it rather than carrying their own guesses. Hour lines are drawn every 30 minutes, labelled on the hour and left as a fainter dotted tick on the half.

`Lane` also renders `.gap` elements over `freeIntervals` — annotation only, `pointer-events: none`, nothing about the schedule changes because a gap is drawn. Gaps under 15 minutes are left unlabelled.

### Theming

`Settings.theme` is `'system' | 'light' | 'dark'`, stamped onto `<html>` as `data-theme` by `useTheme`. `SettingsPane` keeps the three-way control; the title-bar button is a shortcut that **resolves `'system'` against `prefers-color-scheme` before flipping**, so the first press never no-ops when the OS already matched. `[data-theme='light']` carries the light palette and `[data-theme='system']` picks it up through `prefers-color-scheme`, so an explicit choice beats the media query rather than racing it. Both documents stamp their own root — the popover has no `DataContext`, so the choice rides along on `WidgetSummary`.

**The light lane colours are re-picked, not inverted.** Cyan and fuchsia tuned for a dark ground fall to roughly 1.8:1 on white. The light values are the same hues taken much darker, preserving the 104° gap. If they are ever re-picked, check the hue gap — contrast ratio alone will not tell you whether two lanes are distinguishable.

### Protected free time

`kind: 'free'` blocks are rest the generator commits to. `fillLane` tracks focus minutes since the last real rest and, once `settings.freeBufferEveryMinutes` is reached, emits a free block **instead of** the break at that boundary — two rests back to back is one rest.

- **Focus lane only.** Protected rest from an unattended 3D print means nothing, and a free block in the parallel lane would tell `planBacklog` the whole day is occupied.
- **An anchor on the boundary is the rest.** Salah interrupts the flow on its own, so it resets the accumulator and nothing is inserted on top of it.
- **Skipped, never shifted.** A buffer that collides with a nearby anchor or would cross `dayEnd` is dropped and stays due at the next boundary — moving it would put rest somewhere the user didn't earn it.
- **The leftover tail of the day is deliberately NOT protected**, and this is the one that looks like an oversight. `planBacklog` treats every focus-lane block as occupied regardless of `kind` — that is exactly why free time is safe from it with no code in `plan.ts` — and `SchedulePane.generate()` dispatches `replan` immediately after `setSchedule`. Protecting the tail would therefore mean backlog work could never be placed on a generated day at all. There is a test asserting the tail stays open.

`buildWidgetSummary` filters `kind: 'free'` out of `now` / `next` / `dayComplete`, so the menu bar never announces "Free" as the current task or counts down the end of a rest.

## Conventions

- **Animations use Motion (`motion/react`)** — not CSS transitions — for anything stateful: `AnimatePresence mode="wait"` for tab switches, `layout` + `AnimatePresence` for list enter/exit, `staggerChildren` variants for list and timeline reveals, `layoutId` for the sliding tab indicator, spring `whileHover`/`whileTap` on controls. `MotionConfig reducedMotion="user"` in `App.tsx` plus a `prefers-reduced-motion` block in the CSS handle accessibility.
- **Styling is hand-written CSS** driven by custom properties — dark palette, cyan accent for focus, fuchsia for parallel, amber for overflow, rose for destructive. No CSS framework, no CSS-in-JS. The palette is _meant_ to live in `src/renderer/src/assets/tokens.css`; `main.css` (app window) and `src/renderer/src/widget/widget.css` (popover) both `@import` it, because they are separate documents with separate bundles. Add or change a colour there, not in either stylesheet.

That rule now genuinely holds: no colour literal appears in either stylesheet. If you add one, add a token instead — a second palette exists, and a literal silently ignores it.

- **The two lane colours are chosen for hue separation, not luminance.** Cyan and fuchsia sit 104° apart; the previous emerald/blue pair was 55° apart and read as one colour in a 3px lane bar. If you ever re-pick them, check the hue gap — contrast ratio alone will not tell you whether two lanes are distinguishable.
- **Fonts are bundled, never fetched.** IBM Plex Sans/Mono come from `@fontsource/*`, imported in both renderer entries. The CSP is `default-src 'self'` and the app must work offline, so a Google Fonts `@import` would silently fall back to a system font. Only static weights are bundled (400/500/600/700) — do not write `font-weight: 450`; that only worked while the stack resolved to variable SF Pro.
- **Icons are inline SVG components** in `src/renderer/src/components/icons.tsx` (24×24 viewBox, `currentColor` stroke). No emoji as icons, no icon library dependency.
- ESLint enforces `react-hooks` rules strictly. Two patterns this repo already resolved: mutating a ref during render is an error (assign inside an effect), and `setState` directly in an effect is an error (use the adjust-state-during-render pattern, as `JournalPane` does for date rollover).
