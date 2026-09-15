'use strict';

/**
 * The termdeck TUI.
 *
 * Layout
 *   +--------------------------------------------------------------+
 *   | header: termdeck - N projects from <root>                    |
 *   +----------------+---------------------------------------------+
 *   | project list   | selected project card                        |
 *   | (click to pick)| [d] Dev Server [e] Editor [a] Agent          |
 *   |                +---------------------------------------------+
 *   |                | dev server logs (scrollable, mouse wheel)   |
 *   +----------------+---------------------------------------------+
 *   | footer: hints / status messages                              |
 *   +--------------------------------------------------------------+
 *
 * Mouse support is enabled on the screen, and the three CTAs are real blessed
 * buttons: clickable with the mouse, `press`-able with Enter/Space when focused
 * (Tab cycles focus), and every CTA also has its own keyboard shortcut.
 */

const blessed = require('blessed');
const contrib = require('blessed-contrib');

const { DevServerManager } = require('./devServer');
const { openInNewTerminal } = require('./terminal');
const { LogView } = require('./logView');
const { STATUS_COLORS, loadConfig } = require('./config');
const { escapeBraces, truncate, timestamp } = require('./util');

const LAYOUT = {
  headerHeight: 3,
  cardHeight: 8,
  buttonHeight: 3,
  footerHeight: 1,
};

const CARD_TOP = LAYOUT.headerHeight;
const BUTTON_TOP = CARD_TOP + LAYOUT.cardHeight;
const PANEL_TOP = BUTTON_TOP + LAYOUT.buttonHeight;
const SIDEBAR_WIDTH_PCT = 0.3;
const SIDEBAR_WIDTH = '30%';
const MAIN_LEFT = '30%';
const MAIN_WIDTH = '70%';

const PROJECT_COLORS = ['cyan', 'green', 'yellow', 'magenta', 'red', 'white'];

const HINTS =
  ' {bold}↑/↓{/bold} select  {bold}tab{/bold} focus buttons  {bold}d{/bold} dev server  {bold}e{/bold} editor  {bold}a{/bold} agent  ' +
  '{bold}x{/bold} stop server  {bold}r{/bold} reload  {bold}PgUp/PgDn{/bold} logs  {bold}q{/bold} quit ';

/**
 * @param {object} config   parsed ~/.termdeck-config.json
 * @param {object} [options]
 * @param {boolean} [options.autoOpen]  open the browser when a dev server reports a URL
 * @param {object} [options.screenOptions] extra blessed screen options (headless tests)
 * @returns {object} controller (useful for tests)
 */
