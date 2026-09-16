'use strict';

/**
 * The termdeck TUI.
 *
 * 12x12 blessed-contrib grid layout:
 *
 *   +-------------------------------------------------------------------+
 *   | header: termdeck · [ALL 14][LIVE 6]… /search · time · ● DAEMON OFF  |
 *   +---------------------------------+---------------------------------+
 *   | PROJECTS (14 repos)             | DETAILS: hyperion-core       …  |
 *   |  ● hyperion-core     12m ago    |  path / status / branch / port  |
 *   |  ● atlas-engine       2h ago    +---------------------------------+
 *   |  …                               | ACTIONS (r/e/c/x/o/f/k/s)    |
 *   |                                 +---------------------------------+
 *   |                                 | OUTPUT (dev server / agents)   |
 *   |                                 |  21:04:12 ✓ vite ready 3000    |
 *   +---------------------------------+---------------------------------+
 *   | footer: [1/14] selected · keys · tab switch pane · q quit         |
 *   +-------------------------------------------------------------------+
 *
 * The controller object returned by launchDashboard() keeps the same shape
 * the codebase relied on before the redesign (widgets.projectList / card /
 * logBox / buttons, servers, logView, actions, updateStatus), so the headless
 * smoke test and the auto-updater keep talking to it unchanged. Buttons live
 * inside the ACTIONS cell but stay real blessed buttons (mouse + tab focus).
 */

const path = require('path');

const blessed = require('blessed');
const contrib = require('blessed-contrib');

const { DevServerManager } = require('./devServer');
const { openInNewTerminal } = require('./terminal');
const { LogView } = require('./logView');
const { STATUS_COLORS, MODERN_STATUSES, loadConfig, loadConfigFromPath, displayPath, saveConfig } = require('./config');
const { escapeBraces, truncate, timestamp, timeAgo } = require('./util');
const { getGitInfo } = require('./projectManager');
const { AGENT_COMMANDS, launchAgent, tailAgentLog, stopAllAgents } = require('./agentManager');
const { startMonitoring, stopMonitoring, stopAllMonitoring } = require('./processMonitor');

const LAYOUT = { rows: 12, cols: 12, headerHeight: 1, footerHeight: 1 };

const PROJECT_COLORS = ['cyan', 'green', 'yellow', 'magenta', 'red', 'white'];

/** Legacy status -> short modern label, used for dots, chips and cycling. */
const MODERN_OF = {
  Live: 'live',
  Experimental: 'exp',
  Working: 'pend',
  Pending: 'pend',
  live: 'live',
  exp: 'exp',
  pend: 'pend',
  scrap: 'scrap',
};

/** Dot / chip colour per modern status (design spec). */
const DOT_COLORS = { live: 'green', exp: 'yellow', pend: 'blue', scrap: 'gray' };

const DEMO_PID = 49201;
const SAMPLE_CONFIG_PATH = path.join(__dirname, '..', 'sample-config.json');

const DEFAULT_AGENT_COMMANDS = { claude: 'claude', codex: 'codex', opencode: 'opencode', freebuff: 'freebuff', kilocode: 'kilocode' };

const FOOTER_KEYS =
  '{bold}↑↓{/bold} navigate  {bold}tab{/bold} switch pane  {bold}s{/bold} status  {bold}/{/bold} search  {bold}shift+x{/bold} stop dev  {bold}r{/bold} run dev  {bold}q{/bold} quit';
const HINTS = ` ${FOOTER_KEYS} `;

/** Colour-coded demo log lines so the OUTPUT pane styling can be checked. */
const SAMPLE_LOG_LINES = [
  { stream: 'system', line: '{green-fg}✓{/green-fg} dev server ready on http://localhost:3000 — logs follow' },
  { stream: 'stdout', line: '{cyan-fg}[vite]{/cyan-fg}  VITE v5.0.0 ready in 412 ms' },
  { stream: 'stdout', line: '{green-fg}✓{/green-fg}  ➜  Local:   http://localhost:3000/' },
  { stream: 'stdout', line: '{green-fg}✓{/green-fg}  ➜  Network: http://192.168.1.24:3000/' },
  { stream: 'stdout', line: '{cyan-fg}[vite]{/cyan-fg}  hmr update /src/app/page.tsx 2.14s' },
  { stream: 'stderr', line: '{red-fg}✗{/red-fg}  cache flush failed — retrying (1/3)' },
  { stream: 'stdout', line: '{yellow-fg}⚠{/yellow-fg}  412 rate limited, backoff 800ms' },
  { stream: 'system', line: '{cyan-fg}[claude]{/cyan-fg} analysing query-plan regression' },
  { stream: 'system', line: '{green-fg}✓{/green-fg} cache flush recovered after retry' },
];

