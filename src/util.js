'use strict';

/**
 * Small shared helpers used across termdeck.
 *
 * Everything in here is intentionally dependency free and side-effect free so it
 * can be unit tested without a terminal (see test/run.js).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/* ------------------------------------------------------------------ *
 * Terminal output helpers
 * ------------------------------------------------------------------ */

// Covers CSI sequences (\x1b[...m), OSC sequences (\x1b]...\x07) and the
// `ESC ( B` style charset selects that npm/vite sometimes emit.
const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z0-9]*(?:;[-a-zA-Z0-9\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

/** Remove ANSI colour/control codes from a chunk of terminal output. */
function stripAnsi(input) {
  return String(input == null ? '' : input).replace(ANSI_RE, '');
}

/**
 * Escape `{`/`}` for blessed's tag parser. Blessed treats `{red-fg}` as markup,
 * so raw log output (JSON, JSX, template literals...) has to be escaped or it
 * renders as garbage. `{open}`/`{close}` are blessed's literal brace tags.
 */
function escapeBraces(text) {
  // Single pass: replacing `{` first would then rewrite the `}` of the
  // `{open}` tag we just inserted.
  return String(text == null ? '' : text).replace(/[{}]/g, (ch) => (ch === '{' ? '{open}' : '{close}'));
}

/** Truncate plain text to `width` characters, adding an ellipsis when cut. */
function truncate(text, width) {
  const str = String(text == null ? '' : text);
  if (!Number.isFinite(width) || width <= 1) return str;
  if (str.length <= width) return str;
  return str.slice(0, Math.max(0, width - 1)) + '\u2026';
}

/** Right-pad/left-pad a label to a fixed width. */
function padEnd(text, width) {
  const str = String(text == null ? '' : text);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

/** `HH:MM:SS` timestamp for log lines. */
function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/* ------------------------------------------------------------------ *
 * Dev-server output parsing
 * ------------------------------------------------------------------ */

const URL_RE = /https?:\/\/[^\s"'`<>()[\]{}|\\^]+/gi;
const HOST_PORT_RE = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\s*:\s*(\d{2,5})\b/i;
// Last-resort: "Port 3000", "port: 5173", "using port 8080".
const PORT_RE = /\bport\b[^\d\n]{0,24}?(\d{2,5})\b/i;
const LOCAL_HOSTS = /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

/** `http://0.0.0.0:3000/` -> `http://localhost:3000`. */
function normalizeLocalUrl(url) {
  return String(url == null ? '' : url)
    .trim()
    .replace(/\/\/(0\.0\.0\.0)/, '//localhost')
    .replace(/\/\/(\[::1\]|::1)/, '//localhost')
    .replace(/[.,;:)\]}'"`]+$/, '')
    .replace(/\/+$/, '');
}

/**
 * Pull the first "local" URL out of a line of dev-server output.
 * Returns null when the line does not advertise a local address.
 */
function extractLocalUrl(text) {
  const clean = stripAnsi(text);

  const urls = clean.match(URL_RE);
  if (urls) {
    for (const raw of urls) {
      const candidate = raw.replace(/[.,;:)\]}'"`]+$/, '');
      if (LOCAL_HOSTS.test(candidate)) return normalizeLocalUrl(candidate);
    }
  }

  const hostPort = clean.match(HOST_PORT_RE);
  if (hostPort) return normalizeLocalUrl(`http://${hostPort[1]}:${hostPort[2]}`);

  const port = clean.match(PORT_RE);
  if (port) return `http://localhost:${port[1]}`;

  return null;
}

/**
 * Split a stream chunk into complete lines, keeping the unfinished tail in
 * `carry` (mutated in place so callers can pipe chunks straight through).
 */
function splitLines(chunk, carry = { rest: '' }) {
  carry.rest += String(chunk == null ? '' : chunk);
  const parts = carry.rest.split(/\r\n|\n|\r/);
  carry.rest = parts.pop();
  return parts.filter((line) => line.trim() !== '');
}

/* ------------------------------------------------------------------ *
 * OS helpers
 * ------------------------------------------------------------------ */

/**
 * Minimal `which(1)`: look a binary up on PATH.
 * Avoids spawning a child process just to test for an executable.
 */
function which(bin, env = process.env) {
  if (!bin) return null;
  const exts = process.platform === 'win32'
    ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const hasExt = path.extname(bin) !== '';

  for (const dir of dirs) {
    for (const ext of hasExt ? [''] : exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch (_) {
        /* keep looking */
      }
    }
  }
  return null;
}

/** POSIX single-quote a value so it survives a shell round trip. */
function shellQuote(value) {
  return `'${String(value == null ? '' : value).replace(/'/g, `'\\''`)}'`;
}

/** Quote a value for embedding inside an AppleScript string literal. */
function appleScriptString(value) {
  return `"${String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')}"`;
}

/**
 * Kill a child process *and* its children (npm -> node -> vite, etc).
 * Windows needs `taskkill /T`; on POSIX we spawn the tree detached and kill the
 * whole process group.
 */
function killTree(child, { signal = 'SIGTERM' } = {}) {
  if (!child || child.pid == null) return false;
  if (child.exitCode !== null || child.signalCode) return false;

  const pid = child.pid;

  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return true;
    } catch (_) {
      try {
        child.kill();
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  try {
    process.kill(-pid, signal);
  } catch (_) {
    try {
      child.kill(signal);
    } catch (_) {
      return false;
    }
  }

  // Escalate if the dev server ignores SIGTERM. `unref` keeps this timer from
  // holding the process open.
  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode) return;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }, 3000);
  if (timer.unref) timer.unref();

  return true;
}

module.exports = {
  stripAnsi,
  escapeBraces,
  truncate,
  padEnd,
  timestamp,
  normalizeLocalUrl,
  extractLocalUrl,
  splitLines,
  which,
  shellQuote,
  appleScriptString,
  killTree,
};
