# Daily Tracker

A compact macOS desktop widget that runs your day: a reusable library of
activities, a checklist, a work journal, and an auto-generated **two-lane**
day schedule — one lane for focused work, one for things that run in the
background (an AI coding session, a 3D print, a long render) while you do
something else.

Built with Electron + React + TypeScript.

## What it does

- **Two-lane schedule.** Activities are tagged Focus or Parallel and laid out
  side by side, so background work is planned *concurrently* with focused
  work instead of eating into it.
- **Autopilot.** Once a schedule is generated, the app announces each block
  as it starts, times it, and asks whether you finished — the day runs
  itself, even with the window closed (a menu bar widget keeps going).
- **Direct manipulation.** Drag blocks to move them, resize from either edge;
  collisions are resolved by shifting only what's in the way.
- **Standing backlog.** Unfinished and recurring work is placed automatically
  into free time across the days ahead, respecting due dates and priority.
- **Journal.** A timestamped, editable log of what you actually did, kept in
  sync with the schedule.
- **Deadlines, routines, and prayer-time anchors** that block the focus lane
  without blocking background work.
- **Light and dark themes**, a menu bar popover, and a small, always-on-top
  main window.
- **External Claude access via MCP.** A local-only server lets Claude Code or
  Claude Desktop read your journal/backlog/projects/activities and suggest
  new to-dos, activities, or projects — create-only, never edit or delete.

## Requirements

- macOS (this is where it's built and tested day to day; `npm run build:win`
  / `build:linux` exist but are unverified — see [Known limitations](#known-limitations))
- [Node.js](https://nodejs.org/) 20 or later
- npm

## Quickstart — with an IDE

```bash
git clone https://github.com/AymanM-Projects/daily-tracker.git
cd daily-tracker
npm install
npm run dev          # dev mode with hot reload
```

Package a standalone `.app`:

```bash
npm run build:mac
```

This writes `dist/mac-arm64/daily-tracker.app` plus a `.dmg` and `.zip`. It's
**unsigned** (no Apple Developer ID), so a locally built app opens fine, but
one that's been downloaded or AirDropped picks up a quarantine flag — the
first launch needs right-click → **Open**.

Other useful commands:

```bash
npm run typecheck    # both TypeScript projects
npm run lint          # eslint
npm test              # vitest — runs once
```

## Quickstart — with just Claude Code

This repo ships a detailed [CLAUDE.md](CLAUDE.md) written for AI coding
agents: build commands, architecture, and the non-obvious gotchas (an
Electron quirk in this environment, IPC boundaries, schema migrations). You
don't need to read the source first — clone it, open the folder with
[Claude Code](https://claude.com/product/claude-code), and ask it to get the
app running:

```bash
git clone https://github.com/AymanM-Projects/daily-tracker.git
cd daily-tracker
claude
```

Then just say something like *"install dependencies and start the dev
server"* — Claude Code will read `CLAUDE.md` first and take it from there.

## Connecting an external Claude session (MCP)

The app runs a local MCP (Model Context Protocol) server over Streamable
HTTP, bound to `127.0.0.1` only, so an external Claude session can read your
journal, backlog, projects, and activities and suggest new to-dos,
activities, or projects — without ever being able to edit, finish, or delete
anything that already exists. It starts automatically with the app; see
**Settings → Claude access** for its status, URL, and a "Copy connection
info" button that copies a ready-to-run command with a fresh bearer token
filled in (the token itself is never shown or sent anywhere else — it's
generated once, encrypted with `safeStorage`, and only leaves the app on that
click).

### Claude Code

Claude Code speaks Streamable HTTP natively:

```bash
claude mcp add --transport http daily-tracker http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer <token>"
```

("Copy connection info" in Settings copies this exact command with the token
filled in — just paste it.)

### Claude Desktop

Claude Desktop's connector UI only accepts `https://` URLs proxied through
Anthropic's cloud, which can't reach `127.0.0.1`. The documented workaround
is [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), a small stdio→HTTP
bridge that runs locally alongside Claude Desktop. Add this to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "daily-tracker": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://127.0.0.1:8787/mcp",
        "--header",
        "Authorization: Bearer <token>"
      ]
    }
  }
}
```

`mcp-remote` is a third-party tool outside this repo's control — worth
hand-verifying against its current README if the connection doesn't come up.

## Known limitations

- **Prayer-time location is hardcoded** to Richmond, VA
  ([src/shared/defaults.ts](src/shared/defaults.ts)) with no Settings UI to
  change it yet. If you're elsewhere, edit the latitude/longitude there, or
  ignore that feature.
- **macOS-only in practice.** Windows and Linux build scripts exist in
  `package.json` but haven't been exercised.
- **Unsigned build** — see the Gatekeeper note above.
- **Automated tests cover `src/shared/` only** (the pure logic). Main-process
  and renderer/UI changes are verified by running the app, not by a test
  suite.

## Feedback

This started as a personal project — I'm opening it up to get outside eyes
on it. Bug reports, "this is confusing," and feature ideas are all welcome:
open an [issue](https://github.com/AymanM-Projects/daily-tracker/issues), or
send a pull request.

## License

[MIT](LICENSE)