/**
 * @param {object} config   parsed config (real or the shipped demo dataset)
 * @param {object} [options]
 * @param {boolean} [options.autoOpen]  open the browser when a dev server reports a URL
 * @param {boolean} [options.autoRestart]  enable/disable dev-server crash recovery
 * @param {object} [options.screenOptions] extra blessed screen options (headless tests)
 * @returns {object} controller (useful for tests)
 */
function launchDashboard(config, options = {}) {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'termdeck',
    mouse: true,
    dockBorders: true,
    autoPadding: true,
    ...(options.screenOptions || {}),
  });

  const projects = config.projects;
  const runStates = new Map();
  const palette = new Map();
  const status = { message: null, timer: null, quitArmed: false, quitTimer: null, clock: null, chip: null, search: null };
  const gitInfo = new Map(); // project.path -> git snapshot (branch / hash / dirty)
  const processStats = new Map(); // project.path -> {running, pid, memory, cpu}
  let monitoredPath = null; // project.path currently polled by processMonitor
  let searchActive = false;
  let searchBuffer = '';

  const colorFor = (project) => palette.get(project.path) || 'white';

  function rebuildPalette() {
    palette.clear();
    projects.forEach((project, index) => palette.set(project.path, PROJECT_COLORS[index % PROJECT_COLORS.length]));
  }
  rebuildPalette();

  const dotColor = (project) => DOT_COLORS[MODERN_OF[project.status] || 'pend'] || 'gray';
  const badgeColor = (project) => STATUS_COLORS[project.status] || dotColor(project);

  const configLoader = config.demoMode ? () => loadConfigFromPath(SAMPLE_CONFIG_PATH, {}) : () => loadConfig({});

  /* ---------------------------------------------------------------- *
   * Widgets (blessed-contrib 12x12 grid)
   * ---------------------------------------------------------------- */

  const grid = new contrib.grid({ rows: LAYOUT.rows, cols: LAYOUT.cols, screen, color: '#444444' });

  function styleCell(el, label) {
    el.setLabel(label);
    el.style.border = { fg: '#444444' };
    el.style.label = { fg: '#aaaaaa' };
    el.style.fg = 'white';
  }

  const header = grid.set(0, 0, 1, 12, blessed.box, { tags: true });
  styleCell(header, ' termdeck ');

  const projectList = grid.set(1, 0, 10, 5, blessed.list, {
    tags: true,
    keys: true,
    mouse: true,
    interactive: true,
    scrollable: true,
    alwaysScroll: true,
    items: [],
    style: { selected: { bg: 'blue', fg: 'white', bold: true }, item: { fg: 'white', hover: { bg: '#333333' } } },
  });
  styleCell(projectList, ' PROJECTS (14 repos) ');

  const card = grid.set(1, 5, 3, 7, blessed.box, { tags: true, scrollable: true, mouse: true });
  styleCell(card, ' DETAILS ');

  const actionsShell = grid.set(4, 5, 3, 7, blessed.box, { tags: true });
  styleCell(actionsShell, ' ACTIONS — r/e/c/x/o/f/k/s or [Enter] ');

  const footer = grid.set(11, 0, 1, 12, blessed.box, { tags: true, style: { fg: 'white', bg: 'blue' } });

  /** One-line action button, nested inside the ACTIONS cell. */
  function makeButton({ content, color, onPress }) {
    const button = blessed.button({
      parent: actionsShell,
      top: '0%',
      left: '0%',
      width: '47%',
      height: '24%',
      content,
      align: 'center',
      valign: 'middle',
      tags: true,
      mouse: true,
      clickable: true,
      autoFocus: false,
      style: { fg: color, focus: { bg: 'lightwhite', fg: 'black', bold: true }, hover: { bg: 'lightwhite', fg: 'black', bold: true } },
    });

    button.on('press', () => {
      try {
        onPress();
      } catch (err) {
        setStatus(`Error: ${err.message}`);
      } finally {
        projectList.focus();
        screen.render();
      }
    });
    return button;
  }

  const buttons = {};
  function addButton(name, slot, label, color, onPress) {
    const button = makeButton({ content: `{bold}[${label}]{/bold} ${label === 'r' ? 'Run dev server' : label === 'e' ? 'Open in editor' : label === 's' ? 'Change status' : `${label.toUpperCase()} agent`}`, color, onPress });
    BUTTON_SLOTS.set(button, slot);
    button.top = `${slot.row * 25}%`;
    button.left = slot.col === 0 ? '1%' : '51%';
    buttons[name] = button;
    return button;
  }
  const BUTTON_SLOTS = new Map();

  addButton('dev', { row: 0, col: 0 }, 'r', 'green', () => startDevServer());
  addButton('editor', { row: 0, col: 1 }, 'e', 'blue', () => openTool('editor'));
  addButton('claude', { row: 1, col: 0 }, 'c', 'cyan', () => openTool('claude'));
  addButton('codex', { row: 1, col: 1 }, 'x', 'cyan', () => openTool('codex'));
  addButton('opencode', { row: 2, col: 0 }, 'o', 'cyan', () => openTool('opencode'));
  addButton('freebuff', { row: 2, col: 1 }, 'f', 'cyan', () => openTool('freebuff'));
  addButton('kilocode', { row: 3, col: 0 }, 'k', 'cyan', () => openTool('kilocode'));
  addButton('status', { row: 3, col: 1 }, 's', 'yellow', () => cycleStatus());

  // Created after the buttons so tab-focus order is list -> actions -> output.
  const logBox = grid.set(7, 5, 4, 7, contrib.log, {
    tags: true,
    keys: true,
    mouse: true,
    bufferLength: 600,
    style: { item: { fg: 'white' }, selected: { fg: 'white', bg: 'black' } },
  });
  styleCell(logBox, ' OUTPUT (dev server / agents) ');

  const logView = new LogView(logBox, {
    maxLines: 800,
    flushInterval: 120,
    viewportHeight: () => Math.max(1, (typeof logBox.height === 'number' ? logBox.height : screen.rows) - 2),
    onChange: () => screen.render(),
    label: ' OUTPUT (dev server / agents)  autoscroll [ON] ',
  });

  /* ---------------------------------------------------------------- *
   * Dev servers
   * ---------------------------------------------------------------- */

  const servers = new DevServerManager({
    devCommand: config.devCommand,
    autoOpenBrowser: options.autoOpen !== undefined ? options.autoOpen : config.openBrowser !== false,
    autoRestart: options.autoRestart !== undefined ? options.autoRestart : config.autoRestart !== false,
    fallbackPort: config.fallbackPort || 3000,
    onLog: (project, line, stream) => appendLog(project, line, stream),
    onState: (project, state) => {
      runStates.set(project.path, state);
      refreshList();
      updateCard();
    },
    onExit: (project, info) => {
      if (info.restart) {
        appendLog(project, `{yellow-fg}dev server crashed — auto-restarting ({bold}${info.attempt}/${info.max}{/bold})\u2026{/yellow-fg}`, 'system');
      } else {
        const detail = info.code === null || info.code === undefined ? `signal ${info.signal}` : `exit code ${info.code}`;
        appendLog(project, `{gray-fg}dev server stopped (${detail}){/gray-fg}`, 'system');
      }
      refreshList();
      updateCard();
    },
  });

  /* ---------------------------------------------------------------- *
   * Rendering helpers
   * ---------------------------------------------------------------- */

  function modernCounts() {
    const counts = { live: 0, exp: 0, pend: 0, scrap: 0 };
    for (const project of projects) {
      const modern = MODERN_OF[project.status] || 'pend';
      counts[modern] = (counts[modern] || 0) + 1;
    }
    return counts;
  }

  function filterChips() {
    const counts = modernCounts();
    const chip = (label, count, color) => {
      const modern = label.toLowerCase();
      const active = status.chip === modern;
      const text = `[${label} ${count}]`;
      return count > 0 ? `{${color}-fg}${active ? '{bold}' : ''}${text}${active ? '{/bold}' : ''}{/${color}-fg}` : '';
    };
    const allActive = status.chip === null;
    return [
      `{white-fg}${allActive ? '{bold}' : ''}[ALL ${projects.length}]${allActive ? '{/bold}' : ''}{/white-fg}`,
      chip('LIVE', counts.live, 'green'),
      chip('EXP', counts.exp, 'yellow'),
      chip('PEND', counts.pend, 'blue'),
      chip('SCRAP', counts.scrap, 'gray'),
    ].filter(Boolean).join(' ');
  }

  function searchLabel() {
    if (searchActive) return `/search: ${searchBuffer}`;
    return status.search ? `/search: ${status.search}` : '/search (regex)';
  }

  function updateHeader() {
    const left = ` {bold}termdeck{/bold}  ${filterChips()}   {white-fg}${escapeBraces(searchLabel())}{/white-fg}`;
    const right = ` {gray-fg}${timestamp()}{/gray-fg}  {green-fg}● DAEMON OFF{/green-fg} `;
    header.setContent(`${left}${right}`);
  }

  /** Projects after the chip (status) + search (regex on name) filters. */
  function filteredProjects() {
    let list = projects;
    if (status.chip) {
      list = list.filter((project) => (MODERN_OF[project.status] || 'pend') === status.chip);
    }
    if (status.search) {
      let re = null;
      try {
        re = new RegExp(status.search, 'i');
      } catch (_) {
        re = null;
      }
      if (re) list = list.filter((project) => re.test(project.name));
    }
    return list;
  }

  function listItems() {
    const inner = Math.max(12, Math.floor((screen.cols * 5) / 12) - 4);
    const nameWidth = Math.max(6, inner - 12);
    return filteredProjects().map((project) => {
      const state = runStates.get(project.path);
      const running = state && (state.status === 'running' || state.status === 'starting');
      const dot = running
        ? state.status === 'running'
          ? '{green-fg}●{/green-fg}'
          : '{yellow-fg}●{/yellow-fg}'
        : `{${dotColor(project)}-fg}●{/${dotColor(project)}-fg}`;
      const name = escapeBraces(truncate(project.name, nameWidth));
      const info = gitInfo.get(project.path);
      const activity = escapeBraces(truncate(project.lastActivity || timeAgo(info && info.lastCommitAt) || '\u2014', 10));
      return `${dot} ${name} {gray-fg}${activity}{/gray-fg}`;
    });
  }

  function devStateLine(project, state) {
    if (state && (state.status === 'running' || state.status === 'starting')) {
      const where = state.url ? ` \u2192 ${escapeBraces(state.url)}` : ' \u2014 waiting for a localhost URL\u2026';
      return ` {green-fg}● dev server ${state.status} (pid ${state.pid}){/green-fg}${where}`;
    }
    if (state && state.status === 'error') {
      return ` {red-fg}● ${escapeBraces(truncate(state.error || 'failed to start', 50))}{/red-fg}`;
    }
    const last = servers.lastExit.get(project.path);
    if (last) {
      const detail = last.code === null || last.code === undefined ? `signal ${last.signal}` : `exit code ${last.code}`;
      return ` {gray-fg}○ dev server stopped (${detail}){/gray-fg}`;
    }
    return ' {gray-fg}○ dev server not running{/gray-fg}';
  }

  function updateCard() {
    const project = selectedProject();
    if (!project) {
      card.setContent(' {gray-fg}No projects configured. Run `termdeck --setup`.{/gray-fg}');
      screen.render();
      return;
    }

    const state = runStates.get(project.path) || { status: 'idle' };
    const color = badgeColor(project);
    const inner = Math.max(24, Math.floor((screen.cols * 7) / 12) - 4);
    const runPid = state && state.pid ? state.pid : null;
    const info = gitInfo.get(project.path);
    const stats = processStats.get(project.path);
    const pidLabel = runPid
      ? runPid
      : stats && stats.pid
        ? stats.pid
        : config.demoMode && project.port
          ? `${DEMO_PID} {gray-fg}(demo){/gray-fg}`
          : '\u2014';
    const memCpu = stats && stats.memory
      ? `${escapeBraces(stats.memory)} \u00b7 ${escapeBraces(stats.cpu || '\u2014')}`
      : config.demoMode
        ? '213.4 MB \u00b7 0.8% {gray-fg}(demo){/gray-fg}'
        : '\u2014';
    const dirty = info && info.dirty ? info.dirty : { added: 0, removed: 0 };
    const dirtyLabel = dirty.added || dirty.removed
      ? ` {red-fg}+${dirty.added}/{blue-fg}-${dirty.removed}{/blue-fg}{/red-fg}`
      : '';
    const branch = (info && info.branch) || project.branch || '\u2014';
    const hash = (info && info.commitHash) || (project.lastCommit && project.lastCommit.hash) || '';
    const msg = (info && info.commitMsg) || (project.lastCommit && project.lastCommit.message) || '';
    const lastAt = (info && timeAgo(info.lastCommitAt)) || project.lastActivity || null;
    const commit = `${hash} ${msg} ${lastAt ? `(${lastAt})` : ''}`.trim() || branch;

    const lines = [
      ` {${color}-fg}●{/${color}-fg} {bold}${escapeBraces(truncate(project.name, 40))}{/bold}`,
      ` {gray-fg}${escapeBraces(truncate(project.info || '(no description)', inner - 2))}{/gray-fg}`,
      ` {gray-fg}Path:{/gray-fg} ${escapeBraces(truncate(displayPath(project.path, config.root), inner - 8))}`,
      ` {gray-fg}Status:{/gray-fg} {${color}-fg}{bold}${project.status.toUpperCase()}{/bold}{/${color}-fg}   {gray-fg}Branch:{/gray-fg} {green-fg}${escapeBraces(truncate(branch, 30))}{/green-fg}${dirtyLabel}`,
      ` {gray-fg}Dev port:{/gray-fg} ${project.port || '\u2014'}   {gray-fg}PID:{/gray-fg} ${escapeBraces(pidLabel)}`,
      ` {gray-fg}Package mgr:{/gray-fg} ${escapeBraces(project.packageManager || '\u2014')}`,
      ` {gray-fg}Stack:{/gray-fg} ${escapeBraces(truncate(project.stack || '\u2014', inner - 12))}`,
      ` {gray-fg}Mem/CPU:{/gray-fg} ${escapeBraces(memCpu)}`,
      ` {gray-fg}Last commit:{/gray-fg} ${escapeBraces(truncate(commit, inner - 16))}`,
      devStateLine(project, state),
    ];

    card.setContent(lines.join('\n'));
    card.setLabel(` DETAILS: ${project.name} `);
    screen.render();
  }

  function buildFooter() {
    const sel = selectedProject();
    const index = sel ? filteredProjects().indexOf(sel) + 1 : 0;
    const pane = currentPane();
    const size = `${screen.cols}x${screen.rows}`;
    const chipLabel = status.chip ? status.chip.toUpperCase() : 'ALL';
    const searchLabel = status.search ? ` /${status.search}` : '';
    return ` {white-fg}[${index}/${filteredProjects().length}] SELECTED  FILTER: ${chipLabel}${searchLabel}{/white-fg}   ${FOOTER_KEYS}   {cyan-fg}PANE: [${pane}]{/cyan-fg} \u2502 utf-8 \u2502 ${size} `;
  }

  function updateFooter() {
    footer.setContent(buildFooter());
  }

  function currentPane() {
    const focused = screen.focused;
    if (focused === projectList) return 'PROJECTS';
    if (focused === logBox) return 'OUTPUT';
    if (focused && Object.values(buttons).includes(focused)) return 'ACTIONS';
    return 'LIST';
  }

  function refreshList() {
    const selected = projectList.selected;
    projectList.setItems(listItems());
    projectList.setLabel(` PROJECTS (${projects.length} repos) `);
    if (typeof selected === 'number' && selected < projects.length) projectList.select(selected);
    updateHeader();
    updateFooter();
    screen.render();
  }

  function selectedProject() {
    const list = filteredProjects();
    if (!list.length) return null;
    const index = Math.min(Math.max(projectList.selected || 0, 0), list.length - 1);
    return list[index];
  }

  function setStatus(message) {
    if (status.timer) clearTimeout(status.timer);
    status.message = message;
    footer.setContent(` {bold}${escapeBraces(message)}{/bold}`);
    screen.render();

    status.timer = setTimeout(() => {
      status.message = null;
      updateFooter();
      screen.render();
    }, 6000);
    if (status.timer.unref) status.timer.unref();
  }

  /** Log lines from child processes are raw text -> escape blessed markup. */
  function appendLog(project, line, stream = 'stdout') {
    const prefix = `{gray-fg}${timestamp()}{/gray-fg} {${colorFor(project)}-fg}${escapeBraces(truncate(project.name, 10))}{/${colorFor(project)}-fg}`;
    if (stream === 'system') {
      logView.push(`${prefix} {cyan-fg}[termdeck]{/cyan-fg} ${line}`);
      return;
    }
    const marker = stream === 'stderr' ? '{red-fg}✗{/red-fg} ' : '';
    logView.push(`${prefix} ${marker}${escapeBraces(line)}`);
  }

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */

  function startDevServer() {
    const project = selectedProject();
    if (!project) return;

    const existing = servers.get(project.path);
    if (existing) {
      logView.followTail();
      appendLog(project, `already running (pid ${existing.pid})`, 'system');
      setStatus(`${project.name}: dev server already running (pid ${existing.pid}).`);
      return;
    }

    setStatus(`Starting dev server for ${project.name}\u2026`);
    logView.followTail();
    const result = servers.start(project);

    if (!result.ok) {
      appendLog(project, `{red-fg}could not start: ${escapeBraces(result.error)}{/red-fg}`, 'system');
      setStatus(`Could not start ${project.name}: ${result.error}`);
    } else {
      appendLog(project, `logs streaming into the OUTPUT pane — press shift+x to stop`, 'system');
    }
    refreshList();
    updateCard();
  }

  function stopDevServer() {
    const project = selectedProject();
    if (!project) return;
    if (!servers.isRunning(project.path)) {
      setStatus(`${project.name}: no dev server is running.`);
      return false;
    }
    servers.stop(project.path);
    appendLog(project, `stopping dev server\u2026`, 'system');
    setStatus(`Stopped the dev server for ${project.name}.`);
    refreshList();
    updateCard();
    return true;
  }

  async function openTool(kind) {
    const project = selectedProject();
    if (!project) return;

    if (kind === 'editor') {
      const command = project.editorCommand || config.editorCommand;
      setStatus(`Opening editor for ${project.name} in a new terminal window\u2026`);
      appendLog(project, `opening editor in a new terminal: ${escapeBraces(command)}`, 'system');
      const result = await openInNewTerminal({ cwd: project.path, command });
      if (result.ok) {
        appendLog(project, `{green-fg}new ${escapeBraces(result.terminal)} window \u2192 ${escapeBraces(displayPath(project.path, config.root))}{/green-fg}`, 'system');
        setStatus(`Opened editor in a new terminal window.`);
      } else {
        appendLog(project, `{red-fg}could not open a terminal: ${escapeBraces(result.error)}{/red-fg}`, 'system');
        setStatus(`Could not open a terminal for ${project.name}.`);
      }
      return result;
    }

    // Agent: launch in a new terminal with log capture via tee where possible.
    appendLog(project, `{cyan-fg}[${escapeBraces(kind)}]{/cyan-fg} launching ${escapeBraces(kind)} in a new terminal`, 'system');
    setStatus(`Launching ${kind} for ${project.name}\u2026`);
    const result = await launchAgent(project, kind);
    if (result.ok) {
      appendLog(project, `{green-fg}${escapeBraces(kind)} launched in new ${escapeBraces(result.terminal || 'terminal')} window \u2192 logs \u2192 ${escapeBraces(result.logFile || 'terminal only')}{/green-fg}`, 'system');
      setStatus(`Launched ${kind} for ${project.name}.`);
      if (result.logFile) {
        tailAgentLog(project, kind, (line) => appendLog(project, line, 'stdout'));
      }
    } else {
      appendLog(project, `{red-fg}could not launch ${escapeBraces(kind)}: ${escapeBraces(result.error)}{/red-fg}`, 'system');
      setStatus(`Could not launch ${kind} for ${project.name}.`);
    }
    return result;
  }

  function cycleStatus() {
    const project = selectedProject();
    if (!project) return;
    const current = MODERN_OF[project.status] || 'pend';
    const index = MODERN_STATUSES.indexOf(current);
    const next = MODERN_STATUSES[(index + 1) % MODERN_STATUSES.length];
    project.status = next;
    appendLog(project, `{cyan-fg}[termdeck]{/cyan-fg} status changed to {bold}${next}{/bold}`, 'system');
    setStatus(`${project.name}: status \u2192 ${next}`);
    if (!config.demoMode) {
      try { saveConfig(config); } catch (_) { /* best effort */ }
    }
    refreshList();
    updateCard();
  }

  function reloadConfig() {
    const fresh = configLoader();
    if (!fresh) {
      setStatus('Could not reload the config file.');
      return;
    }

    config.root = fresh.root;
    config.devCommand = fresh.devCommand;
    config.editorCommand = fresh.editorCommand;
    config.agentCommand = fresh.agentCommand;
    config.openBrowser = fresh.openBrowser;
    projects.splice(0, projects.length, ...fresh.projects);

    for (const key of [...runStates.keys()]) {
      if (!projects.some((p) => p.path === key)) runStates.delete(key);
    }

    rebuildPalette();
    projectList.select(0);
    refreshList();
    updateCard();
    setStatus(`Reloaded ${projects.length} projects from ${displayPath(config.root, config.root)}`);
  }

  function destroy() {
    if (status.timer) clearTimeout(status.timer);
    if (status.quitTimer) clearTimeout(status.quitTimer);
    if (status.clock) clearInterval(status.clock);
    logView.destroy();
    servers.stopAll();
    stopAllMonitoring();
    try { stopAllAgents(); } catch (_) { /* cleanup only */ }
    try {
      screen.destroy();
    } catch (_) {
      /* already gone */
    }
  }

  function quit() {
    const running = servers.runningCount;
    if (running > 0 && !status.quitArmed) {
      status.quitArmed = true;
      setStatus(`Press q again to quit — ${running} dev server${running === 1 ? '' : 's'} will be stopped.`);
      status.quitTimer = setTimeout(() => {
        status.quitArmed = false;
        status.message = null;
        updateFooter();
        screen.render();
      }, 4000);
      return;
    }

    destroy();
    process.exit(0);
  }

  /* ---------------------------------------------------------------- *
   * Git / process-monitor refresh on selection
   * ---------------------------------------------------------------- */

  function refreshProjectGit(project) {
    if (!project || config.demoMode) return;
    const info = getGitInfo(project.path);
    gitInfo.set(project.path, info);
    if (selectedProject() === project) {
      refreshList();
      updateCard();
    }
  }

  function stopMonitor() {
    if (!monitoredPath) return;
    try { stopMonitoring(monitoredPath); } catch (_) { /* not critical */ }
    monitoredPath = null;
  }

  function refreshProcessMonitor(project) {
    stopMonitor();
    if (!project || config.demoMode) return;
    if (!project.port) { updateCard(); return; }
    startMonitoring(project, (stats) => {
      processStats.set(project.path, stats);
      if (selectedProject() === project) updateCard();
    }, { intervalMs: 2000 });
    monitoredPath = project.path;
  }

  /* ---------------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------------- */

  let selecting = false;
  const selectProject = (item, index) => {
    if (selecting || typeof index !== 'number') { updateCard(); return; }
    const list = filteredProjects();
    if (index >= list.length) return;
    selecting = true;
    try {
      const project = list[index];
      updateCard();
      refreshProjectGit(project);
      refreshProcessMonitor(project);
    } finally {
      selecting = false;
    }
  };

  projectList.on('select item', selectProject);
  projectList.on('select', selectProject);
  projectList.on('action', selectProject);
  projectList.on('cancel', () => updateCard());

  screen.key(['q', 'C-c'], quit);
  screen.key(['r', 'd'], () => { if (!searchActive) startDevServer(); });
  screen.key(['e'], () => { if (!searchActive) openTool('editor'); });
  screen.key(['s'], () => { if (!searchActive) cycleStatus(); });
  screen.key(['c'], () => { if (!searchActive) openTool('claude'); });
  screen.key(['x'], () => { if (!searchActive) openTool('codex'); });
  screen.key(['o'], () => { if (!searchActive) openTool('opencode'); });
  screen.key(['f'], () => { if (!searchActive) openTool('freebuff'); });
  screen.key(['k'], () => { if (!searchActive) openTool('kilocode'); });
  screen.key(['a'], () => { if (!searchActive) openTool('opencode'); });
  screen.key(['S-x'], () => { if (!searchActive) stopDevServer(); });
  screen.key(['j'], () => { if (!searchActive) projectList.down(1); });
  screen.key(['k'], () => { if (!searchActive) projectList.up(1); });
  screen.key(['tab'], () => { if (!searchActive) screen.focusNext(); });
  screen.key(['S-tab'], () => { if (!searchActive) screen.focusPrevious(); });
  screen.key(['S-g', 'end'], () => logView.followTail());
  screen.key(['pageup'], () => logView.page(-1));
  screen.key(['pagedown'], () => logView.page(1));
  screen.key(['S-pageup', 'home'], () => logView.scrollTop());

  /* ---------------------------------------------------------------- *
   * Filter chips: 1 = ALL, 2 = LIVE, 3 = EXP, 4 = PEND, 5 = SCRAP
   * ---------------------------------------------------------------- */

  const FILTER_KEYS = {
    '1': null,           // ALL (clears the chip)
    '2': 'live',
    '3': 'exp',
    '4': 'pend',
    '5': 'scrap',
  };
  screen.on('keypress', (ch, key) => {
    // While search mode is active, capture every keystroke for the search buffer.
    if (searchActive) {
      if (key.name === 'escape' || key.name === 'S-q') {
        searchActive = false;
        searchBuffer = '';
        projectList.focus();
        refreshList();
        screen.render();
        return;
      }
      if (key.name === 'return') {
        status.search = searchBuffer || null;
        searchActive = false;
        searchBuffer = '';
        projectList.focus();
        refreshList();
        updateCard();
        return;
      }
      if (key.name === 'backspace') {
        searchBuffer = searchBuffer.slice(0, -1);
        updateHeader();
        screen.render();
        return;
      }
      if (ch && ch.length === 1 && ch >= ' ') {
        searchBuffer += ch;
        updateHeader();
        screen.render();
      }
      return; // ignore everything else while search-active
    }

    // Filter chips: 1–5.
    if (FILTER_KEYS.hasOwnProperty(ch)) {
      status.chip = FILTER_KEYS[ch];
      refreshList();
      updateCard();
    }

    // "/" toggles the search input overlay.
    if (ch === '/') {
      searchActive = true;
      searchBuffer = '';
      updateHeader();
      screen.render();
    }
  });

  screen.on('wheelup', () => logView.scrollUp(3));
  screen.on('wheeldown', () => logView.scrollDown(3));
  screen.on('focus', () => {
    updateFooter();
    screen.render();
  });

  const onFatal = (err) => {
    destroy();
    // eslint-disable-next-line no-console
    console.error('\ntermdeck crashed:', err && err.stack ? err.stack : err);
    process.exit(1);
  };
  process.once('uncaughtException', onFatal);
  const onSignal = () => {
    destroy();
    process.exit(0);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  /* ---------------------------------------------------------------- *
   * Boot
   * ---------------------------------------------------------------- */

  projectList.focus();
  refreshList();
  updateCard();
  appendLog({ name: 'termdeck', path: '__termdeck__' }, `{bold}termdeck{/bold} ready — ${projects.length} projects from ${escapeBraces(displayPath(config.root, config.root))}`, 'system');
  appendLog({ name: 'termdeck', path: '__termdeck__' }, `pick a project and press {bold}r{/bold} for the dev server, {bold}e{/bold} for your editor, {bold}c/x/o/f/k{/bold} for an agent.`, 'system');
  if (config.demoMode) {
    const demoProject = projects[0] || { name: 'hyperion-core', path: 'demo' };
    for (const sample of SAMPLE_LOG_LINES) {
      appendLog(demoProject, sample.line, sample.stream);
    }
  }

  // Staggered git-info refresh so the first 14 git spawns do not block the
  // initial render.  Each spawn takes ~30-60 ms on a warm filesystem.
  let gitBootIdx = 0;
  const gitBoot = setInterval(() => {
    const project = projects[gitBootIdx++];
    if (!project) { clearInterval(gitBoot); return; }
    try { refreshProjectGit(project); } catch (_) { /* non-fatal */ }
  }, 80);
  if (gitBoot.unref) gitBoot.unref();

  status.clock = setInterval(() => {
    updateHeader();
    screen.render();
  }, 1000);
  if (status.clock.unref) status.clock.unref();

  // Trigger the first process-monitor tick for the initially-selected project.
  const bootMonitor = setTimeout(() => {
    const project = selectedProject();
    if (project) refreshProcessMonitor(project);
  }, 200);
  if (bootMonitor.unref) bootMonitor.unref();

  screen.render();

  return {
    screen,
    widgets: { header, projectList, card, logBox, footer, buttons },
    servers,
    logView,
    runStates,
    gitInfo,
    processStats,
    filteredProjects,
    updateStatus: setStatus,
    actions: { startDevServer, stopDevServer, openTool, reloadConfig, cycleStatus, quit, destroy, selectedProject },
  };
}

module.exports = { launchDashboard, LAYOUT, HINTS, SAMPLE_LOG_LINES };