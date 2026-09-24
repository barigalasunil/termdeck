# Termdeck ASCII Banner

Date: 2026-09-23

## Goal

Give termdeck a proper ASCII-art "TERMDECK" banner as the TUI header
centerpiece and at the top of `README.md`. The rest of the dashboard (panes,
chips, clock, daemon, footer, buttons, logs) is untouched.

## User decisions (brainstorming)

| Question | Choice |
| --- | --- |
| TUI placement | Replace the current ` T E R M D E C K ` green title box with the 4-line art as the masthead centerpiece |
| TUI color | Light gray `#AAAAAA` (printed foreground) |
| What about `src/index.js` | No startup banner there; CLI output and `file:` contract stay as-is |
| README placement | The art replaces the H1 line inside the top centered `<div>` |

Masthead layout approach (approved): clock + daemon status on **row 0**, the
4-line art centered on **rows 1–4**, no box/border around the art. Chip strip
moves from `top: 3` to `top: 5`. Header grows from 6 rows to 8.

## Banner art (exact, aligned)

Validated by a script: every row is exactly **63 chars** and the 8 letters sit
at the same column offset in all four rows (letter start pitch 8).

```
▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄  ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄
█▄▄ ▄▄█ █ ▄▄▄▄█ █ ▄▄▄▄█ █ ▄ ▄ █ █ ▄▄ ▀█ █ ▄▄▄▄█ █ ▄▄▄▄█ █ █▀ ▄█
  █ █   █ ▄▄▄█▄ █ ▄ ▄▄█ █ █ █ █ █ █▄▀ █ █ ▄▄▄█▄ █ █▄▄▄▄ █ ▄ ▀█▄
  █▄█   █▄▄▄▄▄█ █▄█▄▄▄█ █▄█▀█▄█ █▄▄▄▄█▀ █▄▄▄▄▄█ █▄▄▄▄▄█ █▄██▄▄█
```

Alignment note: the user-supplied art had row 2's `R` drawn 8 wide
(`█ ▄▄▄ ▄█`), pushing M D E C K one column right in that row only. The fixed
`R` row is `█ ▄▄▄▄█` (7 wide) so the whole block sits on a uniform 8-col
pitch (column offsets 0 / 8 / 16 / 24 / 32 / 40 / 48 / 56).

Width budget: 63 cols fits an 80-col terminal with margins; the README/CLI
box never needs horizontal scroll. The banner is 4 rows; header budget grows
to cover it (see below).

## `src/dashboard.js` changes

Everything below is inside `launchDashboard()`; no exports change.

- Header constants region (currently around lines 230–240):
  - `TITLE_TEXT` / the `T E R M D E C K` string and `LOGO_GREEN` title box are
    replaced by `BANNER` (the 4-line art above).
  - `HEADER_ROWS` 6 → 8.
  - `CHIP_STRIP_TOP` 3 → 5.
- `LAYOUT.headerHeight` (line 45) 6 → 8 (mirrors `HEADER_ROWS`; the
  auto-updater / "set header height" path reads it).
- Masthead (currently `height: 3`, line ~248):
  - becomes the 5-row band: `height: 5`.
  - `clockLabel` moves `top: 1` → `top: 0`.
  - `daemonLabel` moves `top: 1` → `top: 0`.
  - the `titleBox` (green bordered box, lines ~268–280) is replaced by a
    borderless, centered `blessed.box`:
    - `parent: masthead`, `top: 1`, `height: 4`, `width: '100%'`,
      `align: 'center'`, `tags: true`
    - `content: BANNER`
    - `style: { fg: '#AAAAAA', bg: THEME.bg }` (no border, no bold)
- `chipStrip` `top: CHIP_STRIP_TOP` already derives from the constant (line ~296)
  → moves to 5 automatically. Internal rows unchanged.
- `bodyTop = HEADER_ROWS` (line ~335) → 8; `bodyHeight` line ~337 recomputes
  automatically, so every pane below the header (project list, card, actions,
  output, footer) keeps its current relative sizing. At 80×24 the body drops
  from 16 → 14 rows; the existing `large = bodyHeight >= 29` branch keeps
  compact mode, so the 5×1 chip-button grid still fits (actionsHeight 8).
- `updateHeader()` (lines ~562–581): no change — it writes clock/daemon/chips/
  search, none of which touch the banner. The per-second clock tick therefore
  never redraws the art.
- File-top ASCII diagram comment (lines 9–24): update the masthead sketch to
  the 5-row band (clock · daemon on row 0, art rows 1–4, chips at 5).
- `widgets.header` / `widgets.title` in the returned controller (line ~1360)
  continue to point at the new art box (it replaces `titleBox`), so the
  auto-updater and smoke test's widget contract is unchanged.

### `LAYOUT.headerHeight` caveat

HEADER_ROWS is the layout's actual row budget; `LAYOUT.headerHeight` is a
descriptive mirror consumed by the auto-updater's "header size changed?"
check plus any callers that read `LAYOUT`. Keeping both at 8 prevents the
updater from thinking the header shrank.

## `README.md` changes

In the top centered `<div>` (lines ~1–12): the current H1
`# 🖥️ termdeck — Terminal Project Control Dashboard` is replaced by the art
inside a fenced `text` code block so GitHub preserves spacing:

````text
```
▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄  ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄
█▄▄ ▄▄█ █ ▄▄▄▄█ █ ▄▄▄▄█ █ ▄ ▄ █ █ ▄▄ ▀█ █ ▄▄▄▄█ █ ▄▄▄▄█ █ █▀ ▄█
  █ █   █ ▄▄▄█▄ █ ▄ ▄▄█ █ █ █ █ █ █▄▀ █ █ ▄▄▄█▄ █ █▄▄▄▄ █ ▄ ▀█▄
  █▄█   █▄▄▄▄▄█ █▄█▄▄▄█ █▄█▀█▄█ █▄▄▄▄█▀ █▄▄▄▄▄█ █▄▄▄▄▄█ █▄██▄▄█
```
````

The tagline, badges, and everything below the `<div>` stay unchanged.

## Out of scope / no-ops

- `src/index.js` — untouched (no banner, no header-height coupling).
- Tests: `test/run.js` and `test/smoke.js` do not assert on `TITLE_TEXT`,
  `widgets.header/title` content, `HEADER_ROWS`, or `LAYOUT.headerHeight`
  (verified by grep), so no test edits are expected.
- Palette / theme keys: no new colors — the banner uses literal `#AAAAAA`.

## Verification (must pass before completion)

1. `npm test` — full suite stays green.
2. `npm run smoke` — headless dashboard contract stays green (widgets header/
   title still resolve, project list / card / buttons intact).
3. Launch `npm run demo` manually on an 80×24 terminal: banner renders on all
   4 rows, clock/daemon on row 0, chips/search at row 5, no clipping, body
   panes still visible.