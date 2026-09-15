'use strict';

/**
 * processMonitor - real-time per-project process stats.
 *
 * Two cheap primitives (find the PID behind a port, then read CPU/memory for
 * that PID) feed a per-project polling interval. The port lookup shells out to
 * `lsof` (macOS/Linux) or `netstat` (Windows); stats come from the `pidusage`
 * package. Every failure path is silent: a missing process, a dead PID or a
 * blocked command yields `null` / a `running: false` report, never a throw, so
 * the TUI can call this on every render tick without fear.
 *
 * All command runners are injectable (`{ spawn, usage }`) so the unit tests
 * cover every branch without a real `lsof`/`netstat` or a live process.
 */

const crossSpawn = require('cross-spawn');
const pidusage = require('pidusage');

const MONITOR_INTERVAL_MS = 2000;

/** per-key interval handles + in-flight guard so ticks never overlap. */
const intervals = new Map();
const inFlight = new Set();

function formatMemory(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatCpu(percent) {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
  return `${percent.toFixed(1)}%`;
}

/**
 * Find the PID listening on `port`, or null when none / the command fails.
 *
 *   macOS/Linux: `lsof -ti :<port>`
 *   Windows:     parse the rows of `netstat -ano` ourselves (avoids a locale-
 *                dependent `findstr` pipe); the PID is the last token of rows
 *                whose local address carries `:<port>`.
 */
function getPIDByPort(port, { spawn = crossSpawn } = {}) {
  if (!port || !Number.isFinite(Number(port))) return null;
  try {
    if (process.platform === 'win32') {
      const result = spawn.sync('netstat', ['-ano'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
      });
      if (!result || result.error || result.status !== 0) return null;
      let firstPid = null;
      for (const rawLine of String(result.stdout).split(/\r?\n/)) {
        const tokens = rawLine.trim().split(/\s+/);
        if (tokens.length < 2) continue;
        const pidToken = tokens[tokens.length - 1];
        if (!/^\d+$/.test(pidToken)) continue;
        if (!tokens.slice(0, -1).some((token) => token.endsWith(`:${port}`) || token === `${port}`)) continue;
        if (firstPid == null) firstPid = Number(pidToken);
      }
      return firstPid;
    }

    const result = spawn.sync('lsof', ['-ti', `:${port}`], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    });
    if (!result || result.error || result.status !== 0) return null;
    const first = String(result.stdout).trim().split(/\r?\n/)[0];
    const pid = Number(first);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (_) {
    return null;
  }
}

/**
 * CPU + memory for a PID, formatted for the UI, or null when the PID is
 * invalid/dead/blocked. Never rejects (the caller in the TUI awaits this).
 */
async function getProcessStats(pid, { usage = pidusage } = {}) {
  if (!pid || !Number.isInteger(Number(pid)) || Number(pid) <= 0) return null;
  try {
    const stats = await usage(pid);
    if (!stats || typeof stats.memory !== 'number') return null;
    const cpu = formatCpu(stats.cpu);
    const memory = formatMemory(stats.memory);
    if (!cpu || !memory) return null;
    return { pid: Number(pid), memory, cpu };
  } catch (_) {
    return null;
  }
}

function monitorKey(project) {
  return project && (project.path || project.id || project.name);
}

/**
 * Start polling `project` every `intervalMs` for its PID/CPU/memory, passing
 * the report to `callback`. Returns a stop function. Silently degrades to
 * `{ running:false }` when the port has no process.
 */
function startMonitoring(project, callback, options = {}) {
  const key = monitorKey(project);
  if (!key || typeof callback !== 'function') return null;
  const getPID = options.getPID || getPIDByPort;
  const getStats = options.getStats || getProcessStats;
  const intervalMs = options.intervalMs != null ? options.intervalMs : MONITOR_INTERVAL_MS;
  const onError = options.onError || (() => {});

  stopMonitoring(key);

  const tick = async () => {
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      const pid = await getPID(project.port);
      if (pid == null) {
        callback({ running: false, pid: null, memory: null, cpu: null });
        return;
      }
      const stats = (await getStats(pid)) || {};
      callback({ running: true, pid, memory: stats.memory || null, cpu: stats.cpu || null });
    } catch (err) {
      onError(err);
    } finally {
      inFlight.delete(key);
    }
  };

  const timer = setInterval(tick, Math.max(50, intervalMs));
  if (timer.unref) timer.unref();
  intervals.set(key, timer);
  tick();
  return () => stopMonitoring(key);
}

/** Stop monitoring a project (pass a project object or its key). */
function stopMonitoring(project) {
  const key = monitorKey(project) || project;
  const timer = intervals.get(key);
  if (timer) {
    clearInterval(timer);
    intervals.delete(key);
  }
  inFlight.delete(key);
}

function stopAllMonitoring() {
  for (const key of [...intervals.keys()]) stopMonitoring(key);
  intervals.clear();
  inFlight.clear();
}

module.exports = {
  MONITOR_INTERVAL_MS,
  formatMemory,
  formatCpu,
  getPIDByPort,
  getProcessStats,
  startMonitoring,
  stopMonitoring,
  stopAllMonitoring,
};