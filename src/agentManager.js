'use strict';

/**
 * agentManager - launch and track the built-in coding agents.
 *
 * Five interactive CLI agents are supported out of the box:
 *
 *   claude  ·  codex  ·  opencode  ·  freebuff  ·  kilocode
 *
 * Agents are *always* interactive: they run in a brand new detached terminal
 * window (via terminal.openInNewTerminal) inside the project folder, never in
 * the TUI. When a `tee` binary is available the agent command is piped through
 * it into a per-project log file, and that file can be tailed back into the
 * dashboard's OUTPUT pane with tailAgentLog(). On systems without tee the
 * agent still launches; only the log capture is skipped.
 *
 * Every function degrades silently (returns a null/&lt;ok:false&gt; shape) so a
 * missing binary, a locked logfile or a deleted project never crashes the TUI.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { which } = require('./util');
const { openInNewTerminal } = require('./terminal');

/** The agents the dashboard offers a button/hotkey for. */
const AGENT_COMMANDS = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  freebuff: 'freebuff',
  kilocode: 'kilocode',
};

/** Per-newest-session tail state: key -> { watcher, lastSize, offset }. */
const tailing = new Map();

/** Log files live under ~/.termdeck/agents so tee writes always succeed. */
function logDir() {
  return path.join(os.homedir(), '.termdeck', 'agents');
}

/** project.name + agent -> a filesystem-safe log file name. */
function logFileName(project, agentName) {
  const base = `${String(project.name || 'project').replace(/[^a-zA-Z0-9._-]+/g, '_')}-${String(agentName)}`;
  return `${base}.log`;
}

function logFilePath(project, agentName) {
  return path.join(logDir(), logFileName(project, agentName));
}

/** `claude | tee -a <file>` — or just the bare command on systems without tee. */
function buildAgentCommand(project, agentName, { platform = process.platform } = {}) {
  const command = (project.agents && project.agents[agentName]) || AGENT_COMMANDS[agentName] || agentName;
  if (platform !== 'win32' || which('tee.exe')) {
    fs.mkdirSync(logDir(), { recursive: true });
    return { command: `${command} 2>&1 | tee -a ${shellSafe(logFilePath(project, agentName))}`, logFile: logFilePath(project, agentName) };
  }
  return { command, logFile: logFilePath(project, agentName) };
}

/** Quote a path for the POSIX side of a pipe. */
function shellSafe(filePath) {
  return `"${String(filePath).replace(/"/g, '\\"')}"`;
}

/**
 * Launch an agent for a project in a new terminal window.
 *
 * @param {object}   project
 * @param {string}   agentName   one of claude / codex / opencode / freebuff / kilocode
 * @param {object}   [options]   { terminal: fn, platform, dryRun }
 * @returns {Promise<{ok:boolean, terminal?:string, command?:string, logFile?:string, error?:string}>}
 */
async function launchAgent(project, agentName, options = {}) {
  if (!project || !project.path) return { ok: false, error: 'no project to launch an agent in' };
  if (!AGENT_COMMANDS[agentName]) return { ok: false, error: `unknown agent "${agentName}"` };

  const launch = options.terminal || openInNewTerminal;
  const capable = options.platform || process.platform;
  const wrapper = buildAgentCommand(project, agentName, { platform: capable });
  const base = { logFile: wrapper.logFile };

  // Test hook: hand back the exact command we would run, nothing is spawned.
  if (options.commandOnly) return { ...base, command: wrapper.command };

  try {
    const result = await launch({ cwd: project.path, command: wrapper.command, platform: capable });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, terminal: result.terminal, command: result.command, logFile: wrapper.logFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Start reading `project`'s agent log file, streaming appended lines (trimmed)
 * to `callback`. Rotates to a fresh tail when the file is recreated. Returns a
 * stop function; calling it (or stopAgent) unwatches the file.
 */
function tailAgentLog(project, agentName, callback, options = {}) {
  const key = tailKey(project, agentName);
  const file = path.join(options.logDir || logDir(), logFileName(project, agentName));
  if (!callback || typeof callback !== 'function') return () => {};
  stopAgent(project, agentName, { logDir: options.logDir });

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch (_) {
    return () => {};
  }

  const state = { file, size: safeSize(file), offset: 0, timer: null, lastRead: 0 };
  tailing.set(key, state);

  // fs.watch is flaky across editors/OSes; poll as a cross-platform fallback.
  const tick = () => readTail(state, callback);
  state.timer = setInterval(tick, options.intervalMs || 1000);
  if (state.timer.unref) state.timer.unref();

  try {
    const watcher = fs.watch(file, { persistent: false }, () => readTail(state, callback));
    watcher.on('error', () => {}); // swallow EPERM etc. on Windows temp dirs
  } catch (_) {
    /* polling still covers it */
  }

  return () => stopAgent(project, agentName, { logDir: options.logDir });
}

function tailKey(project, agentName) {
  return `${project.path}\u0000${agentName}`;
}

function safeSize(file) {
  try {
    return fs.statSync(file).size;
  } catch (_) {
    return 0;
  }
}

/** Emit any bytes that appear past the last read position. */
function readTail(state, callback) {
  let fd;
  try {
    const current = safeSize(state.file);
    if (current < state.size) {
      // File was recreated (session closed, new session opened).
      state.offset = 0;
      state.size = current;
    }
    if (current <= state.offset) {
      state.size = current;
      return;
    }

    fd = fs.openSync(state.file, 'r');
    const buffer = Buffer.alloc(current - state.offset);
    fs.readSync(fd, buffer, 0, buffer.length, state.offset);
    state.offset = current;
    state.size = current;

    const text = String(buffer).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) callback(trimmed);
    }
  } catch (_) {
    /* file not readable yet — try again on the next tick */
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        /* already closed */
      }
    }
  }
}

/** Stop tailing one project/agent pair (idempotent). */
function stopAgent(project, agentName, options = {}) {
  const key = tailKey(project, agentName);
  const state = tailing.get(key);
  if (!state) return false;
  tailing.delete(key);
  if (state.timer) clearInterval(state.timer);
  return true;
}

function stopAllAgents() {
  for (const key of [...tailing.keys()]) {
    const [projectPath, agentName] = key.split('\u0000');
    stopAgent({ path: projectPath }, agentName);
  }
}

function isTailing(project, agentName) {
  return tailing.has(tailKey(project, agentName));
}

/** Number of agent log tails currently being streamed. */
function activeTails() {
  return tailing.size;
}

module.exports = {
  AGENT_COMMANDS,
  activeTails,
  logDir,
  logFileName,
  logFilePath,
  buildAgentCommand,
  launchAgent,
  tailAgentLog,
  stopAgent,
  stopAllAgents,
  isTailing,
};