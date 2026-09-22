# Termdeck UI Overhaul (Stitch Mockup)

Date: 2026-09-22

## Goal

Replace the current plain termdeck TUI with a professional, boxed terminal
dashboard matching the Stitch mockup: four bordered panes with in-box headers,
a two-row masthead with status chips, real bordered action buttons, a
right-side multi-pane layout, a two-row status bar, and a Catppuccin-Mocha
inspired palette — while keeping all existing functionality and every test
green.

## Scope

The entire change is a visual restructure of `src/dashboard.js`. The controller
contract the codebase depends on is preserved unchanged:

- `widgets.projectList` (a `blessed.list`), `widgets.card`,
  `widgets.logBox`, `widgets.footer`, `widgets.buttons.*`
- `logView`, `servers`, `runStates`, `gitInfo`, `processStats`,
  `filteredProjects`, `updateStatus`, `actions.*`
- exports `LAYOUT`, `HINTS`, `SAMPLE_LOG_LINES`
- `src/logView.js`, `src/util.js`, all managers: untouched

Headless test contract (test/smoke.js) that must keep passing:

- `projectList.items.length === 2`; `ritems[0]` contains `fake-app` and the
  live dot markup `{#a6e3a1-fg}●{/#a6e3a1-fg}`
- `card.getContent()` contains `fake-app`, `LIVE`, `●`, and the description
- `buttons.dev` has screen coordinates (`lpos`), text `Run dev server`, is
  clickable via a synthetic mouse press, and is reached by one `tab` from the
  focused list; pressing space on it hands focus back to the list
- `logView.lines` contain `[termdeck]` and raw child output (e.g. `VITE`)
- `actions.stopDevServer()` returns `true`

## Layout budget

Fixed rows: header 6 (two 3-row strips) + footer 2 = 8.
`body = screen.rows - 8`. At 80x24 → body 16; at 133x37 → body 29.

Right column split by an adaptive threshold:

```js
const large = body >= 29;                       // matches the 133x37 reference
actionsHeight = large ? 18 : 8;                 // border2+header1 + grid (5x3 or 5x1)
outputHeight = clamp(body - actionsHeight - 8, 3, large ? 6 : 4);
detailsHeight = body - actionsHeight - outputHeight;
```

- Large mode: bordered buttons, 5 rows × 3 cells.
- Compact mode (80x24): the same 2-col × 5-row grid collapses to 1-line
  chip buttons; DETAILS scrolls; OUTPUT keeps ≥ 2 visible lines.

## Header

### Strip 1 (3 rows)

- 24-hour clock `15:14:19` far left (local helper; log timestamps stay 12-h).
- ` T E R M D E C K ` in a small green-bordered box, centered.
- DAEMON indicator far right: green `● DAEMON ON` while any dev server is
  running, dim `○ DAEMON OFF` otherwise. Refreshed with `refreshList`.

### Strip 2 (3 rows)

- Bordered chip boxes: `[ALL 17] [LIVE 5] [EXP 9] [PEND 3]`, plus conditional
  `[UNKNOWN n]` / `[SCRAP n]` when their live counts are non-zero (matches
  current behavior). Active chip: blue background, bold white text. Driven by
  the existing status.chip filter and `1-6` keys.
- Right: bordered search box `/search (regex)`, live-typing
  `/search (regex): ^AI`.

## Panes

All panes keep a `{ type: 'line', fg: '#45475a' }` border. Header bars render
on the top border row: `setLabel()` for the left text plus a floating
right-aligned over-border Text child for the right text (the same technique
blessed uses for its own labels) — a zero-row-cost "header bar inside the box".

- **Projects** (the `blessed.list` itself): label `PROJECTS (17)`, right
  header `SORT: RECENT`. Rows: colored `●` + name + right-aligned time-ago,
  padded to the full item width so the blue selection (`#3b82f6`/white) spans
  the pane. Dot coloring unchanged (`live` green, `exp` yellow, `pend` blue,
  unknown/scrap gray; running → green dot).
- **Details** (scrollable card): label `DETAILS: <name>`, right header
  `GIT: CLEAN` (green) / `GIT: DIRTY` (red). Content:
  - dot + bold project name
  - description (dim)
  - status chip `[EXP] EXPERIMENTAL` in the status color
  - 2-col rows: Path / Branch / Package mgr / Stack / Mem/CPU / Last commit
  - branch dirty: `master {green}+32{/green} {red}-0{/red}` (reversed to spec)
  - stack normalized `-` → `, ` so it reads `Next.js, TypeScript, Tailwind`
  - dev-server state line (unchanged)
- **Actions**: label `ACTIONS - r/e/c/x/o/f/k/s or [Enter]`, right header
  `KEYMAP: VIM/CLI`. Holds the button grid.
- **Output**: `contrib.log` keeps its border and its LogView-managed label; the
  left label is `OUTPUT (dev server / agents) autoscroll [ON]` and the right
  header is `BUFFER: 1024L {green}STREAM ACTIVE{/green}`. LogView paused state
  continues to rewrite the left label.

## Input log formatting

System lines get a colored source tag, `3:45:43 PM [termdeck] <line>`:

- `[termdeck]` → cyan; existing inline tags are recolored per source:
  `[git]` → green, agent tags (`[claude]`, etc.) → yellow
- generic system lines without a leading tag get a cyan `[termdeck]` prefix
- boot line reworded: `termdeck ready - N projects discovered from <root>`
- child stdout/stderr keep the per-project colored tag + `✗` marker (existing
  behavior preserved)

Palette additions only (no util.js changes needed):
`tagCyan '#94e2d5'`, `tagRed '#f38ba8'`.

## Buttons (adaptive)

`blessed.button`, all inside the Actions pane, 2-col × 5-row grid shared by
both modes.

- Content: `[r] Run dev server`, `[e] Open in editor`, agent labels via
  `AGENT_LABELS`, `[s] Change status`, `[g] Git commit & push ▸ git`.
- Large: per-button line border `#45475a`, bg `#2d2d3f`, white fg, padding
  `{ left: 1, right: 1 }`, focus/hover `#3b82f6`/white, `shrink: true`,
  grid of 5 rows × 3 cells.
- Compact: same buttons, border removed, height 1, bg `#2d2d3f`, focus
  `#3b82f6` — still real blessed buttons (mouse + tab focus, same handlers).
- Creation order unchanged (dev first) so one `tab` from the list still lands
  on `buttons.dev`.

## Footer (2 rows)

- Row 1 (thin, dark): ` SHOWING <filtered> OF <total> ` left,
  `PRESS [/] FILTER` centered (padded manually).
- Row 2 (solid `#3b82f6`, white text):
  `[1/17] SELECTED  FILTER: ALL  ↑↓ navigate  tab pane  s status  / search  r dev  shift+x stop  q quit  PANE: [PROJECTS] | 133x37`
  Hints trimmed when the terminal narrows. `setStatus()` toasts replace row 2
  for ~6 s, then `updateFooter()` restores it.

## Palette (Catppuccin Mocha inspired)

`bg #1e1e2e`, pane `surface #181825`, borders `#45475a`, text `#cdd6f4`,
dim `#9399b2`, focus/selected `#3b82f6`, live `#a6e3a1`, exp `#f9e2af`,
pend `#89b4fa`, unknown/scrap `#6c7086`, red `#f38ba8`. New button bg
`#2d2d3f`.

## Testing

- `npm test` (currently 77/77) and `npm run smoke` must both pass after the
  rewrite; run both before completion.