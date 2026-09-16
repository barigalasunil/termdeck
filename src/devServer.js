'use strict';

/**
 * Dev server manager.
 *
 * Each project gets at most one running `npm run dev` child process. stdout and
 * stderr are piped back to the caller (the TUI log pane) instead of being
 * attached to a terminal, and the first localhost URL found in the output is
 * opened in the default browser.
 */

const open = require('open');
const crossSpawn = require('cross-spawn');
const { extractLocalUrl, splitLines, stripAnsi, killTree } = require('./util');

const DEFAULT_DEV_COMMAND = 'npm run dev';

/** Fallback browser launcher (injectable so tests never open a real browser). */
async function defaultOpenBrowser(url) {
  await open(url);
}

function parseCommand(command) {
  const parts = String(command || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return { bin: parts[0], args: parts.slice(1) };
}

class DevServerManager {
  /**
   * @param {object} options
   * @param {function} options.onLog    (project, line, stream) => void
   * @param {function} options.onState  (project, state) => void
   * @param {function} options.onExit   (project, {code, signal, stoppedByUs, restart, attempt, max}) => void
   * @param {function} options.openBrowser (url, project) => Promise<void>
   * @param {number} [options.maxRestarts=3]   auto-restart attempts after a crash
   * @param {number} [options.restartDelayMs]  pause before an auto-restart
   */
  constructor(options = {}) {
    this.onLog = options.onLog || (() => {});
    this.onState = options.onState || (() => {});
    this.onExit = options.onExit || (() => {});
    this.openBrowser = options.openBrowser || defaultOpenBrowser;
    this.devCommand = options.devCommand || DEFAULT_DEV_COMMAND;
    this.fallbackPort = options.fallbackPort || 3000;
    // How long to wait for the process to print a URL before guessing one.
    this.urlFallbackDelayMs = options.urlFallbackDelayMs || 9000;
    // Give the HTTP listener a moment to bind before the browser hits it.
    this.browserDelayMs = options.browserDelayMs || 1200;
    this.servers = new Map();
    this.lastExit = new Map();
    this.autoOpenBrowser = options.autoOpenBrowser !== false;
    this.autoRestart = options.autoRestart !== false;
    this.maxRestarts = options.maxRestarts == null ? 3 : options.maxRestarts;
    this.restartDelayMs = options.restartDelayMs || 1200;
    this.restartCounts = new Map();
  }

  /** @returns {object|undefined} running entry for a project path */
  get(projectPath) {
    return this.servers.get(projectPath);
  }

  isRunning(projectPath) {
    return this.servers.has(projectPath);
  }

  get runningCount() {
    return this.servers.size;
  }

  /**
   * Start a project's dev server.
   * @returns {{ok: boolean, entry?: object, error?: string, alreadyRunning?: boolean}}
   */
  start(project, options = {}) {
    if (this.servers.has(project.path)) {
      return { ok: false, alreadyRunning: true, entry: this.servers.get(project.path), error: 'already running' };
    }

    const command = options.command || project.devCommand || this.devCommand;
    const { bin, args } = parseCommand(command);
    if (!bin) return { ok: false, error: `No dev command configured for ${project.name}.` };

    const entry = {
      project,
      command,
      child: null,
      url: null,
      urlGuess: false,
      status: 'starting',
      startedAt: Date.now(),
      browserOpened: false,
      stopping: false,
      timers: [],
    };

    let child;
    try {
      child = crossSpawn(bin, args, {
        cwd: project.path,
        env: {
          ...process.env,
          // Keep output plain so it renders cleanly inside the TUI log pane,
          // and stop frameworks from opening their own browser tab.
          FORCE_COLOR: '0',
          BROWSER: 'none',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // Own process group on POSIX so we can kill the whole tree.
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    entry.child = child;
    entry.pid = child.pid;
    this.servers.set(project.path, entry);
    this.log(project, `{bold}$${escapeTags(command)}{/bold}  (cwd: ${project.path})`, 'system');

    const carryOut = { rest: '' };
    const carryErr = { rest: '' };

    child.stdout.on('data', (chunk) => this.handleChunk(entry, chunk, carryOut, 'stdout'));
    child.stderr.on('data', (chunk) => this.handleChunk(entry, chunk, carryErr, 'stderr'));

    child.on('error', (err) => {
      if (this.servers.get(project.path) === entry) this.servers.delete(project.path);
      entry.status = 'error';
      entry.error = err.message;
      this.clearTimers(entry);
      this.state(project, { status: 'error', pid: entry.pid, url: entry.url, error: err.message });
      this.log(project, `{red-fg}cannot start "${command}": ${escapeTags(err.message)}{/red-fg}`, 'system');
    });

    child.on('exit', (code, signal) => {
      const stoppedByUs = entry.stopping;
      if (this.servers.get(project.path) === entry) this.servers.delete(project.path);
      this.clearTimers(entry);
      entry.status = 'stopped';
      this.lastExit.set(project.path, { code, signal, at: Date.now(), stoppedByUs });
      this.state(project, { status: 'stopped', pid: entry.pid, url: entry.url, code, signal });

      // The process died on its own (a crash), not because we stopped it:
      // bring it straight back up, up to maxRestarts times, as long as neither
      // the global setting nor the project says otherwise.
      if (!stoppedByUs && this.shouldRestart(project)) {
        const attempt = this.restartCounts.get(project.path);
        const detail = signal ? `signal ${signal}` : `exit code ${code}`;
        this.log(
          project,
          `{yellow-fg}dev server exited (${detail}) — auto-restarting ({bold}${attempt}/${this.maxRestarts}{/bold})\u2026{/yellow-fg}`,
          'system'
        );
        this.onExit(project, { code, signal, stoppedByUs, restart: true, attempt, max: this.maxRestarts });
        const timer = setTimeout(() => {
          if (this.servers.has(project.path)) return;
          this.log(project, `{cyan-fg}[termdeck]{/cyan-fg} auto-restarting dev server`, 'system');
          this.start(project);
        }, this.restartDelayMs);
        if (timer.unref) timer.unref();
        entry.timers.push(timer);
      } else {
        this.onExit(project, { code, signal, stoppedByUs });
      }
    });

    this.state(project, { status: 'starting', pid: entry.pid, url: null });

    // Some dev servers are silent: fall back to an assumed port.
    entry.timers.push(
      setTimeout(() => {
        if (!entry.url && this.servers.get(project.path) === entry) {
          const port = project.port || this.fallbackPort;
          this.log(
            project,
            `{yellow-fg}no localhost URL in the logs after ${Math.round(this.urlFallbackDelayMs / 1000)}s \u2014 assuming http://localhost:${port}{/yellow-fg}`,
            'system'
          );
          this.handleUrl(entry, `http://localhost:${port}`, { guessed: true });
        }
      }, this.urlFallbackDelayMs)
    );

    return { ok: true, entry };
  }

  /**
   * True when a crashed dev server should be restarted: auto-restart is
   * enabled (globally and for this project) and the restart budget remains.
   */
  restartAvailable(project) {
    if (!this.autoRestart) return false;
    if (project && project.autoRestart === false) return false;
    if (this.maxRestarts <= 0) return false;
    return true;
  }

  shouldRestart(project) {
    if (!this.restartAvailable(project)) return false;
    const attempts = (this.restartCounts.get(project.path) || 0) + 1;
    if (attempts > this.maxRestarts) return false;
    this.restartCounts.set(project.path, attempts);
    return true;
  }

  /** Consume raw stream data: split lines, look for the first local URL. */
  handleChunk(entry, chunk, carry, stream) {
    const lines = splitLines(chunk.toString('utf8'), carry);
    for (const raw of lines) {
      const line = stripAnsi(raw).replace(/\s+$/, '');
      if (!line.trim()) continue;
      if (!entry.url) {
        const found = extractLocalUrl(line);
        if (found) this.handleUrl(entry, found);
      }
      this.log(entry.project, line, stream);
    }
  }

  handleUrl(entry, url, { guessed = false } = {}) {
    if (entry.url) return;
    entry.url = url;
    entry.urlGuess = guessed;
    entry.status = 'running';
    // The server proved healthy — restore the crash-restart budget.
    this.restartCounts.delete(entry.project.path);
    this.state(entry.project, { status: 'running', pid: entry.pid, url, guessed });

    if (!this.autoOpenBrowser || entry.browserOpened) return;
    entry.browserOpened = true;

    const timer = setTimeout(async () => {
      if (this.servers.get(entry.project.path) !== entry) return;
      try {
        await this.openBrowser(url, entry.project);
        this.log(entry.project, `{green-fg}opened ${url} in your browser{/green-fg}`, 'system');
      } catch (err) {
        this.log(entry.project, `{yellow-fg}could not open a browser (${escapeTags(err.message)}) \u2014 visit ${url}{/yellow-fg}`, 'system');
      }
    }, guessed ? 0 : this.browserDelayMs);
    entry.timers.push(timer);
  }

  /** Stop one dev server (and its children). */
  stop(projectPath) {
    const entry = this.servers.get(projectPath);
    if (!entry) return false;
    entry.stopping = true;
    this.clearTimers(entry);
    this.servers.delete(projectPath);
    this.state(entry.project, { status: 'stopped', pid: entry.pid, url: entry.url });
    killTree(entry.child);
    return true;
  }

  /** Stop everything \u2014 called when the TUI quits. */
  stopAll() {
    const paths = [...this.servers.keys()];
    paths.forEach((projectPath) => this.stop(projectPath));
    return paths.length;
  }

  clearTimers(entry) {
    entry.timers.forEach((timer) => clearTimeout(timer));
    entry.timers = [];
  }

  state(project, state) {
    try {
      this.onState(project, state);
    } catch (_) {
      /* never let a render error kill a child process */
    }
  }

  log(project, line, stream) {
    try {
      this.onLog(project, line, stream);
    } catch (_) {
      /* ignore */
    }
  }
}

/** blessed treats `{`/`}` as markup \u2014 escape command strings for the log pane. */
function escapeTags(text) {
  return String(text == null ? '' : text).replace(/\{/g, '{open}').replace(/\}/g, '{close}');
}

module.exports = { DevServerManager, DEFAULT_DEV_COMMAND, defaultOpenBrowser, parseCommand };
