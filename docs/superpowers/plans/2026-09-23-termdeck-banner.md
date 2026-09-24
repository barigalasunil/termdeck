# Termdeck ASCII Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small ` T E R M D E C K ` green title box and the README H1 with the 4-line `#AAAAAA` ASCII "TERMDECK" banner.

**Architecture:** A `BANNER` constant (4 lines, 63 cols, validated per-letter pitch 0/8/16/24/32/40/48/56) becomes the dashboard's masthead centerpiece: clock + daemon move to masthead row 0, the banner renders centered on rows 1–4, and the chips strip moves from `top: 3` to `top: 5`. `README.md` swaps its H1 for the same art in a `text`-fenced block. All widget/exports contracts are preserved.

**Tech Stack:** Node.js, `blessed` (dashboard), no new dependencies.

## Global Constraints

- Keep the controller contract: `widgets.header` / `widgets.title` must still point at the banner box; `statsBar` stays the chips strip.
- `module.exports = { launchDashboard, LAYOUT, HINTS, SAMPLE_LOG_LINES }` must not change shape.
- No changes to `src/index.js`.
- Banner foreground color is exactly `#AAAAAA`; no new palette keys.
- Banner must be the exact (alignment-fixed) block below — all four rows 63 chars, letters at column offsets 0/8/16/24/32/40/48/56.
- `npm test` and `npm run smoke` are the verification gates and must pass after the work.
- Demo launch for manual check: `node src/index.js --demo`.

---

### Task 1: Dashboard banner + header geometry

**Files:**
- Modify: `src/dashboard.js:45` (`LAYOUT.headerHeight` 6 → 8)
- Modify: `src/dashboard.js:9-31` (top ASCII layout comment)
- Modify: `src/dashboard.js:230-280` (header constants + masthead widgets)
- Test: `test/run.js` (new `LAYOUT` assertion)
- Test: `test/smoke.js` (header/title widget assertion)

**Interfaces:**
- Consumes: existing `THEME.bg`/`THEME.textDim`/`STATUS_FG.live`, `h24Time()`, `updateHeader()`.
- Produces: `widgets.header === widgets.title === <banner box>` (same contract as before, new content).

- [ ] **Step 1: Write the failing header-geometry test**

In `test/run.js`, insert this test immediately **before** the `/* runner */` section at line ~1217:

```js
test('LAYOUT mirrors the 8-row banner header', () => {
  const { LAYOUT } = require('../src/dashboard');
  assert.strictEqual(LAYOUT.headerHeight, 8, 'headerHeight');
  assert.strictEqual(LAYOUT.footerHeight, 2, 'footerHeight unchanged');
});
```

The runner (`async function run()` at the end) collects every `test()` registered before it and reports failures via `process.exitCode = 1`, so no other wiring is needed. The test only uses `assert` (already required at the top).

- [ ] **Step 2: Run the new test to verify it fails**

Run: `node test/run.js`
Expected: FAIL — `headerHeight` is 6, asserted 8. (Assertion message `headerHeight` printed; suite reports a failing test.)

- [ ] **Step 3: Update the layout constant**

In `src/dashboard.js:45`, change:

```js
const LAYOUT = { rows: 12, cols: 12, headerHeight: 6, footerHeight: 2 };
```

to:

```js
const LAYOUT = { rows: 12, cols: 12, headerHeight: 8, footerHeight: 2 };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/run.js`
Expected: PASS (new `LAYOUT` test plus all pre-existing tests still green; full suite currently 77/77).

- [ ] **Step 5: Replace the header constants + masthead widgets**

