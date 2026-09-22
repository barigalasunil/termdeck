# Termdeck UI Overhaul (Stitch Mockup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the termdeck TUI into the boxed, Catppuccin-inspired "Stitch" dashboard described in `docs/superpowers/specs/2026-09-22-termdeck-ui-overhaul-design.md` while keeping every existing behavior and test green.

**Architecture:** All visual changes live in `src/dashboard.js` (single-file UI refactor). One tiny non-breaking export (`activeTails()`) is added to `src/agentManager.js` so the header DAEMON indicator can reflect streamed agent logs. Widget names, the controller object shape, and the blessed widget *types* (`blessed.list`, `blessed.box`, `blessed.button`, `contrib.log`) are preserved so the headless smoke test keeps exercising the real UI.

**Tech Stack:** Node.js ≥ 16, `blessed` 0.1.x, `blessed-contrib` 4.x. Headless test in `test/smoke.js`, unit suite in `test/run.js` (no framework, `node test/run.js`).

## Global Constraints

- Preserve the controller contract: `widgets.projectList` (blessed.list), `widgets.card`, `widgets.logBox`, `widgets.footer`, `widgets.buttons.*`, `widgets.statsBar`, `widgets.header`/`widgets.title`, plus `logView`, `servers`, `runStates`, `gitInfo`, `processStats`, `filteredProjects`, `updateStatus`, `actions.*` and exports `LAYOUT`, `HINTS`, `SAMPLE_LOG_LINES`.
- `npm test` must stay 77/77 *and* the new activeTails test (→ 78/78); `npm run smoke` must pass.
- Smoke-test invariants that must never regress:
  - `projectList.items.length === 2`; `ritems[0]` contains `fake-app` and exactly `{#a6e3a1-fg}●{/#a6e3a1-fg}`.
  - `card.getContent()` contains `fake-app`, `LIVE`, `●`, and the project description.
  - One `tab` from the focused list lands on `buttons.dev`; activating it returns focus to the list; the dev button has `lpos`, text `Run dev server`, and works with a synthetic mouse click at `(xi+xl)/2, yi+1`.
  - `logView.lines` contains `[termdeck]` and `VITE v5.0.0`, no raw ANSI.
- Works at 80x24: header 6 rows + footer 2 rows fixed; `body = screen.rows - 8`. Adaptive button grid: bordered 5x3 grid when `body >= 29` (reference 133x37), compact 5x1 chips otherwise.
- Palette (exact hex):
  `bg #1e1e2e`, `surface #181825`, `border #45475a`, `text #cdd6f4`, `textDim #9399b2`, `accentBg #3b82f6`, `accentFg #ffffff`, button chip bg `#2d2d3f`, live `#a6e3a1`, exp `#f9e2af`, pend `#89b4fa`, unknown/scrap `#6c7086`, red `#f38ba8`, tag cyan `#94e2d5`.
- No comments added to code unless already present in the region being edited; follow existing code style.
- Commit after every task with a concise conventional message.

---

## File Structure

- **Modify `src/agentManager.js`** — add `activeTails()` (returns number of active log tails). No other change.
- **Modify `test/run.js`** — add one unit test for `activeTails()` (agentManager section).
- **Modify `src/dashboard.js`** — the entire UI refactor. Unchanged regions: `modernStatusOf`, `statusFg`, `STATUS_FG`, `STATUS_FULL`, `AGENT_LABELS`, `PROJECT_COLORS`, `MODERN_OF`, `MODERN_STATUSES` usage, `SAMPLE_LOG_LINES`, all non-render business logic (`servers`, git modal, `runGitCommit`, `startDevServer`, `stopDevServer`, `openTool`, `cycleStatus`, `reloadConfig`, `destroy`, `quit`, git/process refresh, key bindings, filter keys, boot).
- **Untouched**: `src/logView.js`, `src/util.js`, `src/config.js`, `src/devServer.js`, `src/index.js`, `test/smoke.js`, `test/fixtures/*`.

Task dependency chain (each task leaves `npm test` + `npm run smoke` green):

```
Task 1  agentManager.activeTails() + unit test
Task 2  Header: masthead strip + chips strip + search box
Task 3  Pane geometry + right-header helper + GIT header wiring
Task 4  Footer: two rows + toast behavior + hint tiers
Task 5  Project list rows (full width, right-aligned time ago)
Task 6  DETAILS card: 2-col table, stack normalization, dirty colors
Task 7  appendLog source tags + boot line + inline tag colors
Task 8  Adaptive button grid (bordered / compact chips)
Task 9  DAEMON indicator (uses activeTails)
Task 10 Final verification + visual gate
```

---

### Task 1: `agentManager.activeTails()`

**Files:**
- Modify: `src/agentManager.js` (add a function + one export line)
- Test: `test/run.js` (agentManager section)

**Interfaces:**
- Consumes: nothing.
- Produces: `activeTails()` → `number` (size of the internal `tailing` Map). Used by Task 9.

- [ ] **Step 1: Write the failing test**

Insert after the existing `tailAgentLog creates a log file and tails it` test in `test/run.js`:

