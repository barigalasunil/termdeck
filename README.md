# termdeck

A terminal dashboard (TUI) for juggling your local dev projects.

One screen lists your projects with a colour-coded status and blurb, and gives
each one three actions:

| CTA | What it does |
| --- | --- |
| **Dev Server** | runs `npm run dev` **inside termdeck** — stdout/stderr stream into the scrollable log pane below (no extra terminal window), then the localhost URL is detected and opened in your default browser |
| **Editor** | opens a **brand new OS terminal window**, `cd`s into the project and runs `code .` |
| **Agent** | opens a **brand new OS terminal window**, `cd`s into the project and runs `opencode` (placeholder — configurable) |

Everything is keyboard driven *and* mouse driven: the three CTAs are clickable
buttons, the project list is click-selectable, and the mouse wheel scrolls the
logs.

```
+----------------------------------------------------------------------+
| termdeck  4 projects · /home/you/Projects      ● 2 dev servers running
+------------------------+---------------------------------------------+
| projects               | selected project                            |
| ● api      [Live]      | alpha   ● Working                           |
| ● alpha    [Working]   | /home/you/Projects/alpha                    |
| ○ blog     [Pending]   | marketing site                              |
| ○ lab      [Experiment]| editor: code .   agent: opencode            |
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

## Install

```bash
npm install -g termdeck
termdeck
```

Requires Node.js 16+ and a real terminal (macOS/Linux Terminal, Windows
Terminal, iTerm, …). No Docker, no daemon, no background service.

## First run

The first launch asks a few questions and remembers the answers in
`~/.termdeck-config.json`:

1. **Which directory holds your projects?** — pick from suggestions (common
   folders like `~/Projects`, plus every drive letter on Windows) or type a path.
2. **Which folders are projects?** — multi-select with <kbd>space</kbd>, confirm
   with <kbd>enter</kbd>.
3. **Status + description per folder** — `Experimental`, `Live`, `Working` or
   `Pending`, plus a one line blurb.

Every later launch skips straight to the dashboard. Re-run it any time with
`termdeck --setup` (existing answers are pre-filled as defaults).

## Keys

| Key | Action |
| --- | --- |
| <kbd>↑</kbd>/<kbd>↓</kbd>, <kbd>j</kbd>/<kbd>k</kbd> | select a project (or click it) |
| <kbd>d</kbd> | start the dev server for the selection (or click **Dev Server**) |
| <kbd>e</kbd> | open the editor in a new terminal window (or click **Editor**) |
| <kbd>a</kbd> | open the agent in a new terminal window (or click **Agent**) |
| <kbd>tab</kbd>, <kbd>shift</kbd>+<kbd>tab</kbd> | move keyboard focus to the buttons — a focused button lights up and answers to <kbd>space</kbd>/<kbd>enter</kbd> |
| <kbd>x</kbd> | stop the selected project's dev server |
| <kbd>r</kbd> | reload the config file from disk |
| <kbd>PgUp</kbd>/<kbd>PgDn</kbd>, wheel | scroll the log pane (pauses following, shows how many lines arrived) |
| <kbd>shift</kbd>+<kbd>G</kbd>, <kbd>end</kbd> | jump back to live logs |
| <kbd>home</kbd> | jump to the start of the log history |
| <kbd>q</kbd>, <kbd>ctrl</kbd>+<kbd>c</kbd> | quit — every dev server termdeck started is stopped first |

Quitting while dev servers are running asks for a second <kbd>q</kbd> press.

## CLI

```
termdeck                launch the dashboard (runs setup on first use)
termdeck --setup        re-run the setup wizard
termdeck --reset        delete the config file, then run setup again
termdeck --list         print the configured projects and exit (no TUI)
termdeck --no-open      never auto-open the browser
termdeck --help
termdeck --version
```

## Config file

`~/.termdeck-config.json` (override the path with the `TERMDECK_CONFIG`
environment variable):

```json
{
  "version": 1,
  "root": "/home/you/Projects",
  "devCommand": "npm run dev",
  "editorCommand": "code .",
  "agentCommand": "opencode",
  "openBrowser": true,
  "projects": [
    {
      "name": "alpha",
      "path": "/home/you/Projects/alpha",
      "status": "Working",
      "info": "marketing site with a Next.js frontend"
    }
  ]
}
```

The same keys can be set **per project** inside a `projects[]` entry
(`devCommand`, `editorCommand`, `agentCommand`, `port`), which is handy when one
repo needs `pnpm dev`, `npm start` or a fixed port. Editing the file by hand is
fine — press <kbd>r</kbd> in the dashboard to reload it.

| Field | Meaning |
| --- | --- |
| `devCommand` | command run for the Dev Server CTA (default `npm run dev`) |
| `editorCommand` | command run in the new editor terminal (default `code .`) |
| `agentCommand` | command run in the new agent terminal (default `opencode`) |
| `openBrowser` | set to `false` (or pass `--no-open`) to keep the browser closed |
| `port` | fallback port used if the dev server never prints a URL (default `3000`) |
| `status` | `Experimental` · `Live` · `Working` · `Pending` |

## How each CTA works

**Dev Server (in-app logs).** `cross-spawn` runs the dev command with `cwd` set
to the project, `stdio: ['ignore','pipe','pipe']` and `FORCE_COLOR=0`, so nothing
is attached to a terminal. Each stream is split into lines and pushed into the
blessed-contrib `log` widget in the dashboard (batched every 120 ms — dev
servers can emit hundreds of lines per second). Every line is scanned for a
localhost URL (`http://localhost:5173/`, `0.0.0.0:3000`, `listening on port
4200`, …); the first hit is normalised, and after a short delay the `open`
package launches your default browser. If no URL shows up within ~9 seconds,
termdeck assumes `http://localhost:<port || 3000>` and says so in the log pane.
Processes are spawned detached on macOS/Linux and killed as a tree
(`process.kill(-pid)` / `taskkill /T /F`), so a quit never leaves an orphaned
Vite/Next server behind.

