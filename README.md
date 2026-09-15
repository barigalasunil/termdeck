<div align="center">

# 🖥️ TermDeck

**A beautiful, terminal-based project dashboard to manage your local dev environments, servers, and coding tools.**

[![npm version](https://img.shields.io/npm/v/termdeck-cli.svg)](https://www.npmjs.com/package/termdeck-cli)
[![license](https://img.shields.io/npm/l/termdeck-cli.svg)](https://github.com/barigalasunil/termdeck/blob/main/LICENSE)

![termdeck demo](./assets/demo.gif)

</div>

---

## ✨ Features

- 🎯 **Centralized Dashboard** — View all your projects, their status (Live, Working, Experimental, Pending), and paths in one place.
- ⚡ **In-Terminal Dev Servers** — Run `npm run dev` and stream the logs directly inside the dashboard without losing your terminal context. Auto-opens the browser.
- 🚀 **One-Click External Tools** — Instantly open your project in VS Code or your preferred AI Coding Agent (like OpenCode/Cursor) in a brand new terminal window.
- ️ **Mouse & Keyboard Support** — Fully navigable with mouse clicks, Tab/Shift+Tab focus cycling, and intuitive keyboard shortcuts.
- 💾 **Persistent Config** — First-run interactive setup saves your preferences to `~/.termdeck-config.json`. No setup needed on subsequent launches.

---

## 📦 Installation

### Global Install (Recommended)

```bash
npm install -g termdeck-cli
```

This allows you to run `termdeck` from anywhere.

### One-Off Run

```bash
npx termdeck-cli
```

> **Note:** Requires Node.js 16+ and a real terminal (macOS/Linux Terminal, Windows Terminal, iTerm, etc.). No Docker, no daemon, no background service.

### Auto-Updates

On every dashboard launch termdeck silently checks the npm registry for a newer version. When one exists it installs `termdeck-cli@latest` in the background — no confirmation, no restart, nothing to do. Offline, slow or unreachable registries are ignored: you simply keep running the installed version.

Disable the check on an individual run with:

```bash
termdeck --no-update
```

### Manual Upgrade

Auto-update covers most users, but you can always upgrade by hand:

```bash
npm update -g termdeck-cli
# or, to force the very latest release:
npm install -g termdeck-cli@latest
```

### Check the Installed Version

```bash
termdeck --version
# or inspect the global install directly
npm list -g termdeck-cli
```

---

## 🗑️ Uninstall

To completely remove termdeck from your system:

```bash
npm uninstall -g termdeck-cli
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

The first launch asks a few questions and remembers the answers in `~/.termdeck-config.json`:

1. **Which directory holds your projects?** — Pick from suggestions (common folders like `~/Projects`, plus every drive letter on Windows) or type a path.
2. **Which folders are projects?** — Multi-select with <kbd>Space</kbd>, confirm with <kbd>Enter</kbd>.
3. **Status + description per folder** — `Experimental`, `Live`, `Working` or `Pending`, plus a one-line blurb.

Every later launch skips straight to the dashboard. Re-run the setup any time with `termdeck --setup` (existing answers are pre-filled as defaults).

> **Tip:** You can manually edit `~/.termdeck-config.json` if needed. Press <kbd>r</kbd> in the dashboard to reload changes.

---

## ⌨️ Usage & Controls

### Keyboard Shortcuts

| Key | Action |
| --- | --- |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Navigate projects |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Focus cycling between buttons |
| <kbd>Enter</kbd> or <kbd>Space</kbd> | Activate focused button |
| <kbd>d</kbd> | Start Dev Server for selected project |
| <kbd>e</kbd> | Open Editor (VS Code) in new terminal |
| <kbd>a</kbd> | Open Coding Agent in new terminal |
| <kbd>x</kbd> | Stop running Dev Server |
| <kbd>r</kbd> | Reload dashboard |
| <kbd>q</kbd> or <kbd>Esc</kbd> | Quit TermDeck |

> **Mouse Support:** All buttons and list items are fully clickable. Use the mouse wheel to scroll logs.

### Dashboard Preview

```
+----------------------------------------------------------------------+
| termdeck  4 projects · /home/you/Projects      ● 2 dev servers running
+------------------------+---------------------------------------------+
| projects               | selected project                            |
| ● api      [Live]      | alpha   ● Working                           |
| ● alpha    [Working]   | /home/you/Projects/alpha                    |
| ○ blog     [Pending]   | marketing site                              |
| ○ lab      [Experimental]| editor: code .   agent: opencode          |
|                        | ● dev server running (pid 8123) → localhost |
+------------------------+---------------------------------------------+
|                        | [d] Dev Server [e] Editor [a] Agent         |
|                        +---------------------------------------------+
|                        | dev server logs                             |
|                        | 12:04:11 alpha [termdeck] $npm run dev      |
|                        | 12:04:12 alpha ➜ Local: http://localhost:51 |
+------------------------+---------------------------------------------+
| ↑/↓ select  d dev  e editor  a agent  x stop  r reload  q quit       |
+----------------------------------------------------------------------+
```

---

## ❓ FAQ

**How do I disable auto-updates?**
Pass `--no-update` when you launch the dashboard: `termdeck --no-update`. The npm registry is then never contacted and nothing is printed.

**Why does termdeck check for updates on launch?**
It ensures you always have the latest features and bug fixes without ever running an upgrade command. The check is fire-and-forget: it is capped at two seconds, runs in the background, and only ever shows a single short notice when an update is actually being installed.

---

## 🛠️ Development & Contributing

### Local Testing

```bash
git clone https://github.com/barigalasunil/termdeck.git
cd termdeck
npm install
npm link        # symlink into global node_modules
termdeck        # runs from anywhere with your edits live
```

### Running Tests

```bash
npm test        # unit + end-to-end dev server tests (31/31 passing ✅)
npm run smoke   # headless TUI smoke test
```

### Testing Auto-Updates

The updater reads its registry endpoint from `TERMDECK_REGISTRY_URL`, so you can point it at a local mock. In one terminal, serve a fake registry that always claims a newer version:

```bash
node -e "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({version:'9.9.9'}))}).listen(4873)"
```

Then run termdeck with the mock enabled — you should see the "Checking for updates" banner, the dashboard footer toast, and the detached `npm install -g termdeck-cli@latest` in the background:

```bash
# macOS/Linux
TERMDECK_REGISTRY_URL=http://127.0.0.1:4873/termdeck-cli/latest termdeck

# Windows PowerShell
$env:TERMDECK_REGISTRY_URL="http://127.0.0.1:4873/termdeck-cli/latest"; termdeck
```

> The install always targets `@latest` on the **real** npm registry. Set the mock to your current version (e.g. `{"version":"1.0.3"}`) to exercise the "already up to date, no install" path, or use `--no-update` to skip the check entirely.

### Releasing a Version

```bash
npm version patch    # 1.0.3 -> 1.0.4 (bug fixes)
npm version minor    # adds backwards-compatible features
npm version major    # breaking changes
npm publish
```

Publishing a higher version is what triggers the auto-update for everyone already using termdeck.

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

[GitHub](https://github.com/barigalasunil/termdeck) · [npm](https://www.npmjs.com/package/termdeck-cli)

</div>
