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
npm test        # unit + end-to-end dev server tests (25/25 passing ✅)
npm run smoke   # headless TUI smoke test
```

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
