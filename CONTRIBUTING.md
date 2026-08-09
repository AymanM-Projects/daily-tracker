# Contributing

This is a small personal project, so keep it simple:

- **Bugs and ideas** — open an issue. Screenshots or a short recording help
  a lot for anything visual.
- **Pull requests** — welcome. Before opening one:
  - `npm run typecheck && npm run lint && npm test` should all pass.
  - If you touched `src/shared/`, add or update a test there — it's the one
    part of the codebase with real coverage.
  - If you touched the UI or main process, actually run the app and try the
    change (`npm run dev`) — there's no automated coverage for those yet.
  - Keep PRs focused on one change; it's easier to review and merge.
- **[CLAUDE.md](CLAUDE.md)** documents the architecture and the non-obvious
  gotchas in detail — worth a skim before a non-trivial change, whether
  you're using an AI coding assistant or not.

No CLA, no formal process — just be reasonable and it'll get merged quickly.
