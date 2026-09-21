<div align="center">

# 🖥️ termdeck — Terminal Project Control Dashboard

**A beautiful, multi-pane TUI dashboard for managing your local development projects.**

Auto-discovery · dev-server management · AI coding agents · real-time monitoring — all in one terminal.

[![npm version](https://img.shields.io/npm/v/termdeck-cli.svg)](https://www.npmjs.com/package/termdeck-cli)
[![license](https://img.shields.io/npm/l/termdeck-cli.svg)](https://github.com/barigalasunil/termdeck/blob/main/LICENSE)

</div>

---

## ✨ Features

- 🎯 **Auto-Discovery** — Every launch quietly re-scans your root directory and adds any new folder that contains a `.git` directory or `package.json`, as a pending project. No manual bookkeeping.
- 🧩 **3-Pane Layout** — Projects list on the left; Details + Actions (git state, port, status, agent buttons) top-right; and a live Output log pane bottom-right. Hand-positioned with zero gaps.
- ⚡ **Dev Server Management** — Run the project's dev command (`npm` / `pnpm` / `yarn run dev`) right inside the TUI, stream its logs, auto-open the browser, and **auto-restart** a crashed server up to 3 times.
- 🤖 **AI Agent Integration** — Launch 5 coding agents in a fresh terminal window — Claude Code, Codex, OpenCode, Freebuff and Kilocode — with their output tailed back into the Output pane.
- 📊 **Real-Time Monitoring** — Live PID, CPU % and memory for the selected project's running process.
- 🌿 **Git Integration** — Shows the current branch, last commit hash, and dirty state (`+X, -Y`).
- 🏷️ **Status Management** — Organize projects as **live**, **exp** (experimental), **pend**, or **scrap**.
- 🔄 **Auto-Update** — A background npm check (capped at ~2s) installs the latest version on launch. Disable with `--no-update`.
- 🔎 **Smart Filtering** — Filter by status tabs (`1`–`5`) or a regex search (`/`) over project names.
- 🕒 **12-Hour Timestamps** — Every timestamp and log line uses AM/PM with dates, e.g. `Sep 21, 2026 3:30:59 PM`.
- 💾 **Self-Healing Config** — `~/.termdeck-config.json` is auto-saved and merged on re-scan, preserving your custom per-project overrides.

---

## 📦 Installation

```bash
npm install -g termdeck-cli
```

> **Note:** the package is published as `termdeck-cli`, but the command you run is simply **`termdeck`**. Requires Node.js 16+ and a real terminal (Windows Terminal, iTerm, macOS/Linux Terminal, etc.).

---

## 🚀 Quick Start

Just run:

```bash
termdeck
```

On first launch termdeck starts an interactive setup wizard:

1. **Pick your projects directory** — it scans that folder for any subfolder containing `.git` or `package.json`.
2. **Multi-select the folders** that are real projects (<kbd>Space</kbd> to toggle, <kbd>Enter</kbd> to confirm).
3. **Set the status** for each project — `live`, `exp`, `pend`, or `scrap` (default `exp`).

The package manager (`npm` / `pnpm` / `yarn`) is **auto-detected** from the lockfiles and the default dev port is **auto-assigned** to `3000` — so status is the only thing you need to set. Every later launch skips straight to the dashboard.

---

## ⌨️ Usage

```bash
termdeck              # Launch dashboard
termdeck --scan       # Run interactive project scanner (merge new projects)
termdeck --demo       # Launch with 14 bundled sample projects
termdeck --no-update  # Disable auto-update for this session
termdeck --reset      # Delete config and start fresh
```

### Other flags

| Flag | Description |
| --- | --- |
| `--setup` | Re-run the setup wizard manually |
| `--list` | Print configured projects as a table and exit (no TUI) |
| `--no-auto-restart` | Disable dev-server crash recovery for this session |
| `--no-open` | Do not auto-open the browser when a dev server starts |

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
| --- | --- |
| <kbd>↑</kbd> / <kbd>↓</kbd> (or <kbd>j</kbd> / <kbd>k</kbd>) | Navigate projects |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Switch focus between panes (Projects → Actions → Output) |
| <kbd>Enter</kbd> / <kbd>Space</kbd> | Activate the focused button |
| <kbd>r</kbd> (or <kbd>d</kbd>) | Run the dev server |
| <kbd>e</kbd> | Open the project in VS Code |
| <kbd>c</kbd> | Launch Claude Code |
| <kbd>x</kbd> | Launch Codex |
| <kbd>o</kbd> | Launch OpenCode |
| <kbd>f</kbd> | Launch Freebuff |
| <kbd>k</kbd> | Launch Kilocode |
| <kbd>s</kbd> | Change project status |
| <kbd>/</kbd> | Focus search bar (regex) |
| <kbd>1</kbd>–<kbd>5</kbd> | Filter by status tab: all / live / exp / pend / scrap |
| <kbd>Shift</kbd>+<kbd>X</kbd> | Stop the dev server |
| <kbd>PgUp</kbd> / <kbd>PgDn</kbd>, mouse wheel | Scroll live output (<kbd>g</kbd> to follow the tail again) |
| <kbd>q</kbd> | Quit (stops every dev server it started) |

---

## 🤖 AI Agents

Each agent opens in a new terminal window inside the selected project's folder:

| Hotkey | Agent |
| --- | --- |
| <kbd>c</kbd> | Claude Code |
| <kbd>x</kbd> | Codex |
| <kbd>o</kbd> | OpenCode |
| <kbd>f</kbd> | Freebuff |
| <kbd>k</kbd> | Kilocode |

You can override any agent's command per project via the `agents` map in your config.

---

## 📸 Screenshots

<!-- TODO: Add screenshot of the dashboard -->

The UI is a **dark theme with green accents** (a green line-bordered masthead and green "live" indicators) laid out in a **3-pane layout showing projects, details, and live logs**.

---

## ⚙️ Configuration

termdeck stores everything in:

```
~/.termdeck-config.json
```

- **Auto-saves** project paths, statuses, ports, and package managers.
- **Auto-discovers** new projects on every launch — just create the folder in your root directory.
- Merges on re-scan: projects you did not touch stay exactly as they are, and hand-written overrides (custom agent/editor commands, etc.) are preserved.
- Override the location with the `TERMDECK_CONFIG` environment variable (handy for testing).

---

## ❓ FAQ

**How do I add new projects?**
termdeck auto-discovers new folders on every launch. Just create the folder in your root directory.

**How do I disable auto-updates?**
Use `termdeck --no-update`, or rely on the fact that the updater checks at most once per launch and silently skips offline/slow registries.

**Can I change the root directory?**
Yes — delete `~/.termdeck-config.json` and run `termdeck` to re-run the setup wizard.

**A dev server keeps restarting — how do I stop that?**
A crashed server is auto-restarted up to 3 times, then termdeck gives up and logs the failure. Launch with `termdeck --no-auto-restart` to disable crash recovery for a session.

---

## 🛠️ Development

```bash
git clone https://github.com/barigalasunil/termdeck.git
cd termdeck
npm install
npm link
termdeck
npm test        # run the unit + integration test suite (70 tests)
npm run smoke   # run the headless TUI integration test
```

The smoke test drives a headless blessed screen: it verifies the dashboard renders, that the dev-server action starts a real fixture server and streams its logs into the Output pane, and that stopping the server cleans up the child process.

---

## 🗑️ Uninstall

```bash
npm uninstall -g termdeck-cli
```

Your config at `~/.termdeck-config.json` is preserved; delete it manually if you want a clean slate.

---

## 📄 License

MIT License.

**Author:** Sunil ([@barigalasunil](https://github.com/barigalasunil)) · **GitHub:** <https://github.com/barigalasunil/termdeck>

---

<div align="center">

**Built with ❤️ by [Sunil](https://github.com/barigalasunil)**

[GitHub](https://github.com/barigalasunil/termdeck) · [npm](https://www.npmjs.com/package/termdeck-cli)

</div>
