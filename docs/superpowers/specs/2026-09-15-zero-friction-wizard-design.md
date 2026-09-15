# Zero-Friction Setup Wizard

Date: 2026-09-15
Status: Approved (design)

## Problem

The first-run/interactive setup wizard asks too many questions. For each
selected project it prompts for status, dev-server port, and package manager.
The user wants a zero-friction flow: pick projects, choose only each project's
status, and let everything else be handled automatically.

## Goal

When the wizard runs it should show:

1. "Where do your projects live?" (root picker — unchanged)
2. Project multi-select checkbox (unchanged)
3. For each checked project, ONLY a status prompt: `[live, exp, pend, scrap]`,
   default `exp` (or the project's previous status when re-running).

Everything else (port, package manager) is computed silently and saved to the
config.

## Behavior

### Package manager (auto-detected, never asked)

Reuse the existing `detectPackageManager(dir)` logic:

- `pnpm-lock.yaml` present → `pnpm`
- `yarn.lock` present → `yarn`
- `package-lock.json` or no lockfile → `npm`

### Port (auto-assigned, never asked)

Default `3000`. Bonus detection: read `<project>/package.json` `scripts`, scan
each script string with three regexes (first match wins, in this order):

- `(?:-p|--port)\s+(\d+)` — e.g. `-p 3001`, `--port 3001`
- `PORT=(\d+)` — e.g. `PORT=3001`
- `:(\d{4,5})\b` — e.g. `http://localhost:5173`

For each match candidate, validate the number is an integer in 1–65535; the
first valid candidate wins. If none validates, fall back to `3000`.

### Re-runs (`--scan`) overwrite

Auto-detected `port` and `packageManager` overwrite any previously saved
values for that project. This matches the existing `mergeWizardProjects`
documentation ("status / port / packageManager take the new value").

### Config schema

Unchanged. `port` and `packageManager` continue to be persisted per-project
(they flow through `pickOverrides` → `saveConfig`), only now their values come
from auto-detection instead of user input.

## Scope

- `src/config.js`:
  - `askDetails()` — remove the port and package-manager inquirer prompts;
    only prompt status.
  - New helper `detectPort(dir)` for the optional port sniffing, exported so it
    can be unit-tested.
- No other files are expected to change.

## Testing

- `npm test` — existing unit/E2E suite must stay green.
- `npm run smoke` — headless TUI smoke test must stay green.
- Add a unit test for `detectPort` covering: no scripts → 3000, `-p 3001`,
  `--port 3001`, `PORT=3001`, invalid/out-of-range ports → 3000.
- Existing tests overwrite: wizard prompt flow is not directly unit-tested
  today, so removing prompts should not break tests.

## Non-Goals

- No change to root picker, checkbox, or save-confirm prompts.
- No change to `detectPackageManager` logic.
- No change to the dashboard, dashboard statuses, or status vocabulary.