In `src/dashboard.js`, replace the block from the `TITLE_TEXT` constant through the `daemonLabel` construction — currently:

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
```

with:

```js
  // Two-strip header: a 5-row masthead (row 0 clock + daemon, rows 1-4 the
  // centered ASCII banner) above a 3-row chips strip. updateHeader() is the
  // only renderer that mutates the dynamic parts.
  const BANNER = [
    '\u2584\u2584\u2584\u2584\u2584\u2584\u2584 \u2584\u2584\u2584\u2584\u2584\u2584\u2584 \u2584\u2584\u2584\u2584\u2584\u2584\u2584 \u2584\u2584\u2584\u2584\u2584\u2584\u2584 \u2584\u2584\u2584\u2584\u2584\u2584  \u2584\u2584\u2584\u2584\u2584\u2584\u2584 \u2584\u2584\u2584\u2584\u2584\u2584\u2584 \u2584\u2584\u2584\u2584\u2584\u2584\u2584',
    '\u2588\u2584\u2584 \u2584\u2584\u2588 \u2588 \u2584\u2584\u2584\u2584\u2588 \u2588 \u2584\u2584\u2584\u2584\u2588 \u2588 \u2584 \u2584 \u2588 \u2588 \u2584\u2584 \u2580\u2588 \u2588 \u2584\u2584\u2584\u2584\u2588 \u2588 \u2584\u2584\u2584\u2584\u2588 \u2588 \u2588\u2580 \u2584\u2588',
    '  \u2588 \u2588   \u2588 \u2584\u2584\u2584\u2588\u2584 \u2588 \u2584 \u2584\u2584\u2588 \u2588 \u2588 \u2588 \u2588 \u2588 \u2588\u2584\u2580 \u2588 \u2588 \u2584\u2584\u2584\u2588\u2584 \u2588 \u2588\u2584\u2584\u2584\u2584 \u2588 \u2584 \u2580\u2588\u2584',
    '  \u2588\u2584\u2588   \u2588\u2584\u2584\u2584\u2584\u2584\u2588 \u2588\u2584\u2588\u2584\u2584\u2584\u2588 \u2588\u2584\u2588\u2580\u2588\u2584\u2588 \u2588\u2584\u2584\u2584\u2584\u2588\u2580 \u2588\u2584\u2584\u2584\u2584\u2584\u2588 \u2588\u2584\u2584\u2584\u2584\u2584\u2588 \u2588\u2584\u2588\u2588\u2584\u2584\u2588',
  ].join('\n');
  const BANNER_FG = '#AAAAAA';
  const HEADER_ROWS = 8;
  const CHIP_STRIP_TOP = 5;
  const CHIP_ORDER = ['all', 'live', 'exp', 'pend', 'unknown', 'scrap'];
  const CHIP_LABELS = { all: 'ALL', live: 'LIVE', exp: 'EXP', pend: 'PEND', unknown: 'UNKNOWN', scrap: 'SCRAP' };
  const CHIP_WIDTHS = { all: 8, live: 8, exp: 8, pend: 8, unknown: 12, scrap: 11 };
  const CHIP_COLORS = { live: STATUS_FG.live, exp: STATUS_FG.exp, pend: STATUS_FG.pend, unknown: STATUS_FG.unknown, scrap: STATUS_FG.scrap };
```

Then replace the masthead widget construction — currently:

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
```

with:

```js
  const masthead = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 5,
    tags: true,
    style: { bg: THEME.bg, fg: THEME.text },
  });

  const clockLabel = blessed.text({
    parent: masthead,
    top: 0,
    left: 1,
    height: 1,
    tags: true,
    content: '',
    style: { fg: THEME.textDim, bg: THEME.bg },
  });

  const titleBox = blessed.box({
    parent: masthead,
    top: 1,
    left: 0,
    width: '100%',
    height: 4,
    tags: true,
    align: 'center',
    valign: 'top',
    content: BANNER,
    style: { fg: BANNER_FG, bg: THEME.bg },
  });

  const daemonLabel = blessed.text({
    parent: masthead,
    top: 0,
    right: 1,
    height: 1,
    tags: true,
    content: '',
    style: { bg: THEME.bg },
  });
```

(`titleBox` keeps its name so line 1360 `widgets: { header: titleBox, ... }` is untouched.)

- [ ] **Step 6: Update the file-top layout comment**

In `src/dashboard.js`, replace the header part of the diagram comment (currently lines 10-13):