function launchDashboard(config, options = {}) {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'termdeck',
    mouse: true, // enables clicking the CTAs
    dockBorders: true,
    autoPadding: true,
    ...(options.screenOptions || {}),
  });

  const projects = config.projects;
  const runStates = new Map();
  const palette = new Map();
  const status = { message: null, timer: null, quitArmed: false, quitTimer: null };

  const colorFor = (project) => palette.get(project.path) || 'white';

  function rebuildPalette() {
    palette.clear();
    projects.forEach((project, index) => palette.set(project.path, PROJECT_COLORS[index % PROJECT_COLORS.length]));
  }
  rebuildPalette();

  /* ---------------------------------------------------------------- *
   * Widgets
   * ---------------------------------------------------------------- */

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: LAYOUT.headerHeight,
    tags: true,
    label: ' termdeck ',
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, label: { fg: 'cyan' }, fg: 'white' },
  });

  const projectList = blessed.list({
    parent: screen,
    top: LAYOUT.headerHeight,
    left: 0,
    width: SIDEBAR_WIDTH,
    bottom: LAYOUT.footerHeight,
    label: ' projects ',
    tags: true,
    keys: true,
    vi: false,
    mouse: true,
    interactive: true,
    scrollable: true,
    alwaysScroll: true,
    border: { type: 'line' },
    style: {
      border: { fg: 'gray' },
      label: { fg: 'white' },
      selected: { bg: 'blue', fg: 'white', bold: true },
      item: { fg: 'white', hover: { bg: 'gray' } },
    },
    items: [],
  });

  const card = blessed.box({
    parent: screen,
    top: CARD_TOP,
    left: MAIN_LEFT,
    width: MAIN_WIDTH,
    height: LAYOUT.cardHeight,
    tags: true,
    label: ' selected project ',
    border: { type: 'line' },
    style: { border: { fg: 'gray' }, label: { fg: 'white' }, fg: 'white' },
  });

  const logBox = contrib.log({
    parent: screen,
    top: PANEL_TOP,
    left: MAIN_LEFT,
    width: MAIN_WIDTH,
    bottom: LAYOUT.footerHeight,
    label: ' dev server logs ',
    tags: true,
    border: { type: 'line' },
    bufferLength: 600,
    // The widget renders items top-down; LogView handles scroll-back itself.
    keys: false,
    mouse: false,
    interactive: false,
    style: {
      border: { fg: 'gray' },
      label: { fg: 'white' },
      fg: 'white',
      item: { fg: 'white' },
      selected: { fg: 'white', bg: 'black' },
    },
  });

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: LAYOUT.footerHeight,
    tags: true,
    style: { fg: 'white', bg: 'blue' },
    content: HINTS,
  });

  const logView = new LogView(logBox, {
    maxLines: 800,
    flushInterval: 120,
    viewportHeight: () => Math.max(1, screen.rows - PANEL_TOP - LAYOUT.footerHeight - 2),
    onChange: () => screen.render(),
    label: ' dev server logs ',
  });

  /**
   * The three CTAs: real blessed buttons. They are clickable (`mouse: true`
   * wires click -> press), answer to space/enter when focused, light up on
   * hover/focus, and each shows its own keyboard shortcut. `autoFocus: false`
   * keeps keyboard focus on the project list until the user Tabs to a button.
   */
  function makeButton({ left, width, label, hint, color, onPress }) {
    const button = blessed.button({
      parent: screen,
      top: BUTTON_TOP,
      left,
      width,
      height: LAYOUT.buttonHeight,
      content: `{bold}${label}{/bold} {gray-fg}(${hint}){/gray-fg}`,
      align: 'center',
      valign: 'middle',
      tags: true,
      mouse: true,
      clickable: true,
      autoFocus: false, // keep keyboard focus on the project list
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: color,
        bold: true,
        border: { fg: color },
        hover: { bg: 'lightwhite', fg: 'black', bold: true },
        focus: { bg: 'lightwhite', fg: 'black', bold: true },
      },
    });

    button.on('press', () => {
      try {
        onPress();
      } catch (err) {
        setStatus(`Error: ${err.message}`);
      } finally {
        // blessed's Button.press() focuses the button before emitting `press`;
        // hand focus back so the arrow keys keep working after activation.
        projectList.focus();
        screen.render();
      }
    });

    return button;
  }

  const buttons = {
    dev: makeButton({ left: MAIN_LEFT, width: '23%', label: '▶  Dev Server', hint: 'd', color: 'green', onPress: () => startDevServer() }),
    editor: makeButton({ left: '53%', width: '23%', label: '</>  Editor', hint: 'e', color: 'blue', onPress: () => openTool('editor') }),
    agent: makeButton({ left: '76%', width: '24%', label: '☕  Agent', hint: 'a', color: 'magenta', onPress: () => openTool('agent') }),
  };

  /* ---------------------------------------------------------------- *
   * Dev servers
   * ---------------------------------------------------------------- */

  const servers = new DevServerManager({
    devCommand: config.devCommand,
    autoOpenBrowser: options.autoOpen !== undefined ? options.autoOpen : config.openBrowser !== false,
    fallbackPort: config.fallbackPort || 3000,
    onLog: (project, line, stream) => appendLog(project, line, stream),
    onState: (project, state) => {
      runStates.set(project.path, state);
      refreshList();
      updateCard();
    },
    onExit: (project, info) => {
      const detail = info.code === null || info.code === undefined ? `signal ${info.signal}` : `exit code ${info.code}`;
      appendLog(project, `{gray-fg}dev server stopped (${detail}){/gray-fg}`, 'system');
      refreshList();
      updateCard();
    },
  });

  /* ---------------------------------------------------------------- *
   * Rendering helpers
   * ---------------------------------------------------------------- */

  function listItems() {
    // Wide enough for the longest status tag, "[Experimental]".
    const statusWidth = 14;
    const inner = Math.max(12, Math.floor(screen.cols * SIDEBAR_WIDTH_PCT) - 3);
    const nameWidth = Math.max(6, inner - statusWidth - 2);

    return projects.map((project) => {
      const color = STATUS_COLORS[project.status] || 'white';
      const state = runStates.get(project.path);
      const running = state && (state.status === 'running' || state.status === 'starting');
      const dot = running
        ? state.status === 'running'
          ? '{green-fg}●{/green-fg}'
          : '{yellow-fg}●{/yellow-fg}'
        : '{gray-fg}○{/gray-fg}';
      const name = escapeBraces(truncate(project.name, nameWidth));
      return `${dot} ${name} {${color}-fg}[${project.status}]{/${color}-fg}`;
    });
  }

  function devStateLine(project, state) {
    if (state && (state.status === 'running' || state.status === 'starting')) {
      const where = state.url ? ` \u2192 ${escapeBraces(state.url)}` : ' \u2014 waiting for a localhost URL\u2026';
      return ` {green-fg}● dev server ${state.status} (pid ${state.pid}){/green-fg}${where}`;
    }
    if (state && state.status === 'error') {
      return ` {red-fg}● ${escapeBraces(truncate(state.error || 'failed to start', 60))}{/red-fg}`;
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
    const color = STATUS_COLORS[project.status] || 'white';
    const inner = Math.max(20, Math.floor(screen.cols * (1 - SIDEBAR_WIDTH_PCT)) - 4);

    const lines = [
      ` {bold}${escapeBraces(truncate(project.name, 40))}{/bold}   {${color}-fg}{bold}● ${project.status}{/bold}{/${color}-fg}`,
      ` {gray-fg}${escapeBraces(truncate(project.path, inner))}{/gray-fg}`,
      ` ${escapeBraces(truncate(project.info || '(no description)', inner - 2))}`,
      ` {gray-fg}editor:{/gray-fg} ${escapeBraces(project.editorCommand || config.editorCommand)}   {gray-fg}agent:{/gray-fg} ${escapeBraces(project.agentCommand || config.agentCommand)}`,
      devStateLine(project, state),
    ];

    card.setContent(lines.join('\n'));
    card.setLabel(` ${project.name} `);
    screen.render();
  }

  function updateHeader() {
    const running = servers.runningCount;
    header.setContent(
      ` {bold}termdeck{/bold}  {gray-fg}${projects.length} project${projects.length === 1 ? '' : 's'} · ${escapeBraces(config.root)}{/gray-fg}` +
        `${running ? `   {green-fg}● ${running} dev server${running === 1 ? '' : 's'} running{/green-fg}` : ''}`
    );
  }

  function refreshList() {
    const selected = projectList.selected;
    projectList.setItems(listItems());
    if (typeof selected === 'number' && selected < projects.length) projectList.select(selected);
    updateHeader();
    screen.render();
  }

  function selectedProject() {
    if (!projects.length) return null;
    const index = Math.min(Math.max(projectList.selected || 0, 0), projects.length - 1);
    return projects[index];
  }

  function setStatus(message) {
    if (status.timer) clearTimeout(status.timer);
    status.message = message;
    footer.setContent(` {bold}${escapeBraces(message)}{/bold}`);
    screen.render();

    status.timer = setTimeout(() => {
      status.message = null;
      footer.setContent(HINTS);
      screen.render();
    }, 6000);
    if (status.timer.unref) status.timer.unref();
  }

  /** Log lines from child processes are raw text -> escape blessed markup. */
  function appendLog(project, line, stream = 'stdout') {
    const prefix = `{gray-fg}${timestamp()}{/gray-fg} {${colorFor(project)}-fg}${escapeBraces(truncate(project.name, 10))}{/${colorFor(project)}-fg}`;
    if (stream === 'system') {
      // Already contains termdeck's own blessed tags.
      logView.push(`${prefix} {cyan-fg}[termdeck]{/cyan-fg} ${line}`);
      return;
    }
    const marker = stream === 'stderr' ? '{red-fg}✗{/red-fg} ' : '';
    logView.push(`${prefix} ${marker}${escapeBraces(line)}`);
  }

  /* ---------------------------------------------------------------- *
   * Actions (the CTAs)
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
      appendLog(project, `logs are streaming into this pane — press x to stop`, 'system');
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

    const command = kind === 'editor'
      ? project.editorCommand || config.editorCommand
      : project.agentCommand || config.agentCommand;

    setStatus(`Opening ${kind} for ${project.name} in a new terminal window\u2026`);
    appendLog(project, `opening ${kind} in a new terminal: ${escapeBraces(command)}`, 'system');

    const result = await openInNewTerminal({ cwd: project.path, command });

    if (result.ok) {
      appendLog(project, `{green-fg}new ${escapeBraces(result.terminal)} window \u2192 ${escapeBraces(project.path)}{/green-fg}`, 'system');
      setStatus(`Opened ${kind} in a new terminal window.`);
    } else {
      appendLog(project, `{red-fg}could not open a terminal: ${escapeBraces(result.error)}{/red-fg}`, 'system');
      setStatus(`Could not open a terminal for ${project.name}.`);
    }
    return result;
  }

  function reloadConfig() {
    const fresh = loadConfig();
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

    // Drop run states for projects that are gone.
    for (const key of [...runStates.keys()]) {
      if (!projects.some((p) => p.path === key)) runStates.delete(key);
    }

    rebuildPalette();
    projectList.select(0);
    refreshList();
    updateCard();
    setStatus(`Reloaded ${projects.length} projects from ${config.root}`);
  }

  function destroy() {
    if (status.timer) clearTimeout(status.timer);
    if (status.quitTimer) clearTimeout(status.quitTimer);
    logView.destroy();
    servers.stopAll();
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
        footer.setContent(HINTS);
        screen.render();
      }, 4000);
      return;
    }

    destroy();
    process.exit(0);
  }

  /* ---------------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------------- */

  const selectProject = (item, index) => {
    if (typeof index === 'number') updateCard();
  };

  // `select item` fires on arrow navigation and mouse clicks,
  // `select`/`action` fire when pressing enter.
  projectList.on('select item', selectProject);
  projectList.on('select', selectProject);
  projectList.on('action', selectProject);
  projectList.on('cancel', () => updateCard());

  screen.key(['q', 'C-c'], quit);
  screen.key(['d'], () => startDevServer());
  screen.key(['e'], () => openTool('editor'));
  screen.key(['a'], () => openTool('agent'));
  screen.key(['x'], () => stopDevServer());
  screen.key(['r'], () => reloadConfig());
  screen.key(['j'], () => projectList.down(1));
  screen.key(['k'], () => projectList.up(1));
  // Tab cycles keyboard focus across the list and the three CTAs; the focused
  // CTA lights up and answers to space/enter.
  screen.key(['tab'], () => screen.focusNext());
  screen.key(['S-tab'], () => screen.focusPrevious());
  // NOTE: blessed reports uppercase letters as `S-g`, so 'G' alone never fires.
  screen.key(['S-g', 'end'], () => logView.followTail());
  screen.key(['pageup'], () => logView.page(-1));
  screen.key(['pagedown'], () => logView.page(1));
  screen.key(['S-pageup', 'home'], () => logView.scrollTop());

  // Mouse wheel scrolls the log pane, no matter what the cursor is over.
  screen.on('wheelup', () => logView.scrollUp(3));
  screen.on('wheeldown', () => logView.scrollDown(3));

  // Never let a stray exception leave orphan dev servers behind.
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
  appendLog({ name: 'termdeck', path: '__termdeck__' }, `{bold}termdeck{/bold} ready — ${projects.length} projects from ${escapeBraces(config.root)}`, 'system');
  appendLog({ name: 'termdeck', path: '__termdeck__' }, `pick a project and press {bold}d{/bold} for the dev server, {bold}e{/bold} for your editor, {bold}a{/bold} for an agent.`, 'system');
  screen.render();

  return {
    screen,
    widgets: { header, projectList, card, logBox, footer, buttons },
    servers,
    logView,
    runStates,
    // Transient footer toast; lets non-dashboard code (the auto-updater) talk
    // to the user without ever writing to the terminal behind blessed.
    updateStatus: setStatus,
    actions: { startDevServer, stopDevServer, openTool, reloadConfig, quit, destroy, selectedProject },
  };
}

module.exports = { launchDashboard, LAYOUT, HINTS };