```js
test('activeTails reflects how many agent logs are being streamed', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-active-'));
  const project = { name: 'active', path: '/tmp/active', agents: {} };
  assert.strictEqual(agentManager.activeTails(), 0);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'active-claude.log'), 'line1\n');
    const stop = agentManager.tailAgentLog(project, 'claude', () => {}, { logDir: tmpDir, intervalMs: 50 });
    await sleep(200);
    assert.strictEqual(agentManager.activeTails(), 1);
    stop();
    assert.strictEqual(agentManager.activeTails(), 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/run.js`
Expected: FAIL — `agentManager.activeTails is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/agentManager.js`, add before `module.exports`:

```js
/** Number of agent log tails currently being streamed. */
function activeTails() {
  return tailing.size;
}
```

And add `activeTails,` to the `module.exports` object (keep keys alphabetized:

```js
module.exports = {
  AGENT_COMMANDS,
  activeTails,
  logDir,
  ...
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/run.js`
Expected: PASS — suite reports `78/78 tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/agentManager.js test/run.js
git commit -m "feat: expose activeTails() for the header daemon indicator"
```

---

### Task 2: Header — masthead strip + chips strip + search box

**Files:**
- Modify: `src/dashboard.js` — module header comment, `THEME`, `LAYOUT`, the widget-construction block (current lines ~45-223), and `filterChips`, `searchLabel`, `updateHeader`, `status.clock` boot wiring.

**Interfaces:**
- Consumes: existing `screen`, `projects`, `status`, `formatTimestamp` (drop), new local `h24Time`.
- Produces: `masthead` (strip box), `titleBox` (the `T E R M D E C K` green box), `clockLabel`, `daemonLabel`, `chipStrip` (exposed as `widgets.statsBar`), `chipBoxes` (array keyed by `all|live|exp|pend|unknown|scrap`), `searchBox`. `updateHeader()` now updates clock/daemon/chips/search instead of the old title text.

- [ ] **Step 1: Write the failing test**

This task is visual and has no new unit-test surface; the regression gate is that the existing suite stays green. Write nothing new here — the test for this task is `npm test` + `npm run smoke` (run in Step 4).

- [ ] **Step 2: Run the suite to confirm the baseline before editing**

Run: `npm test; npm run smoke`
Expected: `77/77` and `smoke test passed`.

- [ ] **Step 3: Implement the new header**

Update the module doc comment's layout sketch (lines 3-31) to describe the new two-strip header, then make these edits:

**(a) `THEME` (current lines 51-59) — add chip/tag colors:**

```js
const THEME = {
  bg: '#1e1e2e',        // base background (main screen + boxes)
  surface: '#181825',   // slightly darker panels (output, footer)
  text: '#cdd6f4',      // general text (light gray-white)
  textDim: '#9399b2',   // secondary text (timestamps, labels)
  border: '#45475a',    // thin, unobtrusive box borders
  accentBg: '#3b82f6',  // selected-project / focused-button highlight
  accentFg: '#ffffff',
  chipBg: '#2d2d3f',    // action-button / stat-chip background
};
```

**(b) `LAYOUT` (line 45) — footer is now two rows:**

```js
const LAYOUT = { rows: 12, cols: 12, headerHeight: 6, footerHeight: 2 };
```

**(c) Header constants near `TITLE_TEXT` region (replaces current lines 191-221):**

```js
// Two-strip header: a 3-row masthead (clock | TERMDECK box | daemon) above a
// 3-row chips strip (status chips | search box). updateHeader() is the only
// renderer that mutates these.
const TITLE_TEXT = 'T E R M D E C K';
const LOGO_GREEN = '#00ff00';
const HEADER_ROWS = 6;
const CHIP_STRIP_TOP = 3;
const CHIP_ORDER = ['all', 'live', 'exp', 'pend', 'unknown', 'scrap'];
const CHIP_LABELS = { all: 'ALL', live: 'LIVE', exp: 'EXP', pend: 'PEND', unknown: 'UNKNOWN', scrap: 'SCRAP' };
const CHIP_WIDTHS = { all: 8, live: 8, exp: 8, pend: 8, unknown: 12, scrap: 11 };
const CHIP_COLORS = { live: STATUS_FG.live, exp: STATUS_FG.exp, pend: STATUS_FG.pend, unknown: STATUS_FG.unknown, scrap: STATUS_FG.scrap };

/** `15:14:19` — 24-hour clock for the masthead (logs stay 12-hour). */
function h24Time(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}
```

**(d) Replace the `titleBox` + `statsBar` construction (current lines 200-221) with:**

```js
const masthead = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  style: { bg: THEME.bg, fg: THEME.text },
});

const clockLabel = blessed.text({
  parent: masthead,
  top: 1,
  left: 1,
  height: 1,
  tags: true,
  content: '',
  style: { fg: THEME.textDim, bg: THEME.bg },
});

const titleBox = blessed.box({
  parent: masthead,
  top: 0,
  left: 'center',
  width: TITLE_TEXT.length + 2,
  height: 3,
  tags: true,
  align: 'center',
  valign: 'middle',
  border: { type: 'line', fg: LOGO_GREEN },
  style: { fg: LOGO_GREEN, bold: true, bg: THEME.bg },
  content: TITLE_TEXT,
});

const daemonLabel = blessed.text({
  parent: masthead,
  top: 1,
  right: 1,
  height: 1,
  tags: true,
  content: '',
  style: { bg: THEME.bg },
});

// Row 2 of the header: bordered status chips at the left, bordered search box
// at the right. Chips are chunky 3-row boxes so the line border closes cleanly.
const chipStrip = blessed.box({
  parent: screen,
  top: CHIP_STRIP_TOP,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  style: { bg: THEME.bg, fg: THEME.text },
});

const searchBox = blessed.box({
  parent: chipStrip,
  top: 0,
  right: 1,
  width: Math.max(18, Math.min(26, Math.floor(screen.cols * 0.26))),
  height: 3,
  tags: true,
  align: 'center',
  valign: 'middle',
  border: { type: 'line', fg: THEME.border },
  style: { fg: THEME.textDim, bg: THEME.bg },
});

let chipCursor = 0;
const chipBoxes = CHIP_ORDER.map((key) => {
  const box = blessed.box({
    parent: chipStrip,
    top: 0,
    left: chipCursor,
    width: CHIP_WIDTHS[key],
    height: 3,
    tags: true,
    align: 'center',
    valign: 'middle',
    border: { type: 'line', fg: THEME.border },
    style: { fg: CHIP_COLORS[key] ? CHIP_COLORS[key] : THEME.text, bg: THEME.bg },
  });
  chipCursor += CHIP_WIDTHS[key] + 1;
  return box;
});
```

**(e) Replace `filterChips()` (current lines 433-449) so it returns per-key data:**

```js
function chipData() {
  const counts = modernCounts();
  const activeKey = status.chip || 'all';
  return CHIP_ORDER.map((key) => {
    const count = key === 'all' ? projects.length : counts[key] || 0;
    return { key, label: CHIP_LABELS[key], count, active: key === activeKey, hidden: key !== 'all' && count <= 0 };
  });
}
```

**(f) Replace `searchLabel()` (current lines 451-454):**

```js
function searchLabel() {
  if (searchActive) return `/search (regex): ${searchBuffer}`;
  return status.search ? `/search (regex): ${status.search}` : '/search (regex)';
}
```

**(g) Replace `updateHeader()` (current lines 456-464):**

```js
function updateHeader() {
  clockLabel.setContent(` ${h24Time()}`);
  const busy = servers.runningCount > 0;
  daemonLabel.setContent(busy
    ? `{${STATUS_FG.live}-fg}● DAEMON ON{/${STATUS_FG.live}-fg}`
    : `{${THEME.textDim}-fg}\u25cb DAEMON OFF{/${THEME.textDim}-fg}`);

  chipData().forEach((chip, index) => {
    const box = chipBoxes[index];
    if (box.hidden === chip.hidden && box.content === `${chip.label} ${chip.count}` && box.active === chip.active) return;
    box.hidden = chip.hidden;
    box.setContent(`${chip.label} ${chip.count}`);
    box.style.bg = chip.active ? THEME.accentBg : THEME.bg;
    box.style.fg = chip.active ? THEME.accentFg : (CHIP_COLORS[chip.key] || THEME.text);
    box.style.bold = chip.key === 'all';
  });

  searchBox.setContent(escapeBraces(searchLabel()));
}
```

Note: in Step 2 the chip images use the STABLE `{label} {count}` content and the bordered box supplies the brackets.

- [ ] **Step 4: Run tests to verify**

Run: `npm test; npm run smoke`
Expected: `77/77 tests passed` and `smoke test passed`. The smoke test ignores the header, so both remaining green proves nothing about the header broke.

- [ ] **Step 5: Manual visual gate (header)**

Run: `node src/index.js --demo` (real terminal, or `node src/index.js --help` is not enough — needs TTY). Confirm: row 1 shows a 24-hour clock left, a green-bordered `T E R M D E C K` box centered, daemon label right. Row 2 shows bordered chips with correct counts and a bordered search box.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: two-strip header with masthead, status chips, and search box"
```

---

### Task 3: Pane geometry + right-header helper + GIT header wiring

**Files:**
- Modify: `src/dashboard.js` — `bodyTop`/heights block (current lines 223-256), add `paneHeaderRight()` helper, attach right headers on `projectList`, `card`, `actionsShell`, `logBox`, and update `updateCard` to refresh the GIT header.

**Interfaces:**
- Consumes: `screen.rows`, `THEME`.
- Produces: `bodyHeight`, `actionsHeight`, `cardHeight`, `logHeight`, `rightHeader(parent, tags)` → blessed Text child (used on `card` as `gitHeader`). `large` boolean exported internally for Task 8.

- [ ] **Step 1: Baseline run**

Run: `npm test; npm run smoke`
Expected: green (77/77, smoke passed).

- [ ] **Step 2: Implement geometry + helper**

Replace the `bodyTop`..`logHeight` block (current lines 223-254):

```js
const bodyTop = HEADER_ROWS;                 // masthead + chips strip
const bodyHeight = Math.max(6, screen.rows - bodyTop - 2);
// Bordered buttons need 5 rows x 3 cells (15) + border(2) + label-row(0). When the
// window is too short (80x24 → body 16), the grid collapses to 1-line chips.
const large = bodyHeight >= 29;
const actionsHeight = large ? 18 : 8;        // border(2) + grid(5x3 or 5x1)
const outputHeight = Math.max(3, Math.min(large ? 6 : 4, bodyHeight - actionsHeight - (large ? 8 : 5)));
const cardHeight = Math.max(3, bodyHeight - actionsHeight - outputHeight);
const logHeight = outputHeight;
```

Add below `panel()` (current lines 182-189):

```js
/**
 * Right-aligned header text drawn on a pane's top border, using the same
 * top:-1 trick blessed uses for its own left labels. Tags are parsed, so the
 * right header can carry its own colors (e.g. green "STREAM ACTIVE").
 */
function paneHeaderRight(parent, content, fg = THEME.textDim) {
  return blessed.text({
    parent,
    top: -1,
    right: 1,
    height: 1,
    tags: true,
    content,
    style: { fg, bg: 'transparent' },
  });
}
```

Add right headers immediately after each pane is created:

```js
// after projectList + panel(...) — line ~247
panel(projectList, ' PROJECTS ');
paneHeaderRight(projectList, ' SORT: RECENT ');

// after card + panel(...) — line ~267 — keep a handle so updateCard can flip GIT state
panel(card, ' DETAILS ');
const gitHeader = paneHeaderRight(card, '{#a6e3a1-fg}GIT: CLEAN{/#a6e3a1-fg}');

// after actionsShell + panel(...) — line ~278
panel(actionsShell, ' ACTIONS - r/e/c/x/o/f/k/s or [Enter] ');
paneHeaderRight(actionsShell, ' KEYMAP: VIM/CLI ');

// after logBox + panel(...) — lines ~383
panel(logBox, ' OUTPUT (dev server / agents)  autoscroll [ON] ');
paneHeaderRight(logBox, ` BUFFER: 1024L {${STATUS_FG.live}-fg}STREAM ACTIVE{/${STATUS_FG.live}-fg} `);
```

Note: the `updateCard()` GIT flip also needs to handle the unknown-git case. Add to `updateCard()` after `card.setLabel(...)` (current line 576):

```js
const dirty = info && info.dirty;
const dirtyNow = Boolean(dirty && (dirty.added || dirty.removed));
gitHeader.setContent(dirtyNow
  ? `{#f38ba8-fg}GIT: DIRTY{/#f38ba8-fg}`
  : `{#a6e3a1-fg}GIT: CLEAN{/#a6e3a1-fg}`);
```

The existing `dirty` variable already defined earlier (line 544) still exists — reuse it rather than recomputing.

- [ ] **Step 3: Run tests to verify**

Run: `npm test; npm run smoke`
Expected: green. Smoke asserts on coordinates/`lpos` which are recomputed by blessed from the new geometry — if `buttons.dev` lpos or the click lands oddly, check `actionsHeight`/`cardHeight` math in Step 2.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: pane geometry and right-aligned header bars"
```

---

### Task 4: Two-row footer + toast behavior

**Files:**
- Modify: `src/dashboard.js` — `FOOTER_KEYS`/`HINTS` (lines 99-101), footer construction + `buildFooter`/`updateFooter`/`setStatus` (lines ~280-288, 592-644).

**Interfaces:**
- Consumes: `screen.cols`, `selectedProject`, `filteredProjects`, `currentPane`, `status`.
- Produces: `footer` = the bottom blue row (kept as `widgets.footer`), `footerMeta` = the thin dark row above it. `buildFooterRow1()` and `buildFooterRow2()`.

- [ ] **Step 1: Baseline run**

Run: `npm test; npm run smoke` — green expected.

- [ ] **Step 2: Implement**

**(a) Replace `FOOTER_KEYS`/`HINTS` (lines 99-101):**

```js
const FOOTER_KEYS =
  '{bold}\u2191\u2193{/bold} navigate  {bold}tab{/bold} pane  {bold}s{/bold} status  {bold}/{/bold} search  {bold}r{/bold} dev  {bold}shift+x{/bold} stop  {bold}q{/bold} quit';
const HINTS = ` ${FOOTER_KEYS} `;

function footerHints() {
  if (screen.cols >= 110) return FOOTER_KEYS;
  if (screen.cols >= 90) return '{bold}\u2191\u2193{/bold} navigate  {bold}s{/bold} status  {bold}r{/bold} dev  {bold}shift+x{/bold} stop  {bold}q{/bold} quit';
  return '{bold}\u2191\u2193{/bold} navigate  {bold}s{/bold} status  {bold}r{/bold} dev  {bold}q{/bold} quit';
}
```

**(b) Replace the single footer box (lines 280-288) with two rows:**

```js
const footerHeight = 2;
const footerMeta = blessed.box({
  parent: screen,
  top: bodyTop + bodyHeight,
  left: 0,
  width: '100%',
  height: 1,
  tags: true,
  style: { fg: THEME.textDim, bg: THEME.surface },
});
const footer = blessed.box({
  parent: screen,
  top: bodyTop + bodyHeight + 1,
  left: 0,
  width: '100%',
  height: 1,
  tags: true,
  style: { fg: THEME.accentFg, bg: THEME.accentBg },
});
```

**(c) Replace `buildFooter`/`updateFooter` (lines 592-604):**

```js
function buildFooterRow1() {
  const showing = ` SHOWING ${filteredProjects().length} OF ${projects.length} `;
  const press = 'PRESS [/] FILTER';
  const centerAt = Math.floor(screen.cols / 2) - Math.floor(press.length / 2);
  const pad = Math.max(0, centerAt - showing.length);
  const row = `${showing}${' '.repeat(pad)}${press}`.slice(0, screen.cols);
  return row;
}

function buildFooterRow2() {
  const sel = selectedProject();
  const index = sel ? filteredProjects().indexOf(sel) + 1 : 0;
  const paneLabel = currentPane();
  const size = `${screen.cols}x${screen.rows}`;
  const chipLabel = status.chip ? status.chip.toUpperCase() : 'ALL';
  const search = status.search ? ` /${status.search}` : '';
  const fixed = `[${index}/${filteredProjects().length}] SELECTED  FILTER: ${chipLabel}${search}`;
  const hints = ` ${footerHints()} `;
  const tail = ` PANE: [${paneLabel}] \u2502 ${size} `;
  const row = ` ${fixed}${hints}${tail}`.slice(0, screen.cols);
  return row;
}

function updateFooter() {
  footerMeta.setContent(buildFooterRow1());
  footer.setContent(buildFooterRow2());
}
```

**(d) Replace `setStatus` (lines 631-643):**

```js
function setStatus(message) {
  if (status.timer) clearTimeout(status.timer);
  status.message = message;
  footerMeta.setContent(buildFooterRow1());
  footer.setContent(` {bold}${escapeBraces(message)}{/bold}`);
  screen.render();

  status.timer = setTimeout(() => {
    status.message = null;
    updateFooter();
    screen.render();
  }, 6000);
  if (status.timer.unref) status.timer.unref();
}
```

Keep `widgets.footer` unchanged (`footer` in the returned controller).

- [ ] **Step 3: Run tests to verify**

Run: `npm test; npm run smoke`
Expected: green. The smoke test's `setStatus`-driven paths (`stopDevServer` asserting `stop was logged`) traverse `setStatus` and render without asserting content, so both stay green.

- [ ] **Step 4: Manual gate**

Run `node src/index.js --demo`, press `s` a few times, verify the toast replaces the blue row and row 1 stays put.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: two-row footer with status bar and toast behavior"
```

---

### Task 5: Project list rows — full width + right-aligned time ago

**Files:**
- Modify: `src/dashboard.js` — `listItems()` (lines 486-499) and `refreshList()` label (line 617).

**Interfaces:**
- Consumes: `filteredProjects`, `runStates`, `gitInfo`, `statusFg`, `escapeBraces`, `truncate`, `timeAgo`, `screen.cols`.
- Produces: list items where every row is padded to the full inner width so the blue selection spans the pane; the live-dot markup `{#a6e3a1-fg}●{/#a6e3a1-fg}` is preserved verbatim.

- [ ] **Step 1: Baseline run**

Run: `npm test; npm run smoke` — green expected (the current dot+name asserts must still pass after this change).

- [ ] **Step 2: Implement**

Replace `listItems()`:

```js
function listItems() {
  const inner = Math.max(12, Math.floor(screen.cols * 0.4) - 4);
  return filteredProjects().map((project) => {
    const state = runStates.get(project.path);
    const running = state && (state.status === 'running' || state.status === 'starting');
    const modern = modernStatusOf(project);
    const dotFg = running ? (state.status === 'running' ? STATUS_FG.live : STATUS_FG.exp) : statusFg(modern);
    const name = escapeBraces(truncate(project.name, Math.max(6, inner - 14)));
    const info = gitInfo.get(project.path);
    const activity = escapeBraces(String(truncate(project.lastActivity || timeAgo(info && info.lastCommitAt) || '\u2014', 10)));
    const pads = ' '.repeat(Math.max(0, inner - name.length - activity.length - 3));
    return `{${dotFg}-fg}\u25cf{/${dotFg}-fg} ${name}${pads} {${THEME.textDim}-fg}${activity}{/${THEME.textDim}-fg}`;
  });
}
```

In `refreshList()` (line 617) keep the label update but match the mockup:

```js
projectList.setLabel(` PROJECTS (${projects.length}) `);
```

- [ ] **Step 3: Run tests to verify**

Run: `npm test; npm run smoke`
Expected: green. Specifically smoke asserts `ritems[0]` includes `fake-app` and `{#a6e3a1-fg}●{/#a6e3a1-fg}` — the new padded row still contains both.

- [ ] **Step 4: Manual gate**

`node src/index.js --demo` — rows right-align their time-ago, selection is a full-width blue bar.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: full-width project rows with right-aligned activity"
```

---

### Task 6: DETAILS card — 2-column table content

**Files:**
- Modify: `src/dashboard.js` — `updateCard()` (lines 517-590).

**Interfaces:**
- Consumes: `selectedProject`, `runStates`, `gitInfo`, `processStats`, `config`, `servers.lastExit`, `getProjectStack` (with new normalization), `devStateLine`, `statusChip` logic.
- Produces: smoke-critical content still present (`fake-app`, `LIVE`, `●`, description). New helpers: `stackLabel(project)`, `col(label, value, width)`.

- [ ] **Step 1: Baseline run**

Run: `npm test; npm run smoke` — green expected.

- [ ] **Step 2: Implement**

**(a) Add helpers near `getProjectStack` (line 661):**

```js
/** Stack shown as comma-separated names, even when config used dashes. Plain
 *  audit text — the row() helper escapes it for blessed markup. */
function stackLabel(project) {
  return String(getProjectStack(project) || '\u2014').replace(/\s*-\s*/g, ', ');
}
```

**(b) Replace the `dirtyLabel` block and the `lines` array in `updateCard()`**
(current lines 544-575). The existing `const dirty = info && info.dirty ? info.dirty : { added: 0, removed: 0 };` on line 544 stays. Swap the colors to spec (green `+n`, red `-m`) — replace lines 545-547:

```js
const dirtyLabel = dirty.added
  ? ` {${STATUS_FG.live}-fg}+${dirty.added}{/${STATUS_FG.live}-fg}`
  : '';
const dirtyLabel2 = dirty.removed
  ? ` {#f38ba8-fg}-${dirty.removed}{/#f38ba8-fg}`
  : '';
```

Keep `branch`, `hash`, `msg`, `lastAt`, `commit` and `statusChip` computation exactly as-is (current lines 548-560), then **replace the `lines` array** (current lines 562-575):

```js
const inner = Math.max(24, Math.floor(screen.cols * 0.6) - 4);
// Escapes plain values for blessed markup; set `raw` for values that already
// carry blessed tags (branch colors, mem/cpu demo suffix).
const row = (label, value, raw) => {
  const v = truncate(value, Math.max(4, inner - label.length - 2));
  return ` {${THEME.textDim}-fg}${label}{/${THEME.textDim}-fg} ${raw ? v : escapeBraces(v)}`;
};
const selector = `{${STATUS_FG.live}-fg}${escapeBraces(truncate(branch, 30))}{/${STATUS_FG.live}-fg}`;

const lines = [
  ` {${sFg}-fg}\u25cf{/${sFg}-fg} {bold}${escapeBraces(truncate(project.name, 40))}{/bold}`,
  ` {${THEME.textDim}-fg}${escapeBraces(truncate(project.info || '(no description)', inner - 2))}{/${THEME.textDim}-fg}`,
  ` {${THEME.textDim}-fg}Status:{/${THEME.textDim}-fg} ${statusChip}`,
  row('Path:', displayPath(project.path, config.root)),
  row('Branch:', `${selector}${dirtyLabel}${dirtyLabel2}`, true),
  row('Package mgr:', String(project.packageManager || '\u2014')),
  row('Stack:', stackLabel(project)),
  row('Mem/CPU:', memCpu, true),
  row('Last commit:', commit),
  devStateLine(project, state),
];
```

Keep the existing `pidLabel`, `memCpu`, `commit`, `statusChip` variables. Finally keep:

```js
card.setContent(lines.join('\n'));
card.setLabel(` DETAILS: ${project.name} `);
```

(unchanged) followed by the `unknown` status-button restyle and `screen.render()` at the end of `updateCard()` (current lines 579-589 unchanged).

- [ ] **Step 3: Run tests to verify**

Run: `npm test; npm run smoke`
Expected: green. Smoke asserts `card.getContent()` includes `fake-app`, `LIVE`, `●`, `fixture dev server` — all present in the new row set.

- [ ] **Step 4: Manual gate**

`node src/index.js --demo` — the STATUS chip in yellow, the Branch `+`/`-` counts green/red, stack comma-separated.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: 2-column details table with spec colors"
```

---

### Task 7: Log source tags + boot line

**Files:**
- Modify: `src/dashboard.js` — `appendLog()` (lines 646-655) and the boot `appendLog` calls (lines 1157-1158), plus inline `[termdeck]`/`[git]`/agent tag colors in `runGitCommit`, `cycleStatus`, `openTool` (lines 801, 923, 898).

**Interfaces:**
- Consumes: `logView`, `timestamp`, `escapeBraces`, `truncate`, `colorFor`, `THEME`.
- Produces: smoke-critical `[termdeck]` presence; raw child output (`VITE`) unchanged.

- [ ] **Step 1: Baseline run**

Run: `npm test; npm run smoke` — green expected.

- [ ] **Step 2: Implement**

Replace `appendLog()`:

```js
/** Log lines from child processes are raw text -> escape blessed markup. */
function appendLog(project, line, stream = 'stdout') {
  const time = `{${THEME.textDim}-fg}${timestamp()}{/${THEME.textDim}-fg}`;
  if (stream === 'system') {
    // Give generic notes a cyan [termdeck] tag; lines that already carry their
    // own [tag] keep it.
    const visible = String(line).replace(/^(?:\{[^{}]*\})*/, '').replace(/^\s+/, '');
    const tag = visible.startsWith('[') ? '' : `{${THEME.tagCyan}-fg}[termdeck]{/${THEME.tagCyan}-fg} `;
    logView.push(`${time} ${tag}${line}`);
    return;
  }
  const fg = colorFor(project);
  const prefix = `{${THEME.textDim}-fg}${timestamp()}{/${THEME.textDim}-fg} ${escapeBraces(truncate(project.name, 10))}`;
  const marker = stream === 'stderr' ? '{#f38ba8-fg}\u2717{/#f38ba8-fg} ' : '';
  logView.push(`${prefix} ${marker}${escapeBraces(line)}`);
}
```

Note the system branch drops the old `{fg}[name]{/fg}` project prefix entirely (a generic note is `3:45:43 PM [termdeck] ...` per the mockup).

Add `tagCyan` to `THEME` (Task 2 missed it):

```js
tagCyan: '#94e2d5',
```

Recolor the inline tags (mechanical, three spots):
- `runGitCommit` line 801 and 828-831: `{#89b4fa-fg}[git]{/#89b4fa-fg}` → `{${STATUS_FG.live}-fg}[git]{/${STATUS_FG.live}-fg}` (green).
- `cycleStatus` line 923: `{#89b4fa-fg}[termdeck]{/#89b4fa-fg}` → `{${THEME.tagCyan}-fg}[termdeck]{/${THEME.tagCyan}-fg}`.
- `openTool` line 898: `{#89b4fa-fg}[${escapeBraces(kind)}]{/#89b4fa-fg}` → `{${STATUS_FG.exp}-fg}[${escapeBraces(kind)}]{/${STATUS_FG.exp}-fg}` (yellow agent tag).

Reword the boot lines (lines 1157-1158):

```js
appendLog({ name: 'termdeck', path: '__termdeck__' }, `{bold}termdeck{/bold} ready - ${projects.length} projects discovered from ${escapeBraces(displayPath(config.root, config.root))}`, 'system');
appendLog({ name: 'termdeck', path: '__termdeck__' }, `pick a project and press {bold}r{/bold} for the dev server, {bold}e{/bold} for your editor, {bold}c/x/o/f/k{/bold} for an agent.`, 'system');
```

- [ ] **Step 3: Run tests to verify**

Run: `npm test; npm run smoke`
Expected: green. Smoke asserts `[termdeck]` appears in `logView.lines` (boot line keeps it) and `VITE v5.0.0` (child stdout passthrough untouched).

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: colored log source tags and canonical boot line"
```

---

### Task 8: Adaptive button grid

**Files:**
- Modify: `src/dashboard.js` — `makeButton` (lines 295-332), `addButton`/`BUTTON_SLOTS` (lines 334-357), the nine `addButton(...)` calls (lines 359-367). Uses `large` from Task 3.

**Interfaces:**
- Consumes: `actionsShell`, `actionsHeight`, `large`, `THEME.chipBg`, button handlers `startDevServer`, `openTool`, `cycleStatus`, `openGitCommitModal`.
- Produces: `widgets.buttons.*` — real `blessed.button`s, dev first in creation order (tab focus order preserved). Bordered 5x3 grid in large mode, 1-line chips at `large === false`.

- [ ] **Step 1: Baseline run**

Run: `npm test; npm run smoke` — green expected before this task.

- [ ] **Step 2: Implement**

Replace `makeButton`:

```js
function makeButton({ content, onPress }) {
  const button = blessed.button({
    parent: actionsShell,
    top: '0%',
    left: '0%',
    width: '47%',
    height: large ? 3 : 1,
    shrink: true,
    content,
    align: 'center',
    valign: 'middle',
    tags: true,
    mouse: true,
    clickable: true,
    autoFocus: false,
    padding: large ? { left: 1, right: 1 } : {},
    border: large ? { type: 'line', fg: THEME.border } : undefined,
    style: {
      fg: THEME.text,
      bg: THEME.chipBg,
      focus: { bg: THEME.accentBg, fg: THEME.accentFg, bold: true },
      hover: { bg: THEME.accentBg, fg: THEME.accentFg, bold: true },
      border: large ? { fg: THEME.border } : undefined,
    },
  });

  button.on('press', () => {
    let handled = false;
    try {
      handled = onPress() === true;
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      if (!handled && !gitModal) {
        projectList.focus();
        screen.render();
      }
    }
  });
  return button;
}
```

Replace `addButton` (drop `BUTTON_SLOTS`, replace with shared grid math):

```js
function addButton(name, slot, content, opts) {
  const button = makeButton({ content, ...opts });
  const rowH = large ? 3 : 1;
  button.top = 1 + slot.row * rowH;
  button.height = rowH;
  button.left = slot.col === 0 ? '2%' : '51%';
  button.width = '47%';
  buttons[name] = button;
  return button;
}
```

Update the grid content strings. Keep names and handlers identical; only the content strings change to the flat `[x] Label` form (drop the `{bold}` wrapper for the bracket key when it aids the bordered look — keep it, it is harmless):

```js
addButton('dev', { row: 0, col: 0 }, `{bold}[r]{/bold} Run dev server`, { onPress: () => startDevServer() });
addButton('editor', { row: 0, col: 1 }, `{bold}[e]{/bold} Open in editor`, { onPress: () => openTool('editor') });
addButton('claude', { row: 1, col: 0 }, `{bold}[c]{/bold} ${AGENT_LABELS.claude}`, { onPress: () => openTool('claude') });
addButton('codex', { row: 1, col: 1 }, `{bold}[x]{/bold} ${AGENT_LABELS.codex}`, { onPress: () => openTool('codex') });
addButton('opencode', { row: 2, col: 0 }, `{bold}[o]{/bold} ${AGENT_LABELS.opencode}`, { onPress: () => openTool('opencode') });
addButton('freebuff', { row: 2, col: 1 }, `{bold}[f]{/bold} ${AGENT_LABELS.freebuff}`, { onPress: () => openTool('freebuff') });
addButton('kilocode', { row: 3, col: 0 }, `{bold}[k]{/bold} ${AGENT_LABELS.kilocode}`, { onPress: () => openTool('kilocode') });
addButton('status', { row: 3, col: 1 }, `{bold}[s]{/bold} Change status`, { onPress: () => cycleStatus() });
addButton('git', { row: 4, col: 0 }, `{bold}[g]{/bold} Git commit & push \u25b8 git`, { onPress: openGitCommitModal });
```

Keep `buttons.status` restyling inside `updateCard()` working (it sets `buttons.status.setContent`/`style.fg` — the bordered style in large mode still honors per-button `style.fg` overrides; in compact the same override applies).

- [ ] **Step 3: Run tests to verify**

Run: `npm test; npm run smoke`
Expected: green. The riskiest asserts:
- `buttons.dev` has `lpos` and text `Run dev server` — bounded shrink button retains both.
- synthetic click at `(xi+xl)/2, yi+1` starts the server — in large (120x40) mode `yi+1` is the bordered button's content row, press fires.
- one `tab` from the list focuses `buttons.dev` — dev is still the first button created.

If the click lands on the border instead of content (press not firing), adjust the grid offset in `addButton` so content rows sit inside the click target, or relax `button.top` by 1 in large mode.

- [ ] **Step 4: Manual gate**

`node src/index.js --demo` — bordered buttons at normal size; run the same binary in an 80x24 window and confirm the grid collapses to compact one-line buttons with blue focus.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: adaptive action buttons (bordered grid / compact chips)"
```

---

### Task 9: DAEMON indicator wiring

**Files:**
- Modify: `src/dashboard.js` — the `require('./agentManager')` line (43) and `updateHeader()` daemon branch (added in Task 2).

**Interfaces:**
- Consumes: `activeTails()` (Task 1), `servers.runningCount`.
- Produces: header daemon reflects both dev servers and streamed agent logs.

- [ ] **Step 1: Baseline run**

Run: `npm test; npm run smoke` — green expected.

- [ ] **Step 2: Implement**

Change the require (line 42):

```js
const { launchAgent, tailAgentLog, stopAllAgents, activeTails } = require('./agentManager');
```

Update `updateHeader()`:

```js
const busy = servers.runningCount > 0 || activeTails() > 0;
daemonLabel.setContent(busy
  ? `{${STATUS_FG.live}-fg}\u25cf DAEMON ON{/${STATUS_FG.live}-fg}`
  : `{${THEME.textDim}-fg}\u25cb DAEMON OFF{/${THEME.textDim}-fg}`);
```

(The current Task 2 version used only `servers.runningCount > 0`.)

- [ ] **Step 3: Run tests to verify**

Run: `npm test; npm run smoke`
Expected: green (78/78 + smoke).

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.js
git commit -m "feat: daemon indicator reflects dev servers and active agent tails"
```

---

### Task 10: Final verification + visual gate

**Files:** none.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: `78/78 tests passed`.

- [ ] **Step 2: Smoke**

Run: `npm run smoke`
Expected: `smoke test passed: dashboard rendered, CTAs wired, logs streamed, server stopped`.

- [ ] **Step 3: Lint/type sanity**

Run: `node -e "require('./src/dashboard'); require('./src/index'); console.log('modules load ok')"`
Expected: `modules load ok`.

- [ ] **Step 4: Visual gate**

Run `node src/index.js --demo` at ≥ 35 rows and at exactly 80x24. Confirm against the spec:
- two-strip header (clock / green TERMDECK / daemon; chips / search),
- four bordered panes with left+right header bars,
- buttons bordered at large, compact at 80x24, blue focus/hover,
- project rows full-width with right-aligned activity,
- details 2-col table with `[EXP] EXPERIMENTAL` yellow, green/red dirty counts, comma stack,
- `3:45:43 PM [termdeck] termdeck ready - N projects discovered from <root>`,
- two-row footer with blue bar and toast behavior.

- [ ] **Step 5: Update the README key listing only if the footer copy changed permanently**

The footer now advertises `/ search` and drops `g git` from the visible hints (git still works via keys). No README change is required unless the README hard-codes the old hint list — it does not.