```js
 *   | 15:14:19        +------------+          ● DAEMON ON               |
 *   |                 | TERMDECK   |                                    |
 *   |                 +------------+                                    |
 *   | [ALL 14] [LIVE 6] [EXP 4] …               /search (regex) [box]   |
```

with:

```js
 *   | 15:14:19                                          ● DAEMON ON      |
 *   |                (4-line ASCII TERMDECK banner, centered            |
 *   |                 columns 0-62, rows 1-4 of the 5-row masthead)      |
 *   |                                                                    |
 *   | [ALL 14] [LIVE 6] [EXP 4] …               /search (regex) [box]   |
```

- [ ] **Step 7: Verify the banner is truly 63 cols wide on every row**

Run this exact command (extracts the `BANNER` array from the source and prints each decoded row's character length):

```
node -e "const fs=require('fs');const src=fs.readFileSync('src/dashboard.js','utf8');const m=src.match(/const BANNER = \[([\s\S]*?)\]\.join\('\n'\);/);if(!m)throw new Error('BANNER not found');const rows=eval('['+m[1]+']');rows.forEach((l,i)=>console.log('L'+(i+1)+' width='+[...l].length));"
```

Expected output:

```
L1 width=63
L2 width=63
L3 width=63
L4 width=63
```

- [ ] **Step 8: Add the header/title smoke assertion**

In `test/smoke.js`, after the existing block:

```js
    assert.strictEqual(widgets.projectList.items.length, 2, 'two project rows');
```

add:

```js
    assert.ok(widgets.header, 'header widget exists');
    assert.strictEqual(widgets.title, widgets.header, 'title aliases the header (banner box)');
    const bannerText = widgets.header.getContent();
    assert.ok(bannerText.includes('\u2584\u2584\u2584\u2584\u2584\u2584\u2584'), 'banner top row present in header');
    assert.strictEqual([...bannerText.split('\n')[0]].length, 63, 'banner row 0 is 63 cols');
```

- [ ] **Step 9: Run the smoke test**

Run: `npm run smoke`
Expected: PASS — the banner renders inside `widgets.header`, row 0 is 63 cols, and every pre-existing smoke assertion (project rows, card, dev-button click, log streaming, stop) stays green.

- [ ] **Step 10: Run the full unit suite**

Run: `npm test`
Expected: PASS (all tests, now including the new `LAYOUT` test).

- [ ] **Step 11: Commit**

```bash
git add src/dashboard.js test/run.js test/smoke.js
git commit -m "feat: ASCII TERMDECK banner masthead"
```

---

### Task 2: README banner

**Files:**
- Modify: `README.md:3`

**Interfaces:**
- Produces: the README title block showing the identical 4-line art in a `text`-fenced code block inside the existing centered `<div>`; tagline/badges below unchanged.

- [ ] **Step 1: Replace the README H1**

In `README.md`, the top `<div align="center">` currently contains (line 3):

```markdown
# 🖥️ termdeck — Terminal Project Control Dashboard
```

Replace that H1 line with the banner in a `text` fence (keep the blank lines around it; tagline on line 5 and badges below stay untouched):

```markdown
```
▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄  ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄ ▄▄▄▄▄▄▄
█▄▄ ▄▄█ █ ▄▄▄▄█ █ ▄▄▄▄█ █ ▄ ▄ █ █ ▄▄ ▀█ █ ▄▄▄▄█ █ ▄▄▄▄█ █ █▀ ▄█
  █ █   █ ▄▄▄█▄ █ ▄ ▄▄█ █ █ █ █ █ █▄▀ █ █ ▄▄▄█▄ █ █▄▄▄▄ █ ▄ ▀█▄
  █▄█   █▄▄▄▄▄█ █▄█▄▄▄█ █▄█▀█▄█ █▄▄▄▄█▀ █▄▄▄▄▄█ █▄▄▄▄▄█ █▄██▄▄█
```
```

The literal text is: fence open `` ``` `` on its own line, the 4 art lines, fence close `` ``` ``: exactly the same Unicode block characters as `BANNER` in `src/dashboard.js` (NOT the `\u`-escaped form).

- [ ] **Step 2: Verify the README block is byte-identical to the dashboard banner**

Run this exact command (decodes the `BANNER` array from `src/dashboard.js`, pulls the README fence body, and compares row-by-row):

```
node -e "const fs=require('fs');const dash=fs.readFileSync('src/dashboard.js','utf8');const m=dash.match(/const BANNER = \[([\s\S]*?)\]\.join\('\n'\);/);const banner=eval('['+m[1]+']');const readme=fs.readFileSync('README.md','utf8');const fence=/```text?\n([\s\S]*?)```/.exec(readme);if(!fence)throw new Error('fence not found');const art=fence[1].split('\n').slice(0,4).map(l=>l.endsWith('\r')?l.slice(0,-1):l);art.forEach((l,i)=>{if(l!==banner[i])throw new Error('row '+(i+1)+' differs:\nREADME: ['+l+']\nDASH  : ['+banner[i]+']');console.log('README row '+(i+1)+' matches');});"
```

Expected output:

```
README row 1 matches
README row 2 matches
README row 3 matches
README row 4 matches
```

(If the command fails on the fence regex, your editor normalized the fence or trailing whitespace — rerun after re-pasting the exact fence from Step 1.)

- [ ] **Step 3: Run the unit suite (README does not affect code, safety check)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: ASCII TERMDECK banner title"
```

---

### Task 3: Final verification

**Files:** none (read-only checks).

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Run the headless smoke test**

Run: `npm run smoke`
Expected: PASS (`smoke test passed: dashboard rendered, CTAs wired, logs streamed, server stopped`).

- [ ] **Step 3: Manual demo at 80×24**

Run: `node src/index.js --demo` in an 80×24 terminal.

Expected:
- Row 0: `15:14:19` top-left, `DAEMON OFF` top-right.
- Rows 1–4: the 63-col banner centered, light gray `#AAAAAA`.
- Row 5: the bordered chips strip `[ALL 14] [LIVE 6] …` and the search box.
- Body panes (PROJECTS / DETAILS / ACTIONS / OUTPUT) and footer render below with no clipping.
- Quit with `q`.

- [ ] **Step 4: Confirm git status is clean**

Run: `git status --short`
Expected: no uncommitted changes (`docs/superpowers/plans/2026-09-23-termdeck-banner.md` may be untracked — if superpowers planned/docs live under a tracked dir, commit the plan too per repo convention).

```bash
git add docs/superpowers/plans/2026-09-23-termdeck-banner.md
git commit -m "docs: termdeck banner implementation plan"
```

---

## Self-Review

**Spec coverage:**

- Dashboard masthead: BANNER centerpiece, clock/daemon row 0, borderless art box, `#AAAAAA` → Task 1 Steps 5, 8.
- Header grows 6→8 rows: `HEADER_ROWS = 8`, `CHIP_STRIP_TOP = 5`, `masthead height 5`, `LAYOUT.headerHeight = 8` → Task 1 Steps 3, 5.
- Controller contract preserved: `titleBox` keeps its name → `widgets.header/title` untouched (Task 1 Step 5 note); smoke asserts the alias (Step 8).
- README: art replaces H1, `text` fence, inside centered `<div>` → Task 2 Step 1.
- `src/index.js`: untouched ✓.
- No new palette keys, no border on art, tests unchanged in behavior ✓.
- `npm test` + `npm run smoke` gates → Task 1 Steps 4/9/10, Task 2 Step 3, Task 3 Steps 1-2.

**Placeholder scan:** every code step contains exact replacement text and runnable commands with expected output; no TBDs.

**Type/property consistency:** `BANNER`, `BANNER_FG`, `HEADER_ROWS`, `CHIP_STRIP_TOP` names match between Step 5 definitions and Step 7 checks; `widgets.header === widgets.title` matches the controller line and the smoke assertion; `LAYOUT.headerHeight` asserted as 8 in the test and set to 8 in Step 3.