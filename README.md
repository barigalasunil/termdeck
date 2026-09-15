<div align="center">

# 🖥️ termdeck

**A beautiful, terminal-based project dashboard to manage your local dev environments, services, and AI coding agents.**

[![npm version](https://img.shields.io/npm/v/termdeck.svg)](https://www.npmjs.com/package/termdeck)
[![license](https://img.shields.io/npm/l/termdeck.svg)](https://github.com/barigalasunil/termdeck/blob/main/LICENSE)

```
+----------------------------------------------------------------------+
| termdeck   14 projects · ~/dev/projects     ● 2 dev servers running   |
+------------------------+---------------------------------------------+
| projects               | selected project                            |
| ● api      [live]      | alpha   ● live                              |
| ● alpha    [live]      | ~/dev/projects/alpha   main · 8a2f1 (2d ago)|
| ○ blog     [exp]       | marketing site                              |
| ○ lab      [scrap]     | ● dev server running (pid 8123) → localhost |
|                        | cpu 3.2% · mem 214MB                       |
+------------------------+---------------------------------------------+
| dev [r]  status [s]  search [/]  ...                                |
+------------------------+---------------------------------------------+
| dev server logs                                                      |
| 12:04:11 alpha [termdeck] $npm run dev                                |
| 12:04:12 alpha ➜ Local: http://localhost:5173                       |
+----------------------------------------------------------------------+
```

</div>

---

## ✨ Features

- 🎯 **Centralized Dashboard** — See every project, its status (live, exp, pend, scrap), git state (branch, last commit), current process stats, and dev server state in one place.
- ⚡ **In-Terminal Dev Servers** — Run `npm run dev` and stream the logs inside the dashboard. Auto-opens the browser. **Crash recovery** restarts a dead server up to 3 times.
- 🚀 **One-Click External Tools** — Launch your editor or an AI coding agent (claude, codex, opencode, freebuff, kilocode) in a new terminal window, with agent logs tailed back into the dashboard.
- 🔎 **Live Search & Filtering** — Type `/` to search projects by name; press `1`–`5` to filter by status chip.
- ️ **Mouse & Keyboard Support** — Fully navigable with mouse clicks, Tab/Shift+Tab focus cycling, and keyboard shortcuts.
- 💾 **Persistent, Self-Healing Config** — Interactive first-run setup saves `~/.termdeck-config.json`; the `--scan` wizard merges new projects without losing your custom agent configs.

---

## 📦 Installation

### Global Install (Recommended)

```bash
npm install -g termdeck
```

This installs the `termdeck` command anywhere.

### One-Off Run

```bash
npx termdeck
```

> **Note:** Requires Node.js 16+ and a real terminal (macOS/Linux Terminal, Windows Terminal, iTerm, etc.). No Docker, no daemon, no background service.

### Auto-Updates

On every dashboard launch termdeck silently checks the npm registry for a newer version. When one exists it installs `termdeck@latest` in the background — no confirmation, no restart. Offline, slow or unreachable registries are ignored: you simply keep running the installed version.

Disable the check on an individual run with:

```bash
termdeck --no-update
```

### Manual Upgrade

```bash
npm update -g termdeck
# or, to force the very latest release:
npm install -g termdeck@latest
```

### Check the Installed Version

```bash
termdeck --version
# or inspect the global install directly
npm list -g termdeck
```

---

## 🗑️ Uninstall

To completely remove termdeck from your system:

```bash
npm uninstall -g termdeck
```

This removes the global package and the `termdeck` command.
Your project configuration at `~/.termdeck-config.json` is preserved.
To delete the config file as well:

```bash
# macOS/Linux
rm ~/.termdeck-config.json

# Windows PowerShell
Remove-Item ~\.termdeck-config.json
```

---

## 🚀 First Run & Configuration

On first launch termdeck detects that no `~/.termdeck-config.json` exists and runs an interactive setup wizard:

1. **Which directory holds your projects?** — Pick from suggestions (common folders like `~/Projects`, `~/dev`, plus every drive letter on Windows) or type a path.
2. **Which folders are projects?** — termdeck scans the directory and shows only folders that contain a `.git` directory or a `package.json` manifest. Multi-select with <kbd>Space</kbd>, confirm with <kbd>Enter</kbd>.
3. **Per-project details** — For each project you pick, termdeck asks its status (`live`, `exp`, `pend` or `scrap`, default `exp`), the dev-server port (default `3000`) and the package manager (`npm`, `pnpm` or `yarn` — auto-detected from `pnpm-lock.yaml` / `yarn.lock`).

Every later launch skips straight to the dashboard.

> **Tip:** You can manually edit `~/.termdeck-config.json` if needed. Press <kbd>r</kbd> in the dashboard to reload.

---

## ⌨️ Usage & Controls

### CLI Flags

| Command | What it does |
| --- | --- |
| `termdeck` | Launch the dashboard using the existing config (first run starts the wizard). |
| `termdeck --demo` | Launch with 14 sample projects (great for trying it out). |
| `termdeck --scan` | Re-run the interactive scanner: adds/updates projects in the config, merging with existing entries and preserving custom agent configs. |
| `termdeck --no-auto-restart` | Disable dev-server crash recovery for this session only. |
| `termdeck --reset` | Delete the config file and force a fresh first-run setup on the next launch. |
| `termdeck --no-update` | Disable the background auto-updater. |
| `termdeck --setup` | Re-run the setup wizard manually. |
| `termdeck --list` | Print the configured projects as a table and exit (no TUI). |
| `termdeck --no-open` | Do not auto-open the browser when a dev server starts. |

### Keyboard Shortcuts

| Key | Action |
| --- | --- |
| <kbd>↑</kbd> / <kbd>↓</kbd> or <kbd>j</kbd> / <kbd>k</kbd> | Navigate projects |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Cycle focus: project list → actions → output |
| <kbd>Enter</kbd> or <kbd>Space</kbd> | Activate the focused button |
| <kbd>r</kbd> / <kbd>d</kbd> | Run `npm run dev` for the selected project |
| <kbd>e</kbd> | Open the project in your editor in a new terminal |
| <kbd>c</kbd> | Open Claude in a new terminal |
| <kbd>x</kbd> | Open Codex in a new terminal |
| <kbd>o</kbd> | Open opencode in a new terminal |
| <kbd>f</kbd> | Open freebuff in a new terminal |
| <kbd>k</kbd> | Open kilocode in a new terminal |
| <kbd>s</kbd> | Cycle the selected project's status |
| <kbd>/</kbd> | Search projects by name (Enter commits, Esc cancels) |
| <kbd>1</kbd>–<kbd>5</kbd> | Filter by status chip: all / live / exp / pend / scrap |
| <kbd>Shift</kbd>+<kbd>X</kbd> | Stop the selected project's dev server |
| <kbd>PgUp</kbd>/<kbd>PgDn</kbd>, mouse wheel | Scroll the dev server logs (<kbd>g</kbd> to follow the tail again) |
| <kbd>q</kbd> | Quit (stops every dev server it started) |

> **Mouse Support:** All buttons and list items are fully clickable. Use the mouse wheel to scroll logs.

---

## ❓ FAQ

**How do I disable auto-updates?**
Pass `--no-update` when you launch the dashboard: `termdeck --no-update`. The npm registry is then never contacted and nothing is printed.

**A dev server keeps restarting — how do I stop that?**
termdeck restarts a crashed dev server up to 3 times, then gives up and logs the failure. If you would rather not have any crash recovery for a session, launch with `termdeck --no-auto-restart`.

**Does my config get clobbered when I re-scan?**
No. `termdeck --scan` (or the setup wizard on a machine that already has a config) merges: projects you didn't touch stay exactly as they are, projects you re-select get their new status/port/package manager, and hand-written per-project overrides such as custom agent commands are kept.

---

## 🛠️ Development & Contributing

### Local Testing

```bash
git clone https://github.com/barigalasunil/termdeck.git
cd termdeck
npm install
npm link        # symlink into global node_modules
termdeck         # runs from anywhere with your edits live
```

### Running Tests

```bash
npm test        # unit + end-to-end dev server tests (64/64 passing ✅)
npm run smoke   # headless TUI smoke test
```

The smoke test drives a headless blessed screen: it verifies the dashboard renders, the dev-server CTA starts a real fixture server and streams its logs into the log pane, and that stopping the server cleans up the child process.

### Testing Auto-Updates

The updater reads its registry endpoint from `TERMDECK_REGISTRY_URL`, so you can point it at a local mock. In one terminal, serve a fake registry that always claims a newer version:

```bash
node -e "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({version:'9.9.9'}))}).listen(4873)"
```

Then run termdeck with the mock enabled:

```bash
# macOS/Linux
TERMDECK_REGISTRY_URL=http://127.0.0.1:4873/termdeck/latest termdeck

# Windows PowerShell
$env:TERMDECK_REGISTRY_URL="http://127.0.0.1:4873/termdeck/latest"; termdeck
```

> The install always targets `@latest` on the **real** npm registry. Set the mock to your current version (e.g. `{"version":"2.0.0"}`) to exercise the "already up to date, no install" path, or use `--no-update` to skip the check entirely.

### Releasing a Version

```bash
npm version patch     # 2.0.0 -> 2.0.1 (bug fixes)
npm version minor     # adds backwards-compatible features
npm version major     # breaking changes
npm publish
```

Publishing a higher version is what triggers the auto-update for everyone already running termdeck.

### Unlink When Done

```bash
npm unlink -g termdeck
```

> **Tip:** Use `TERMDECK_CONFIG=./scratch-config.json termdeck` to test without touching your real config.

---

## 📄 License

MIT

---

<div align="center">

**Built with ❤️ by [Sunil](https://github.com/barigalasunil)**

[GitHub](https://github.com/barigalasunil/termdeck) · [npm](https://www.npmjs.com/package/termdeck)

</div>