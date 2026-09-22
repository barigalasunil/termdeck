'use strict';

/**
 * The termdeck TUI.
 *
 * Compact "email client" layout — hand-positioned widgets so every pane is
 * exactly the rows it needs, with zero gaps between panes:
 *
 *   +-------------------------------------------------------------------+
 *   | 15:14:19        +------------+          ● DAEMON ON               |
 *   |                 | TERMDECK   |                                    |
 *   |                 +------------+                                    |
 *   | [ALL 14] [LIVE 6] [EXP 4] …               /search (regex) [box]   |
 *   +---------------------------------+---------------------------------+
 *   | PROJECTS (14)                   | DETAILS: hyperion-core          |
 *   |  ● hyperion-core      12m ago   |  status / path / branch / port  |
 *   |  ● atlas-engine        2h ago   +---------------------------------+
 *   |  …                              | ACTIONS [c] Claude Code …       |
 *   |                                 +---------------------------------+
 *   |                                 | OUTPUT (dev server / agents)    |
 *   |                                 |  21:04:12 ✓ vite ready 3000     |
 *   +---------------------------------+---------------------------------+
 *   | [1/14] SELECTED · keys · PANE: [PROJECTS]                         |
 *   +-------------------------------------------------------------------+
 *
 * The controller object returned by launchDashboard() keeps the same shape
 * the codebase relied on before the redesign (widgets.projectList / card /
 * logBox / buttons, servers, logView, actions, updateStatus), so the headless
 * smoke test and the auto-updater keep talking to it unchanged. Buttons live
 * inside the ACTIONS cell but stay real blessed buttons (mouse + tab focus).
 */

const path = require('path');const blessed = require('blessed');
const contrib = require('blessed-contrib');

const { DevServerManager } = require('./devServer');
const { openInNewTerminal } = require('./terminal');
const { LogView } = require('./logView');
const { MODERN_STATUSES, loadConfig, loadConfigFromPath, displayPath, saveConfig } = require('./config');
const { escapeBraces, truncate, formatTimestamp, timestamp, timeAgo } = require('./util');
const { getGitInfo, detectStack, generateCommitMessage, commitAndPush } = require('./projectManager');
const { launchAgent, tailAgentLog, stopAllAgents } = require('./agentManager');
const { startMonitoring, stopMonitoring, stopAllMonitoring } = require('./processMonitor');

const LAYOUT = { rows: 12, cols: 12, headerHeight: 6, footerHeight: 2 };

/* ------------------------------------------------------------------ *
 * Theme — dark, modern palette, pastel status tags, thin borders.
 * ------------------------------------------------------------------ */

const THEME = {
  bg: '#1e1e2e',        // base background (main screen + boxes)
  surface: '#181825',   // slightly darker panels (output, footer)
  text: '#cdd6f4',      // general text (light gray-white)
  textDim: '#9399b2',   // secondary text (timestamps, labels)
  tagCyan: '#94e2d5',   // log [termdeck] source tag
  border: '#45475a',    // thin, unobtrusive box borders
  accentBg: '#3b82f6',  // selected-project / focused-button highlight
  accentFg: '#ffffff',
  chipBg: '#2d2d3f',    // action-button / stat-chip background
};

/** Pastel status colours per modern status; `unknown` is neutral gray. */
const STATUS_FG = {
  live: '#a6e3a1',    // soft green
  exp: '#f9e2af',     // soft yellow/orange
  pend: '#89b4fa',    // soft blue
  scrap: '#6c7086',   // soft gray
  unknown: '#6c7086', // neutral gray for missing statuses
};

/** Full uppercase words shown in the DETAILS pane. */
const STATUS_FULL = { live: 'LIVE', exp: 'EXPERIMENTAL', pend: 'PENDING', scrap: 'SCRAP' };

/** Agent buttons name the agent explicitly instead of a bare key hint. */
const AGENT_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  freebuff: 'Freebuff',
  kilocode: 'Kilocode',
};

const PROJECT_COLORS = ['#89b4fa', '#a6e3a1', '#f9e2af', '#f5c2e7', '#f38ba8', '#94e2d5'];

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

const DEMO_PID = 49201;
const SAMPLE_CONFIG_PATH = path.join(__dirname, '..', 'sample-config.json');

