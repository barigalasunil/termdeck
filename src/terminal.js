'use strict';

/**
 * Opening a *brand new* OS terminal window in a project folder.
 *
 * Termdeck never opens a terminal for the dev server (those logs are piped into
 * the TUI) \u2014 this module is only used for the "Open Editor" / "Open Agent"
 * CTAs, where a real interactive shell is what the user wants.
 */

const crossSpawn = require('cross-spawn');
const { which, shellQuote, appleScriptString } = require('./util');

/** Commands that are shell built-ins / launch a terminal window. */
function buildTerminalCandidates({ cwd, command, platform = process.platform }) {
  const candidates = [];
  // Keeps the window open after the command exits, so errors stay readable.
  const keepOpen = `${command}; exec bash`;

  if (platform === 'darwin') {
    const shellCommand = `cd ${shellQuote(cwd)} && ${command}`;
    const script = [
      'tell application "Terminal"',
      '  activate',
      `  do script ${appleScriptString(shellCommand)}`,
      'end tell',
    ];
    const args = [];
    script.forEach((line) => args.push('-e', line));

    candidates.push({
      id: 'macos-terminal',
      bin: 'osascript',
      args,
      available: true,
    });
    return candidates;
  }

  if (platform === 'win32') {
    // Windows Terminal first (prettier + tab support), then a plain console.
    candidates.push({
      id: 'windows-terminal',
      bin: 'wt.exe',
      args: ['-d', cwd, 'cmd', '/k', command],
      available: Boolean(which('wt.exe')),
    });

    candidates.push({
      id: 'cmd-start',
      bin: process.env.ComSpec || 'cmd.exe',
      // NOTE: windowsVerbatimArguments means we do our own quoting here. `/D`
      // sets the working directory of the new window, and `start ""` supplies
      // the required (empty) window title.
      args: ['/c', 'start', '""', '/D', `"${cwd}"`, 'cmd.exe', '/k', `"${command}"`],
      verbatim: true,
      available: true,
    });
    return candidates;
  }

  // Linux / BSD: try every common emulator, in order of popularity.
  const emulators = [
    { id: 'gnome-terminal', bin: 'gnome-terminal', args: ['--working-directory', cwd, '--', 'bash', '-lc', keepOpen] },
    { id: 'konsole', bin: 'konsole', args: ['--workdir', cwd, '-e', 'bash', '-lc', keepOpen] },
    { id: 'xfce4-terminal', bin: 'xfce4-terminal', args: ['--working-directory', cwd, '-x', 'bash', '-lc', keepOpen] },
    { id: 'kitty', bin: 'kitty', args: ['--directory', cwd, 'bash', '-lc', keepOpen] },
    { id: 'alacritty', bin: 'alacritty', args: ['--working-directory', cwd, '-e', 'bash', '-lc', keepOpen] },
    { id: 'wezterm', bin: 'wezterm', args: ['start', '--cwd', cwd, '--', 'bash', '-lc', keepOpen] },
    {
      id: 'x-terminal-emulator',
      bin: 'x-terminal-emulator',
      args: ['-e', 'bash', '-lc', `cd ${shellQuote(cwd)} && ${keepOpen}`],
    },
    {
      id: 'xterm',
      bin: 'xterm',
      args: ['-e', 'bash', '-lc', `cd ${shellQuote(cwd)} && ${keepOpen}`],
    },
  ];

  emulators.forEach((emulator) => {
    candidates.push({ ...emulator, available: Boolean(which(emulator.bin)) });
  });

  return candidates;
}

/** Human readable form of a candidate, for logs and `--dry-run`. */
function formatTerminalCommand(candidate) {
  if (!candidate) return '';
  const args = candidate.args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg));
  return `${candidate.bin} ${args.join(' ')}`.trim();
}

/** Put a user-preferred emulator (TERMDECK_TERMINAL) at the front of the list. */
function applyPreference(candidates, prefer) {
  if (!prefer) return candidates;
  const wanted = String(prefer).toLowerCase();
  const index = candidates.findIndex(
    (c) => c.id.toLowerCase() === wanted || c.bin.toLowerCase() === wanted || c.bin.toLowerCase().startsWith(wanted)
  );
  if (index <= 0) return candidates;
  const preferred = candidates[index];
  return [preferred, ...candidates.filter((_, i) => i !== index)];
}

/** Resolve when the child actually started; reject on ENOENT/EPERM. */
function waitForSpawn(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onError);
      fn(value);
    };
    const onSpawn = () => finish(resolve);
    const onError = (err) => finish(reject, err);
    const timer = setTimeout(() => finish(reject, new Error('timed out starting terminal')), timeoutMs);
    if (timer.unref) timer.unref();

    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

/**
 * Spawn a new OS terminal window, cd into `cwd` and run `command` there.
 *
 * @returns {Promise<{ok: boolean, terminal?: string, command?: string, error?: string}>}
 */
async function openInNewTerminal({ cwd, command, platform = process.platform, prefer = process.env.TERMDECK_TERMINAL, dryRun = false }) {
  const candidates = applyPreference(buildTerminalCandidates({ cwd, command, platform }), prefer);
  const usable = candidates.filter((c) => c.available);

  if (usable.length === 0) {
    return {
      ok: false,
      error: `No terminal emulator found. Tried: ${candidates.map((c) => c.id).join(', ')}. Set TERMDECK_TERMINAL to your emulator.`,
    };
  }

  if (dryRun) {
    return { ok: true, terminal: usable[0].id, command: formatTerminalCommand(usable[0]), dryRun: true };
  }

  const errors = [];
  for (const candidate of usable) {
    try {
      const child = crossSpawn(candidate.bin, candidate.args, {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: candidate.verbatim === true,
      });
      await waitForSpawn(child);
      // A late failure must never crash the TUI.
      child.on('error', () => {});
      child.unref();
      return { ok: true, terminal: candidate.id, command: formatTerminalCommand(candidate) };
    } catch (err) {
      errors.push(`${candidate.id}: ${err.message}`);
    }
  }

  return { ok: false, error: errors.join(' | ') };
}

module.exports = {
  buildTerminalCandidates,
  formatTerminalCommand,
  openInNewTerminal,
};
