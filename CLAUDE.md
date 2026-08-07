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
```

`build:mac` writes `dist/mac-arm64/daily-tracker.app` plus a `.dmg` and `.zip`. It is **unsigned** — there is no Developer ID, so electron-builder skips signing. A locally built app opens fine; one that has been downloaded or AirDropped picks up a quarantine flag and needs right-click → Open once.

Two things in `electron-builder.yml` that must not drift: `productName: daily-tracker` decides `app.getPath('userData')`, so renaming it strands the existing data file; and `asarUnpack: resources/**` is what lets `nativeImage.createFromPath` read the tray icons at runtime.

There is no test framework in this project. Verify changes by running the app (see below), not by running tests.

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
- The preload bridge (`src/preload/index.ts`, typed in `index.d.ts`) exposes exactly three calls: `loadData`, `saveData`, `setAlwaysOnTop`. Adding an IPC channel means touching main, preload, and the `Api` interface together.

### Per-day keying

Daily data lives under `AppData.days['YYYY-MM-DD']` using the **local** date from `todayKey()`. There is no date library — all time arithmetic is integer minutes-since-midnight via `parseHM`/`formatHM` in `src/shared/time.ts`. `getDay()` (in `src/shared/defaults.ts`) returns an empty day shape for missing keys so panes never null-check. A 30-second interval in `DataContext` dispatches `setActiveDate` when the date rolls over.

### Recurring checklist tasks

`AppData.recurringTasks` holds standing rules (daily / weekly-on-weekdays / monthly-on-day). `src/shared/recurrence.ts` is a pure function pair — `dueOn` and `pendingRules` — and is the only place recurrence logic belongs.

Three rules that are easy to break:

- **Materialisation happens in the reducer**, on `hydrate` and `setActiveDate`, not in an effect. `setActiveDate` is dispatched from exactly one place — the 30-second rollover interval — so it always means "the real calendar date changed". The Journal browses history with local `viewDate` state and never dispatches it, which is what keeps browsing the past from creating tasks there. If that ever changes, materialisation must be guarded on `date === todayKey()`.
- **`DayData.recurringApplied` is per-day on purpose.** It records which rule ids a day has already had applied. A global "last run" marker would resurrect a generated task the moment the user deleted it and reopened the app — saying "not today" has to stick.
- **Rules only ever fill in today.** There is no backfill and no carry-forward; a missed occurrence leaves no trace, so the journal never claims the user saw a task they never did.

A monthly rule set past the end of a short month clamps to that month's last day — a "31st" rule fires on 28 February rather than skipping four months a year.

### Business rules that live in the reducer

The auto-journal link is the important one: `toggleChecklistItem` inserts a `JournalEntry` with `kind: 'auto'` and `checklistItemId` set when an item is checked, and removes that linked entry when it's unchecked. Deleting a checklist item deliberately keeps its journal entry — completed work stays in history. Keep this rule in the reducer rather than in pane components so it holds for every caller.

### Clock display vs clock storage

`formatHM` is a **storage** format: `schedule.ts` uses it to write `block.start` / `block.end`, which persist as `"09:00"` and are read back with `parseHM`. `formatClock` / `formatClockMinutes` are the **display** helpers that render 12-hour (`"9:00 AM"`). Never render with `formatHM`, and never store with `formatClock` — swapping them corrupts every saved schedule.

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

## Conventions

- **Animations use Motion (`motion/react`)** — not CSS transitions — for anything stateful: `AnimatePresence mode="wait"` for tab switches, `layout` + `AnimatePresence` for list enter/exit, `staggerChildren` variants for list and timeline reveals, `layoutId` for the sliding tab indicator, spring `whileHover`/`whileTap` on controls. `MotionConfig reducedMotion="user"` in `App.tsx` plus a `prefers-reduced-motion` block in the CSS handle accessibility.
- **Styling is hand-written CSS** driven by custom properties — dark palette, cyan accent for focus, fuchsia for parallel, amber for overflow, rose for destructive. No CSS framework, no CSS-in-JS. The palette lives in `src/renderer/src/assets/tokens.css` and nowhere else; `main.css` (app window) and `src/renderer/src/widget/widget.css` (popover) both `@import` it, because they are separate documents with separate bundles. Change a colour there, not in either stylesheet.
- **The two lane colours are chosen for hue separation, not luminance.** Cyan and fuchsia sit 104° apart; the previous emerald/blue pair was 55° apart and read as one colour in a 3px lane bar. If you ever re-pick them, check the hue gap — contrast ratio alone will not tell you whether two lanes are distinguishable.
- **Fonts are bundled, never fetched.** IBM Plex Sans/Mono come from `@fontsource/*`, imported in both renderer entries. The CSP is `default-src 'self'` and the app must work offline, so a Google Fonts `@import` would silently fall back to a system font. Only static weights are bundled (400/500/600/700) — do not write `font-weight: 450`; that only worked while the stack resolved to variable SF Pro.
- **Icons are inline SVG components** in `src/renderer/src/components/icons.tsx` (24×24 viewBox, `currentColor` stroke). No emoji as icons, no icon library dependency.
- ESLint enforces `react-hooks` rules strictly. Two patterns this repo already resolved: mutating a ref during render is an error (assign inside an effect), and `setState` directly in an effect is an error (use the adjust-state-during-render pattern, as `JournalPane` does for date rollover).