**Editor / Agent (new terminal windows).** `cross-spawn` launches the OS
terminal:

- **macOS** — `osascript -e 'tell application "Terminal" … do script "cd … && code ."'`
- **Windows** — `wt.exe -d "<dir>" cmd /k "code ."`, falling back to
  `cmd /c start "" /D "<dir>" cmd.exe /k "code ."` when Windows Terminal is not
  installed
- **Linux** — the first emulator found on `PATH` out of `gnome-terminal`,
  `konsole`, `xfce4-terminal`, `kitty`, `alacritty`, `wezterm`,
  `x-terminal-emulator`, `xterm` (each gets `--working-directory`/`-e` with
  `bash -lc` and `exec bash` so the window stays open)

On Linux you can force a specific emulator with the `TERMDECK_TERMINAL`
environment variable.

## Linking locally (test before publishing)

From the project folder:

```bash
npm install          # install dependencies
npm test             # unit + end-to-end dev server tests (no TUI needed)
npm run smoke        # headless TUI smoke test: renders the dashboard, clicks a CTA

npm link             # symlinks this package into your global node_modules
termdeck             # now runs from anywhere with your edits live

# when you are done
npm unlink -g termdeck
```

`npm link` creates a global `termdeck` shim that points at this directory, so
code changes take effect immediately — no republishing. If you would rather not
touch the global install, these work too:

```bash
npm install -g .             # real global install from the folder
node bin/termdeck.js         # run the entry point directly
npm exec -- termdeck         # run via the local package
```

Two tips while testing:

- Keep your real config safe by pointing at a throwaway one:
  `TERMDECK_CONFIG=./scratch-config.json termdeck` (on Windows Git Bash use
  `TERMDECK_CONFIG=./scratch-config.json node bin/termdeck.js`).
- `termdeck --list` prints the parsed config without starting the TUI, which is
  the quickest way to check that setup wrote what you expected.

When you are ready to publish:

```bash
npm pack --dry-run   # inspect exactly which files would be uploaded
npm publish          # needs an npm account; the package name must be free
```

The `bin` field in `package.json` plus the `#!/usr/bin/env node` shebang in
`bin/termdeck.js` are what make the global `termdeck` command work.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `termdeck needs an interactive terminal` | first-run setup and the dashboard need a TTY. Use a real terminal, or `termdeck --list` |
| Browser opens too early / too late | tune the port: the URL is only opened once it appears in the output. Silence your dev server's URL banner and termdeck falls back after ~9s |
| "no terminal emulator found" | install one of the Linux terminals above or set `TERMDECK_TERMINAL` |
| `opencode` not found in the new window | change `agentCommand` to whatever you use (`cursor .`, `claude`, `aider`, …) |
| Log colours look plain | intentional: ANSI codes are stripped so the log pane stays readable in a terminal multiplexer |
| Nothing appears when clicking | make sure you are *inside* the TUI window and the terminal reports mouse events (Windows Terminal, iTerm2, GNOME Terminal, VS Code all do) |

## Development

```
bin/termdeck.js     shebang shim -> src/index.js
src/index.js        CLI flags, setup-or-dashboard decision
src/config.js       ~/.termdeck-config.json + the inquirer wizard
src/dashboard.js    the blessed/blessed-contrib TUI
src/devServer.js    spawn + log streaming + URL detection + browser open
src/terminal.js     OS-specific "new terminal window" plans
src/logView.js      scrollable, follow-the-tail log pane
src/util.js         ANSI stripping, URL parsing, which(), killTree()
test/run.js         npm test — unit tests + a real npm run dev lifecycle
test/smoke.js       npm run smoke — headless render + real mouse click on a CTA
```

## License

MIT
#   t e r m d e c k  
 