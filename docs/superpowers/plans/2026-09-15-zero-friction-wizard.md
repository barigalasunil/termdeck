# Zero-Friction Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the setup wizard ask only each project's status; silently auto-detect the port and package manager.

**Architecture:** Two independent changes in `src/config.js`: a new pure `detectPort(dir)` helper plus a rewrite of `askDetails()` that drops the port/package-manager prompts and computes both values silently. `detectPackageManager()` already does the lockfile detection and is unchanged.

**Tech Stack:** Node.js >= 16, `inquirer`, the project's homegrown test runner (`npm test` via `test/run.js`, no framework).

## Global Constraints

- Runtime floor is Node.js >= 16 (see README). No newer syntax than what the codebase already uses.
- Do not change `detectPackageManager`; its existing behavior (pnpm-lock.yaml → pnpm, yarn.lock → yarn, else npm) is the spec.
- The ONLY wizard prompt per project is the status `list`. Root picker, project checkbox, and save-confirm prompts stay untouched.
- `port` and `packageManager` must still be saved per-project in the config (via `pickOverrides`/`saveConfig`), now with auto-detected values.
- Re-runs (`--scan`) overwrite existing `port`/`packageManager` with fresh auto-detected values.

---

### Task 1: Add the `detectPort` helper (TDD)

**Files:**
- Modify: `src/config.js` (add helper near `detectPackageManager` at line 317; export it in `module.exports` around line 574)
- Test: `test/run.js` (add test after the `detectPackageManager` test, line 265)

**Interfaces:**
- Produces: `detectPort(dir) -> number`. Reads `<dir>/package.json` `scripts`; returns the first valid port found from (in order) `/^(?:-p|--port)\s+(\d+)/`-style tokens, `PORT=<n>`, or a `:<4-5 digits>` token; falls back to `3000`. A valid port is an integer in 1–65535.

- [ ] **Step 1: Write the failing test**

Add to `test/run.js` directly after the `detectPackageManager` test (after line 265):

```js
test('detectPort reads a port from scripts or defaults to 3000', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'termdeck-port-'));
  const writeScripts = (scripts) => {
    fs.rmSync(path.join(root, 'package.json'), { force: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }));
  };
  try {
    assert.strictEqual(configModule.detectPort(root), 3000, 'no package.json -> 3000');
    writeScripts({ dev: 'next dev' });
    assert.strictEqual(configModule.detectPort(root), 3000, 'no port token -> 3000');
    writeScripts({ dev: 'next dev -p 3001' });
    assert.strictEqual(configModule.detectPort(root), 3001, '-p 3001');
    writeScripts({ dev: 'vite --port 5173' });
    assert.strictEqual(configModule.detectPort(root), 5173, '--port 5173');
    writeScripts({ start: 'PORT=8080 node server.js' });
    assert.strictEqual(configModule.detectPort(root), 8080, 'PORT=8080');
    writeScripts({ dev: 'next dev -p 99999' });
    assert.strictEqual(configModule.detectPort(root), 3000, 'out-of-range -> 3000');
    writeScripts({ start: 'vite preview --port 4173' });
    assert.strictEqual(configModule.detectPort(root), 4173, 'second script scanned too');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `configModule.detectPort is not a function`

- [ ] **Step 3: Write the minimal implementation**

Add to `src/config.js` immediately after `detectPackageManager` (after line 325):

```js
/**
 * Guess the dev-server port from `<dir>/package.json` scripts:
 * `-p 3001`, `--port 3001`, `PORT=3001`, or a `:5173`-style token.
 * Falls back to 3000 when nothing valid is found.
 */
function detectPort(dir) {
  const found = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const scripts = Object.values(pkg.scripts || {}).map(String);
    for (const script of scripts) {
      const m =
        script.match(/(?:-p|--port)\s+(\d+)/) ||
        script.match(/PORT=(\d+)/) ||
        script.match(/:(\d{4,5})\b/);
      if (m) found.push(Number(m[1]));
    }
  } catch (_) {
    /* missing or unreadable package.json */
  }
  const port = found.find((n) => Number.isInteger(n) && n > 0 && n < 65536);
  return port || 3000;
}
```

Add `detectPort,` to `module.exports` in `src/config.js` (next to `detectPackageManager`, line 574).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all tests including the new `detectPort` test

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/run.js
git commit -m "feat: add detectPort helper for zero-friction wizard"
```

---

### Task 2: Rewrite `askDetails` to ask only status

**Files:**
- Modify: `src/config.js:456-512` (the `askDetails` function)

**Interfaces:**
- Consumes: `detectPort(dir)` (Task 1), `detectPackageManager(dir)` (existing), `pickOverrides(prev)` (existing), `MODERN_STATUSES` (existing).
- Produces: `askDetails(selected, existing) -> Project[]` — same signature and return shape as before, but each project's `port`/`packageManager` are now auto-detected.

- [ ] **Step 1: Write the failing test**

The wizard prompt flow is not unit-tested today (it drives `inquirer` interactively), so there is no automated test for this task. The verification is that both prompts are gone and the new lockfile/port logic is wired in. Inspect the changed `askDetails` (next step) and confirm no `inquirer.prompt` call contains a `port` or `packageManager` `name`.

Run: `npm test`
Expected: PASS (existing suite unaffected)

- [ ] **Step 2: Implement the minimal change**

Replace the whole body of `askDetails` in `src/config.js` (lines 456-512) with:

```js
async function askDetails(selected, existing) {
  const previous = new Map((existing && existing.projects ? existing.projects : []).map((p) => [p.path, p]));
  const projects = [];

  for (let i = 0; i < selected.length; i += 1) {
    const projectPath = selected[i];
    const name = path.basename(projectPath);
    const prev = previous.get(projectPath) || {};
    const step = `[${i + 1}/${selected.length}]`;

    const { status } = await inquirer.prompt([
      {
        type: 'list',
        name: 'status',
        message: `${step} ${name} \u2014 what is its status?`,
        choices: MODERN_STATUSES,
        default: MODERN_STATUSES.includes(prev.status) ? prev.status : 'exp',
      },
    ]);

    projects.push({
      name,
      path: projectPath,
      // Do not lose per-project overrides from a previous config.
      ...pickOverrides(prev),
      status,
      // Zero-friction: both auto-detected, never asked.
      port: detectPort(projectPath),
      packageManager: detectPackageManager(projectPath),
    });
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
```

Note: `port`/`packageManager` are written after `...pickOverrides(prev)`, so a re-run (`--scan`) overwrites any previously saved values with fresh auto-detected ones, as the spec requires.

- [ ] **Step 3: Run the full test suite + smoke test**

Run: `npm test`
Expected: PASS

Run: `npm run smoke`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/config.js
git commit -m "feat: make setup wizard zero-friction (status only)"
```

---

### Task 3: Manual sanity check of the wizard prompt set

**Files:**
- None (read-only manual verification)

- [ ] **Step 1: Inspect the wizard code path**

Read `src/config.js` `runSetupWizard`/`askRoot`/`askProjects`/`askDetails` and confirm the only per-project prompt remaining is the status `list` (lines around 456-512). The root `list`, custom-path `input`, checkbox `selected`, no-projects `action`, and save `confirm` prompts must all be untouched.

- [ ] **Step 2: Run `npm test` and `npm run smoke` once more**

Run: `npm test; npm run smoke`
Expected: both PASS

- [ ] **Step 3: Commit any leftover changes (none expected)**

Run: `git status`
Expected: clean working tree (nothing to commit)