const FOOTER_KEYS =
  '{bold}\u2191\u2193{/bold} navigate  {bold}tab{/bold} pane  {bold}s{/bold} status  {bold}/{/bold} search  {bold}r{/bold} dev  {bold}shift+x{/bold} stop  {bold}q{/bold} quit';
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
 * Modern short status for a project, or `null` when the status is missing or
 * unrecognised (rendered as "[?] Unknown" instead of guessing).
 */
function modernStatusOf(project) {
  if (!project) return null;
  const raw = project.status;
  if (raw === null || raw === undefined || raw === '') return null;
  if (String(raw).toLowerCase() === 'unknown') return null;
  return MODERN_OF[raw] || null;
}

function statusFg(modern) {
  return STATUS_FG[modern] || STATUS_FG.unknown;
}

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
  const stackInfo = new Map();
  const processStats = new Map(); // project.path -> {running, pid, memory, cpu}
  let monitoredPath = null; // project.path currently polled by processMonitor
  let searchActive = false;
  let searchBuffer = '';
  let gitModal = null;

  const colorFor = (project) => palette.get(project.path) || THEME.text;

  function rebuildPalette() {
    palette.clear();
    projects.forEach((project, index) => palette.set(project.path, PROJECT_COLORS[index % PROJECT_COLORS.length]));
  }
  rebuildPalette();

  const configLoader = config.demoMode ? () => loadConfigFromPath(SAMPLE_CONFIG_PATH, {}) : () => loadConfig({});

  /* ---------------------------------------------------------------- *
   * Widgets (hand-positioned: exact rows, zero gaps between panes)
   * ---------------------------------------------------------------- */

  /**
   * Shared look for a bordered panel: dark bg, thin dark-gray border,
   * subtle label. Style is assigned before setLabel on purpose — blessed
   * bakes style.label into the label widget when it is created.
   */
  function panel(el, label) {
    el.style.border = { type: 'line', fg: THEME.border };
    el.style.label = { fg: THEME.textDim };
    el.style.fg = THEME.text;
    el.style.bg = THEME.bg;
    if (label) el.setLabel(label);
    return el;
  }

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

  const bodyTop = HEADER_ROWS;                 // masthead + chips strip
  const footerHeight = 2;                      // bordered footer box
  const bodyHeight = Math.max(6, screen.rows - bodyTop - footerHeight);
  // Bordered buttons need 5 rows x 3 cells (15) + border(2) + label-row(0). When the
  // window is too short (80x24 → body 16), the grid collapses to 1-line chips.
  const large = bodyHeight >= 29;
  const actionsHeight = large ? 18 : 8;        // border(2) + grid(5x3 or 5x1)
  const outputHeight = Math.max(3, Math.min(large ? 6 : 4, bodyHeight - actionsHeight - (large ? 8 : 5)));
  const cardHeight = Math.max(3, bodyHeight - actionsHeight - outputHeight);
  const logHeight = outputHeight;

  const projectList = blessed.list({
    parent: screen,
    top: bodyTop,
    left: 0,
    width: '40%',
    height: bodyHeight,
    tags: true,
    keys: true,
    mouse: true,
    interactive: true,
    scrollable: true,
    alwaysScroll: true,
    items: [],
    border: { type: 'line', fg: THEME.border },
    style: {
      bg: THEME.bg,
      item: { fg: THEME.text, hover: { bg: '#313244' } },
      selected: { bg: THEME.accentBg, fg: THEME.accentFg, bold: true },
    },
  });
  panel(projectList, ' PROJECTS ');
  paneHeaderRight(projectList, ' SORT: RECENT ');

  const rightLeft = '40%';
  const rightWidth = '60%';

  const card = blessed.box({
    parent: screen,
    top: bodyTop,
    left: rightLeft,
    width: rightWidth,
    height: cardHeight,
    tags: true,
    scrollable: true,
    mouse: true,
    border: { type: 'line', fg: THEME.border },
  });
  panel(card, ' DETAILS ');
  const gitHeader = paneHeaderRight(card, '{#a6e3a1-fg}GIT: CLEAN{/#a6e3a1-fg}');

  const actionsShell = blessed.box({
    parent: screen,
    top: bodyTop + cardHeight,
    left: rightLeft,
    width: rightWidth,
    height: actionsHeight,
    tags: true,
    border: { type: 'line', fg: THEME.border },
  });
  panel(actionsShell, ' ACTIONS - r/e/c/x/o/f/k/s or [Enter] ');
  paneHeaderRight(actionsShell, ' KEYMAP: VIM/CLI ');

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

  const buttons = {};

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

  addButton('dev', { row: 0, col: 0 }, `{bold}[r]{/bold} Run dev server`, { onPress: () => startDevServer() });
  addButton('editor', { row: 0, col: 1 }, `{bold}[e]{/bold} Open in editor`, { onPress: () => openTool('editor') });
  addButton('claude', { row: 1, col: 0 }, `{bold}[c]{/bold} ${AGENT_LABELS.claude}`, { onPress: () => openTool('claude') });
  addButton('codex', { row: 1, col: 1 }, `{bold}[x]{/bold} ${AGENT_LABELS.codex}`, { onPress: () => openTool('codex') });
  addButton('opencode', { row: 2, col: 0 }, `{bold}[o]{/bold} ${AGENT_LABELS.opencode}`, { onPress: () => openTool('opencode') });
  addButton('freebuff', { row: 2, col: 1 }, `{bold}[f]{/bold} ${AGENT_LABELS.freebuff}`, { onPress: () => openTool('freebuff') });
  addButton('kilocode', { row: 3, col: 0 }, `{bold}[k]{/bold} ${AGENT_LABELS.kilocode}`, { onPress: () => openTool('kilocode') });
  addButton('status', { row: 3, col: 1 }, `{bold}[s]{/bold} Change status`, { onPress: () => cycleStatus() });
  addButton('git', { row: 4, col: 0 }, `{bold}[g]{/bold} Git commit & push \u25b8 git`, { onPress: openGitCommitModal });

  // Created after the buttons so tab-focus order is list -> actions -> output.
  const logBox = contrib.log({
    parent: screen,
    top: bodyTop + cardHeight + actionsHeight,
    left: rightLeft,
    width: rightWidth,
    height: logHeight,
    tags: true,
    keys: true,
    mouse: true,
    bufferLength: 600,
    border: { type: 'line', fg: THEME.border },
    style: { bg: THEME.surface, item: { fg: THEME.text }, selected: { fg: THEME.text, bg: '#313244' } },
  });
  panel(logBox, ' OUTPUT (dev server / agents)  autoscroll [ON] ');
  paneHeaderRight(logBox, ` BUFFER: 1024L {${STATUS_FG.live}-fg}STREAM ACTIVE{/${STATUS_FG.live}-fg} `);

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
        appendLog(project, `{${STATUS_FG.exp}-fg}dev server crashed — auto-restarting ({bold}${info.attempt}/${info.max}{/bold})\u2026{/${STATUS_FG.exp}-fg}`, 'system');
      } else {
        const detail = info.code === null || info.code === undefined ? `signal ${info.signal}` : `exit code ${info.code}`;
        appendLog(project, `{${THEME.textDim}-fg}dev server stopped (${detail}){/${THEME.textDim}-fg}`, 'system');
      }
      refreshList();
      updateCard();
    },
  });

  /* ---------------------------------------------------------------- *
   * Rendering helpers
   * ---------------------------------------------------------------- */

  function modernCounts() {
    const counts = { live: 0, exp: 0, pend: 0, scrap: 0, unknown: 0 };
    for (const project of projects) {
      const modern = modernStatusOf(project) || 'unknown';
      counts[modern] = (counts[modern] || 0) + 1;
    }
    return counts;
  }

  function chipData() {
    const counts = modernCounts();
    const activeKey = status.chip || 'all';
    return CHIP_ORDER.map((key) => {
      const count = key === 'all' ? projects.length : counts[key] || 0;
      return { key, label: CHIP_LABELS[key], count, active: key === activeKey, hidden: key !== 'all' && count <= 0 };
    });
  }

  function searchLabel() {
    if (searchActive) return `/search (regex): ${searchBuffer}`;
    return status.search ? `/search (regex): ${status.search}` : '/search (regex)';
  }

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
      box.active = chip.active;
    });

    searchBox.setContent(escapeBraces(searchLabel()));
  }

  /** Projects after the chip (status) + search (regex on name) filters. */
  function filteredProjects() {
    let list = projects;
    if (status.chip === 'unknown') {
      list = list.filter((project) => modernStatusOf(project) === null);
    } else if (status.chip) {
      list = list.filter((project) => modernStatusOf(project) === status.chip);
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

  function devStateLine(project, state) {
    if (state && (state.status === 'running' || state.status === 'starting')) {
      const where = state.url ? ` \u2192 ${escapeBraces(state.url)}` : ' \u2014 waiting for a localhost URL\u2026';
      return ` {${STATUS_FG.live}-fg}● dev server ${state.status} (pid ${state.pid}){/${STATUS_FG.live}-fg}${where}`;
    }
    if (state && state.status === 'error') {
      return ` {#f38ba8-fg}● ${escapeBraces(truncate(state.error || 'failed to start', 50))}{/#f38ba8-fg}`;
    }
    const last = servers.lastExit.get(project.path);
    if (last) {
      const detail = last.code === null || last.code === undefined ? `signal ${last.signal}` : `exit code ${last.code}`;
      return ` {${THEME.textDim}-fg}○ dev server stopped (${detail}){/${THEME.textDim}-fg}`;
    }
    return ` {${THEME.textDim}-fg}○ dev server not running{/${THEME.textDim}-fg}`;
  }

  function updateCard() {
    const project = selectedProject();
    if (!project) {
      card.setContent(` {${THEME.textDim}-fg}No projects configured. Run \`termdeck --setup\`.{/${THEME.textDim}-fg}`);
      screen.render();
      return;
    }

    const state = runStates.get(project.path) || { status: 'idle' };
    const modern = modernStatusOf(project);
    const sFg = statusFg(modern);
    const inner = Math.max(24, Math.floor(screen.cols * 0.6) - 4);
    const info = gitInfo.get(project.path);
    const stats = processStats.get(project.path);
    const memCpu = stats && stats.memory
      ? `${escapeBraces(stats.memory)} \u00b7 ${escapeBraces(stats.cpu || '\u2014')}`
      : config.demoMode
        ? `213.4 MB \u00b7 0.8% {${THEME.textDim}-fg}(demo){/${THEME.textDim}-fg}`
        : '\u2014';
    const dirty = info && info.dirty ? info.dirty : { added: 0, removed: 0 };
    const dirtyLabel = dirty.added
      ? ` {${STATUS_FG.live}-fg}+${dirty.added}{/${STATUS_FG.live}-fg}`
      : '';
    const dirtyLabel2 = dirty.removed
      ? ` {#f38ba8-fg}-${dirty.removed}{/#f38ba8-fg}`
      : '';
    const branch = (info && info.branch) || project.branch || '\u2014';
    const hash = (info && info.commitHash) || (project.lastCommit && project.lastCommit.hash) || '';
    const msg = (info && info.commitMsg) || (project.lastCommit && project.lastCommit.message) || '';
    const lastAt = (info && timeAgo(info.lastCommitAt)) || project.lastActivity || null;
    const commit = `${hash} ${msg} ${lastAt ? `(${lastAt})` : ''}`.trim() || branch;

    // Unknown / missing status renders as "[?] Unknown" in neutral gray; the
    // status button is recoloured below to prompt the user to set it.
    const unknown = !modern;
    const fullLabel = modern ? (STATUS_FULL[modern] || modern.toUpperCase()) : 'UNKNOWN';
    const statusChip = unknown
      ? `{${STATUS_FG.unknown}-fg}{bold}[?] Unknown{/bold}{/${STATUS_FG.unknown}-fg}`
      : `{${sFg}-fg}{bold}[${modern.toUpperCase()}]{/bold} ${fullLabel}{/${sFg}-fg}`;

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

    card.setContent(lines.join('\n'));
    card.setLabel(` DETAILS: ${project.name} `);
    const dirtyNow = Boolean(dirty && (dirty.added || dirty.removed));
    gitHeader.setContent(dirtyNow
      ? `{#f38ba8-fg}GIT: DIRTY{/#f38ba8-fg}`
      : `{#a6e3a1-fg}GIT: CLEAN{/#a6e3a1-fg}`);

    // Visual cue while the status is unknown: red button asking to be set.
    if (unknown) {
      buttons.status.setContent('{bold}[s]{/bold} Change status!');
      buttons.status.style.fg = '#f38ba8';
      buttons.status.style.bold = true;
    } else {
      buttons.status.setContent(`{bold}[s]{/bold} Change status \u2192 ${fullLabel}`);
      buttons.status.style.fg = sFg;
      buttons.status.style.bold = false;
    }

    screen.render();
  }

  function footerHints() {
    if (screen.cols >= 110) return FOOTER_KEYS;
    if (screen.cols >= 90) return '{bold}\u2191\u2193{/bold} navigate  {bold}s{/bold} status  {bold}r{/bold} dev  {bold}shift+x{/bold} stop  {bold}q{/bold} quit';
    return '{bold}\u2191\u2193{/bold} navigate  {bold}s{/bold} status  {bold}r{/bold} dev  {bold}q{/bold} quit';
  }

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
    projectList.setLabel(` PROJECTS (${projects.length}) `);
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

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */

  function getProjectStack(project) {
    if (!project) return '\u2014';
    if (project.stack) return project.stack;
    if (config.demoMode) return '\u2014';
    if (!stackInfo.has(project.path)) stackInfo.set(project.path, detectStack(project.path));
    return stackInfo.get(project.path) || '\u2014';
  }

  /** Stack shown as comma-separated names, even when config used dashes. Plain
   *  audit text — the row() helper escapes it for blessed markup. */
  function stackLabel(project) {
    return String(getProjectStack(project) || '\u2014').replace(/\s*-\s*/g, ', ');
  }

  function refreshProjectStack(project) {
    if (!project || config.demoMode || project.stack) return;
    const stack = detectStack(project.path);
    stackInfo.set(project.path, stack);
    if (selectedProject() === project) updateCard();
  }

  function openGitCommitModal() {
    const project = selectedProject();
    if (!project) return false;
    if (gitModal) {
      gitModal.textbox.focus();
      return true;
    }

    let generated;
    try {
      generated = generateCommitMessage(project.path);
    } catch (_) {
      generated = 'Update project files';
    }
    if (generated === null) {
      appendLog(project, `{${STATUS_FG.exp}-fg}⚠ No changes to commit.{/${STATUS_FG.exp}-fg}`, 'system');
      setStatus(`${project.name}: No changes to commit.`);
      return true;
    }

    const width = Math.max(32, Math.min(72, screen.cols - 4));
    const height = Math.max(10, Math.min(14, screen.rows - 4));
    const modal = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width,
      height,
      tags: true,
      keys: true,
      border: { type: 'line', fg: THEME.border },
      style: { bg: THEME.surface, fg: THEME.text },
    });
    modal.setLabel(' Git Commit Message ');
    blessed.text({
      parent: modal,
      top: 1,
      left: 2,
      width: width - 4,
      height: 1,
      tags: true,
      content: 'Press Enter to commit & push, Esc to cancel',
      style: { fg: THEME.textDim },
    });
    const textbox = blessed.textbox({
      parent: modal,
      top: 3,
      left: 2,
      width: width - 4,
      height: Math.max(3, height - 7),
      keys: true,
      mouse: true,
      value: generated || 'Update project files',
      style: {
        fg: THEME.text,
        bg: THEME.surface,
        focus: { fg: THEME.text, bg: '#282838' },
      },
    });
    const hint = blessed.text({
      parent: modal,
      bottom: 1,
      left: 2,
      width: width - 4,
      height: 1,
      tags: true,
      content: "Press 'a' to auto-generate, or edit manually. Enter to commit, Esc to cancel.",
      style: { fg: THEME.textDim },
    });

    const originalListener = textbox._listener;
    textbox._listener = function(ch, key) {
      if ((key.name === 'a' || key.name === 'A') && !key.ctrl && !key.meta) {
        let next;
        try {
          next = generateCommitMessage(project.path);
        } catch (_) {
          next = 'Update project files';
        }
        if (next === null) {
          appendLog(project, `{${STATUS_FG.exp}-fg}⚠ No changes to commit.{/${STATUS_FG.exp}-fg}`, 'system');
          hint.setContent("Press 'a' to auto-generate, or edit manually. Enter to commit, Esc to cancel.");
        } else {
          textbox.setValue(next || 'Update project files');
          hint.setContent("Auto-generated. Press 'a' to regenerate, or edit manually. Enter to commit, Esc to cancel.");
        }
        screen.render();
        return;
      }
      return originalListener.call(this, ch, key);
    };

    function closeGitModal() {
      if (!gitModal) return;
      gitModal = null;
      try { modal.destroy(); } catch (_) {}
      try { projectList.focus(); } catch (_) {}
      try { screen.render(); } catch (_) {}
    }

    function finish(value) {
      closeGitModal();
      if (value == null) {
        setStatus(`${project.name}: Git commit cancelled.`);
        return;
      }
      const message = String(value).trim();
      if (!message) {
        appendLog(project, `{${STATUS_FG.exp}-fg}⚠ Commit message cannot be empty.{/${STATUS_FG.exp}-fg}`, 'system');
        setStatus(`${project.name}: Commit message cannot be empty.`);
        return;
      }
      setImmediate(() => runGitCommit(project, message));
    }

    textbox.on('submit', finish);
    textbox.on('cancel', () => finish(null));
    gitModal = { modal, textbox, close: closeGitModal };
    textbox.readInput();
    screen.render();
    return true;
  }

  function runGitCommit(project, message) {
    logView.followTail();
    appendLog(project, `{${STATUS_FG.live}-fg}[git]{/${STATUS_FG.live}-fg} committing and pushing…`, 'system');
    let result;
    try {
      result = commitAndPush(project.path, message, {
        onOutput: (line, stream) => appendLog(project, line, stream),
      });
    } catch (err) {
      appendLog(project, `{#f38ba8-fg}✗ Git operation failed: ${escapeBraces(err.message)}{/#f38ba8-fg}`, 'system');
      setStatus(`${project.name}: Git operation failed: ${err.message}`);
      refreshProjectGit(project, { force: true });
      return;
    }

    if (result.warning) {
      appendLog(project, `{${STATUS_FG.exp}-fg}⚠ ${escapeBraces(result.warning)}{/${STATUS_FG.exp}-fg}`, 'system');
      setStatus(`${project.name}: ${result.warning}`);
      return;
    }
    if (!result.ok) {
      appendLog(project, `{#f38ba8-fg}✗ ${escapeBraces(result.error)}{/#f38ba8-fg}`, 'system');
      setStatus(`${project.name}: ${result.error}`);
      refreshProjectGit(project, { force: true });
      return;
    }

    const fileCount = result.fileCount || 1;
    appendLog(
      project,
      `{${STATUS_FG.live}-fg}✓ [git] Committed and pushed ${fileCount} files: "${escapeBraces(result.message)}"{/${STATUS_FG.live}-fg}`,
      'system'
    );
    setStatus(`${project.name}: committed and pushed.`);
    refreshProjectGit(project, { force: true });
  }

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
      appendLog(project, `{#f38ba8-fg}could not start: ${escapeBraces(result.error)}{/#f38ba8-fg}`, 'system');
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
        appendLog(project, `{${STATUS_FG.live}-fg}new ${escapeBraces(result.terminal)} window \u2192 ${escapeBraces(displayPath(project.path, config.root))}{/${STATUS_FG.live}-fg}`, 'system');
        setStatus(`Opened editor in a new terminal window.`);
      } else {
        appendLog(project, `{#f38ba8-fg}could not open a terminal: ${escapeBraces(result.error)}{/#f38ba8-fg}`, 'system');
        setStatus(`Could not open a terminal for ${project.name}.`);
      }
      return result;
    }

    // Agent: launch in a new terminal with log capture via tee where possible.
    const agentName = AGENT_LABELS[kind] || kind;
    appendLog(project, `{${STATUS_FG.exp}-fg}[${escapeBraces(kind)}]{/${STATUS_FG.exp}-fg} launching ${escapeBraces(agentName)} in a new terminal`, 'system');
    setStatus(`Launching ${agentName} for ${project.name}\u2026`);
    const result = await launchAgent(project, kind);
    if (result.ok) {
      appendLog(project, `{${STATUS_FG.live}-fg}${escapeBraces(agentName)} launched in new ${escapeBraces(result.terminal || 'terminal')} window \u2192 logs \u2192 ${escapeBraces(result.logFile || 'terminal only')}{/${STATUS_FG.live}-fg}`, 'system');
      setStatus(`Launched ${agentName} for ${project.name}.`);
      if (result.logFile) {
        tailAgentLog(project, kind, (line) => appendLog(project, line, 'stdout'));
      }
    } else {
      appendLog(project, `{#f38ba8-fg}could not launch ${escapeBraces(agentName)}: ${escapeBraces(result.error)}{/#f38ba8-fg}`, 'system');
      setStatus(`Could not launch ${agentName} for ${project.name}.`);
    }
    return result;
  }

  function cycleStatus() {
    const project = selectedProject();
    if (!project) return;
    // Unknown / missing statuses enter the cycle at `exp` so a single press
    // gives the project a real status.
    const current = modernStatusOf(project) || 'exp';
    const index = MODERN_STATUSES.indexOf(current);
    const next = MODERN_STATUSES[(index + 1) % MODERN_STATUSES.length];
    project.status = next;
    appendLog(project, `{${THEME.tagCyan}-fg}[termdeck]{/${THEME.tagCyan}-fg} status changed to {bold}${next}{/bold}`, 'system');
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
    if (gitModal) gitModal.close();
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

  function refreshProjectGit(project, { force = false } = {}) {
    if (!project || config.demoMode) return;
    refreshProjectStack(project);
    const info = getGitInfo(project.path, { force });
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
  screen.key(['g'], () => { if (!searchActive) openGitCommitModal(); });
  screen.key(['S-x'], () => { if (!searchActive) stopDevServer(); });
  screen.key(['j'], () => { if (!searchActive) projectList.down(1); });
  screen.key(['tab'], () => { if (!searchActive) screen.focusNext(); });
  screen.key(['S-tab'], () => { if (!searchActive) screen.focusPrevious(); });
  screen.key(['S-g', 'end'], () => logView.followTail());
  screen.key(['pageup'], () => logView.page(-1));
  screen.key(['pagedown'], () => logView.page(1));
  screen.key(['S-pageup', 'home'], () => logView.scrollTop());

  /* ---------------------------------------------------------------- *
   * Filter chips: 1 = ALL, 2 = LIVE, 3 = EXP, 4 = PEND, 5 = UNKNOWN, 6 = SCRAP
   * ---------------------------------------------------------------- */

  const FILTER_KEYS = {
    '1': null,           // ALL (clears the chip)
    '2': 'live',
    '3': 'exp',
    '4': 'pend',
    '5': 'unknown',
    '6': 'scrap',
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

    // Filter chips: 1–6.
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
  appendLog({ name: 'termdeck', path: '__termdeck__' }, `{bold}termdeck{/bold} ready - ${projects.length} projects discovered from ${escapeBraces(displayPath(config.root, config.root))}`, 'system');
  appendLog({ name: 'termdeck', path: '__termdeck__' }, `pick a project and press {bold}r{/bold} for the dev server, {bold}e{/bold} for your editor, {bold}c/x/o/f/k{/bold} for an agent.`, 'system');
  if (config.demoMode) {
    const demoProject = projects[0] || { name: 'hyperion-core', path: 'demo' };
    for (const sample of SAMPLE_LOG_LINES) {
      appendLog(demoProject, sample.line, sample.stream);
    }
  }

  // Staggered git-info refresh so the first git spawns do not block the
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
  updateHeader(); // re-center the title now that geometry exists
  screen.render();

  // One-shot boot toast (e.g. "✨ Discovered and added 2 new projects") from
  // the launch flow's silent auto-discovery. Routed through setStatus so it
  // lands in the footer and clears itself like every other status message.
  if (options.bootStatus) {
    setStatus(options.bootStatus);
    appendLog({ name: 'termdeck', path: '__termdeck__' }, options.bootStatus, 'system');
  }

  return {
    screen,
    widgets: { header: titleBox, title: titleBox, statsBar: chipStrip, projectList, card, logBox, footer, buttons },
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
