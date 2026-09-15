'use strict';

/**
 * termdeck test suite - no test framework required.
 *
 *   npm test
 *
 * Covers the pure logic (log parsing, URL detection, terminal command plans,
 * the log view) plus one real end-to-end dev server lifecycle using the
 * fixture app in test/fixtures/fake-app.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const util = require('../src/util');
const configModule = require('../src/config');
const { buildTerminalCandidates, formatTerminalCommand, openInNewTerminal } = require('../src/terminal');
const { LogView } = require('../src/logView');
const { DevServerManager, parseCommand } = require('../src/devServer');
const { parseArgs } = require('../src/index');
const updater = require('../src/updater');

const FIXTURE_APP = path.join(__dirname, 'fixtures', 'fake-app');
const TMP_DIR = path.join(__dirname, 'tmp');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 15000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/* ------------------------------------------------------------------ *
 * util
 * ------------------------------------------------------------------ */

test('stripAnsi removes colour codes', () => {
  assert.strictEqual(util.stripAnsi('\u001b[32mready\u001b[0m in \u001b[1m123\u001b[0m ms'), 'ready in 123 ms');
  assert.strictEqual(util.stripAnsi('plain'), 'plain');
});

test('extractLocalUrl finds vite/next/cra style URLs', () => {
  assert.strictEqual(
    util.extractLocalUrl('  \u279c  Local:   http://localhost:5173/'),
    'http://localhost:5173'
  );
  assert.strictEqual(
    util.extractLocalUrl('- ready started server on 0.0.0.0:3000, url: http://localhost:3000'),
    'http://localhost:3000'
  );
  assert.strictEqual(
    util.extractLocalUrl('\u001b[32mLocal:\u001b[0m            http://localhost:3001'),
    'http://localhost:3001'
  );
  assert.strictEqual(util.extractLocalUrl('listening on 127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.strictEqual(util.extractLocalUrl('Server started, using port 4200'), 'http://localhost:4200');
});

test('extractLocalUrl ignores unrelated output', () => {
  assert.strictEqual(util.extractLocalUrl('webpack compiled successfully in 1200 ms'), null);
  assert.strictEqual(util.extractLocalUrl('See https://vitejs.dev/config/ for docs'), null);
  assert.strictEqual(util.extractLocalUrl('ready in 300 ms'), null);
});

test('normalizeLocalUrl rewrites wildcard hosts and trims punctuation', () => {
  assert.strictEqual(util.normalizeLocalUrl('http://0.0.0.0:3000/'), 'http://localhost:3000');
  assert.strictEqual(util.normalizeLocalUrl('http://localhost:3000).'), 'http://localhost:3000');
});

test('splitLines carries an incomplete tail', () => {
  const carry = { rest: '' };
  assert.deepStrictEqual(util.splitLines('one\ntwo\nthr', carry), ['one', 'two']);
  assert.deepStrictEqual(util.splitLines('ee\n\nfour\r\n', carry), ['three', 'four']);
  assert.strictEqual(carry.rest, '');
});

test('escapeBraces protects blessed markup', () => {
  assert.strictEqual(util.escapeBraces('const x = { a: 1 }'), 'const x = {open} a: 1 {close}');
});

test('truncate adds an ellipsis only when needed', () => {
  assert.strictEqual(util.truncate('short', 10), 'short');
  assert.strictEqual(util.truncate('abcdefghij', 5), 'abcd\u2026');
});

test('which finds node on PATH', () => {
  const found = util.which(process.platform === 'win32' ? 'node.exe' : 'node');
  assert.ok(found, 'expected node on PATH');
  assert.strictEqual(util.which('definitely-not-a-real-binary-xyz'), null);
});

test('killTree terminates a detached child process tree', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });

  const exited = new Promise((resolve) => child.once('exit', () => resolve(true)));
  assert.strictEqual(util.killTree(child), true);
  await Promise.race([exited, sleep(8000).then(() => assert.fail('child was not killed'))]);
});

test('shellQuote and appleScriptString escape safely', () => {
  assert.strictEqual(util.shellQuote("it's here"), `'it'\\''s here'`);
  assert.strictEqual(util.appleScriptString('say "hi"'), '"say \\"hi\\""');
});

/* ------------------------------------------------------------------ *
 * terminal
 * ------------------------------------------------------------------ */

test('macOS terminal plan uses osascript + do script', () => {
  const [candidate, ...rest] = buildTerminalCandidates({ cwd: '/Users/me/Projects/app', command: 'code .', platform: 'darwin' });
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(candidate.bin, 'osascript');
  assert.deepStrictEqual(candidate.args.slice(0, 2), ['-e', 'tell application "Terminal"']);
  const joined = candidate.args.join(' ');
  assert.ok(joined.includes('do script "cd \'/Users/me/Projects/app\' && code ."'), joined);
});

test('Windows terminal plan offers wt.exe then a cmd window', () => {
  const candidates = buildTerminalCandidates({ cwd: 'C:\\dev\\my app', command: 'code .', platform: 'win32' });
  assert.deepStrictEqual(candidates.map((c) => c.id), ['windows-terminal', 'cmd-start']);
  assert.deepStrictEqual(candidates[0].args, ['-d', 'C:\\dev\\my app', 'cmd', '/k', 'code .']);

  // `start "" /D "<dir>" cmd.exe /k "<cmd>"` - verbatim args, so we quote by hand.
  assert.deepStrictEqual(candidates[1].args, [
    '/c',
    'start',
    '""',
    '/D',
    '"C:\\dev\\my app"',
    'cmd.exe',
    '/k',
    '"code ."',
  ]);
  assert.strictEqual(candidates[1].verbatim, true);
});

test('Linux terminal plan detects installed emulators and keeps the window open', () => {
  const candidates = buildTerminalCandidates({ cwd: '/home/me/app', command: 'opencode', platform: 'linux' });
  assert.ok(candidates.length >= 4);
  assert.ok(candidates.every((c) => typeof c.available === 'boolean'));

  const gnome = candidates.find((c) => c.id === 'gnome-terminal');
  assert.deepStrictEqual(gnome.args, ['--working-directory', '/home/me/app', '--', 'bash', '-lc', 'opencode; exec bash']);

  const xterm = candidates.find((c) => c.id === 'xterm');
  assert.deepStrictEqual(xterm.args, ['-e', 'bash', '-lc', "cd '/home/me/app' && opencode; exec bash"]);
});

test('dryRun reports the plan without launching anything', async () => {
  const result = await openInNewTerminal({
    cwd: process.cwd(),
    command: 'code .',
    platform: process.platform,
    dryRun: true,
  });
  assert.strictEqual(result.ok, true);
  assert.ok(result.terminal);
  assert.ok(formatTerminalCommand({ bin: 'gnome-terminal', args: ['--workdir', '/a b', 'code .'] }).includes('"/a b"'));
});

/* ------------------------------------------------------------------ *
 * config
 * ------------------------------------------------------------------ */

test('normalizeProject fills in defaults', () => {
  const project = configModule.normalizeProject({ name: 'app', status: 'Nonsense', info: 'hi' }, '/root');
  assert.strictEqual(project.path, path.join('/root', 'app'));
  assert.strictEqual(project.status, 'Pending');
  assert.strictEqual(configModule.STATUS_COLORS.Live, 'green');
});

test('scanDirectories lists folders and skips noise', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'termdeck-scan-'));
  try {
    ['alpha', 'beta', 'node_modules', '.hidden'].forEach((name) => fs.mkdirSync(path.join(root, name)));
    fs.writeFileSync(path.join(root, 'notes.txt'), 'not a folder');

    const found = configModule.scanDirectories(root).map((entry) => entry.name);
    assert.deepStrictEqual(found, ['alpha', 'beta']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('saveConfig/loadConfig round trip honour TERMDECK_CONFIG', () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const file = path.join(TMP_DIR, 'config.json');
  const previous = process.env.TERMDECK_CONFIG;
  process.env.TERMDECK_CONFIG = file;

  try {
    configModule.saveConfig({
      root: path.join(__dirname, 'fixtures'),
      projects: [{ name: 'fake-app', path: FIXTURE_APP, status: 'Live', info: 'fixture' }],
    });

    assert.strictEqual(fs.existsSync(file), true);
    const loaded = configModule.loadConfig();
    assert.strictEqual(loaded.projects.length, 1);
    assert.strictEqual(loaded.projects[0].status, 'Live');
    assert.strictEqual(loaded.devCommand, 'npm run dev');
    assert.strictEqual(loaded.openBrowser, true);

    fs.writeFileSync(file, '{ not json');
    const warnings = [];
    assert.strictEqual(configModule.loadConfig({ onWarn: (m) => warnings.push(m) }), null);
    assert.strictEqual(warnings.length, 1);
  } finally {
    if (previous === undefined) delete process.env.TERMDECK_CONFIG;
    else process.env.TERMDECK_CONFIG = previous;
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * CLI arg parsing
 * ------------------------------------------------------------------ */

test('parseArgs understands the documented flags', () => {
  assert.deepStrictEqual(parseArgs(['--setup']).setup, true);
  assert.deepStrictEqual(parseArgs(['--list']).list, true);
  assert.strictEqual(parseArgs(['--no-open']).noOpen, true);
  assert.strictEqual(parseArgs(['--no-update']).noUpdate, true);
  assert.strictEqual(parseArgs([]).noUpdate, false);
  assert.strictEqual(parseArgs(['-h']).help, true);
  assert.strictEqual(parseArgs([]).help, false);
});

test('printProjects renders a table without the TUI', () => {
  const { printProjects } = require('../src/index');
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    printProjects({
      root: '/root',
      projects: [{ name: 'alpha', status: 'Live', info: 'marketing site', path: '/root/alpha' }],
    });
  } finally {
    process.stdout.write = original;
  }

  const out = chunks.join('');
  assert.ok(out.includes('alpha'), out);
  assert.ok(out.includes('Live'), out);
  assert.ok(out.includes('/root/alpha'), out);
});

/* ------------------------------------------------------------------ *
 * log view
 * ------------------------------------------------------------------ */

function fakeWidget() {
  return {
    items: [],
    label: null,
    setItems(items) {
      this.items = items.slice();
    },
    setLabel(label) {
      this.label = label;
    },
  };
}

test('LogView follows the tail and batches writes', () => {
  const widget = fakeWidget();
  const view = new LogView(widget, { flushInterval: 100000, viewportHeight: () => 3 });

  view.pushAll(['1', '2', '3', '4', '5']);
  view.flush();

  assert.deepStrictEqual(widget.items, ['1', '2', '3', '4', '5']);
  assert.strictEqual(view.paused, false);

  view.destroy();
});

test('LogView can pause, report new lines and resume', () => {
  const widget = fakeWidget();
  const view = new LogView(widget, { flushInterval: 100000, viewportHeight: () => 3 });

  view.pushAll(['1', '2', '3', '4', '5']);
  view.flush();

  view.scrollUp(2);
  assert.strictEqual(view.paused, true);
  assert.deepStrictEqual(widget.items, ['1', '2', '3'], 'tail is hidden while scrolled back');
  assert.ok(widget.label.includes('paused'));

  view.push('6');
  view.flush();
  assert.strictEqual(view.pendingNew, 1);
  assert.ok(widget.label.includes('1 new'));

  view.scrollDown(1);
  assert.deepStrictEqual(widget.items, ['1', '2', '3', '4']);

  view.followTail();
  assert.strictEqual(view.paused, false);
  assert.deepStrictEqual(widget.items, ['1', '2', '3', '4', '5', '6']);

  view.clear();
  assert.deepStrictEqual(widget.items, []);

  view.destroy();
});

test('LogView trims history to maxLines', () => {
  const widget = fakeWidget();
  const view = new LogView(widget, { flushInterval: 100000, maxLines: 3, viewportHeight: () => 2 });
  view.pushAll(['1', '2', '3', '4']);
  view.flush();
  assert.deepStrictEqual(widget.items, ['2', '3', '4']);
  view.destroy();
});

/* ------------------------------------------------------------------ *
 * dev server (no child processes)
 * ------------------------------------------------------------------ */

test('parseCommand splits a dev command', () => {
  assert.deepStrictEqual(parseCommand('npm run dev'), { bin: 'npm', args: ['run', 'dev'] });
  assert.deepStrictEqual(parseCommand('  pnpm   dev --port 1234 '), { bin: 'pnpm', args: ['dev', '--port', '1234'] });
});

test('dev server output is parsed for a URL and opens the browser once', async () => {
  const logs = [];
  const states = [];
  const opened = [];

  const manager = new DevServerManager({
    browserDelayMs: 5,
    openBrowser: async (url) => opened.push(url),
    onLog: (_project, line) => logs.push(line),
    onState: (_project, state) => states.push(state),
  });

  const project = { name: 'fake', path: '/tmp/fake' };
  const entry = { project, url: null, timers: [], status: 'starting' };
  const carry = { rest: '' };
  // Simulate a running entry so the URL callback is not skipped.
  manager.servers.set(project.path, entry);

  manager.handleChunk(entry, '  \u279c  Local:   http://localhost:4321/\n', carry, 'stdout');
  manager.handleChunk(entry, 'error: something broke\n', { rest: '' }, 'stderr');

  assert.strictEqual(entry.url, 'http://localhost:4321');
  assert.deepStrictEqual(logs, ['  \u279c  Local:   http://localhost:4321/', 'error: something broke']);
  assert.strictEqual(states[states.length - 1].status, 'running');

  await waitFor(() => opened.length === 1, 3000, 'browser open');
  assert.deepStrictEqual(opened, ['http://localhost:4321']);
  assert.strictEqual(states.filter((s) => s.status === 'running' && s.url).length, 1);
});

/* ------------------------------------------------------------------ *
 * dev server (real child process)
 * ------------------------------------------------------------------ */

test('end to end: npm run dev -> logs streamed -> url detected -> stopped', async function () {
  const logs = [];
  const opened = [];
  const states = [];
  const exits = [];

  const manager = new DevServerManager({
    browserDelayMs: 5,
    urlFallbackDelayMs: 20000,
    openBrowser: async (url) => opened.push(url),
    onLog: (_project, line) => logs.push(line),
    onState: (_project, state) => states.push(state),
    onExit: (_project, info) => exits.push(info),
  });

  const project = { name: 'fake-app', path: FIXTURE_APP, devCommand: 'npm run dev' };
  const result = manager.start(project);
  assert.strictEqual(result.ok, true, result.error);
  assert.ok(result.entry.pid > 0, 'child has a pid');
  assert.strictEqual(manager.runningCount, 1);

  try {
    await waitFor(() => logs.some((line) => line.includes('localhost:4599')), 30000, 'dev server output');
    assert.strictEqual(manager.get(FIXTURE_APP).url, 'http://localhost:4599');
    assert.ok(logs.some((line) => line.includes('VITE v5.0.0')), 'stdout was captured');
    assert.strictEqual(states.some((s) => s.status === 'running'), true);

    await waitFor(() => opened.length === 1, 5000, 'browser open call');
    assert.deepStrictEqual(opened, ['http://localhost:4599']);

    // Starting twice must not spawn a second process.
    assert.strictEqual(manager.start(project).alreadyRunning, true);
    assert.strictEqual(manager.runningCount, 1);

    assert.strictEqual(manager.stop(FIXTURE_APP), true);
    await waitFor(() => !manager.isRunning(FIXTURE_APP), 10000, 'server removal');
    await waitFor(() => exits.length > 0, 10000, 'exit callback');
    assert.strictEqual(exits[0].stoppedByUs, true);
    assert.strictEqual(manager.runningCount, 0);
  } finally {
    manager.stopAll();
  }
});

/* ------------------------------------------------------------------ *
 * auto-updater
 * ------------------------------------------------------------------ */

/** In-process HTTP registry mock; tracks sockets so close() is instant. */
async function startRegistry(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', (socket) => sockets.add(socket));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/termdeck-cli/latest`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

test('fetchLatestVersion returns the version from the registry', async () => {
  const reg = await startRegistry((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ version: '2.0.0' }));
  });
  try {
    const version = await updater.fetchLatestVersion({ url: reg.url });
    assert.strictEqual(version, '2.0.0');
  } finally {
    await reg.close();
  }
});

test('fetchLatestVersion enforces a strict timeout on a hanging registry', async () => {
  const reg = await startRegistry(() => { /* never responds */ });
  try {
    const started = Date.now();
    const version = await updater.fetchLatestVersion({ url: reg.url, timeoutMs: 60 });
    assert.strictEqual(version, null);
    assert.ok(Date.now() - started < 500, 'timeout must cancel the request');
  } finally {
    await reg.close();
  }
});

test('fetchLatestVersion resolves null on non-2xx responses and bad JSON', async () => {
  const reg = await startRegistry((_req, res) => {
    res.statusCode = 404;
    res.end('{ not json');
  });
  try {
    assert.strictEqual(await updater.fetchLatestVersion({ url: reg.url }), null);
  } finally {
    await reg.close();
  }
});

test('installUpdate runs npm install -g via cross-spawn, detached and silent', () => {
  const calls = [];
  const fakeChild = { unref() { this.unrefCalled = true; } };
  const child = updater.installUpdate({
    spawn: (bin, args, opts) => {
      calls.push({ bin, args, opts });
      return fakeChild;
    },
  });

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].bin, 'npm');
  assert.deepStrictEqual(calls[0].args, ['install', '-g', 'termdeck-cli@latest']);
  assert.strictEqual(calls[0].opts.detached, true, 'install survives the dashboard quitting');
  assert.strictEqual(calls[0].opts.stdio, 'ignore', 'install is silent');
  assert.strictEqual(fakeChild.unrefCalled, true);
  assert.strictEqual(child, fakeChild);
});

test('runAutoUpdate honours --no-update and fires a detached install when newer', async () => {
  const chunks = [];
  const stdout = { write: (chunk) => { chunks.push(String(chunk)); return true; } };
  const spawned = [];
  const updates = [];
  const fakeSpawn = () => {
    const child = { pid: 4242, unref() {} };
    spawned.push(child);
    return child;
  };

  const reg = await startRegistry((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ version: '9.9.9' }));
  });
  const previous = process.env.TERMDECK_REGISTRY_URL;
  process.env.TERMDECK_REGISTRY_URL = reg.url;
  try {
    await updater.runAutoUpdate({ enabled: false, stdout });
    assert.strictEqual(chunks.length, 0, 'disabled -> no banner at all');
    assert.strictEqual(spawned.length, 0);

    await updater.runAutoUpdate({ stdout, spawn: fakeSpawn, onUpdating: (version) => updates.push(version) });
    assert.ok(chunks[0].includes('Checking for updates'), chunks.join(''));
    assert.strictEqual(spawned.length, 1, 'newer version -> install started');
    assert.deepStrictEqual(updates, ['9.9.9'], 'onUpdating receives the new version');
  } finally {
    if (previous === undefined) delete process.env.TERMDECK_REGISTRY_URL;
    else process.env.TERMDECK_REGISTRY_URL = previous;
    await reg.close();
  }
});

test('runAutoUpdate stays silent (no install) when already up to date', async () => {
  const chunks = [];
  const stdout = { write: (chunk) => { chunks.push(String(chunk)); return true; } };
  let spawned = 0;

  const reg = await startRegistry((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ version: updater.currentVersion() }));
  });
  const previous = process.env.TERMDECK_REGISTRY_URL;
  process.env.TERMDECK_REGISTRY_URL = reg.url;
  try {
    await updater.runAutoUpdate({ stdout, spawn: () => { spawned += 1; return { pid: 1, unref() {} }; } });
    assert.strictEqual(spawned, 0, 'no install when current === latest');
  } finally {
    if (previous === undefined) delete process.env.TERMDECK_REGISTRY_URL;
    else process.env.TERMDECK_REGISTRY_URL = previous;
    await reg.close();
  }
});

/* ------------------------------------------------------------------ *
 * runner
 * ------------------------------------------------------------------ */

async function run() {
  let passed = 0;
  const failures = [];

  for (const { name, fn } of tests) {
    const started = Date.now();
    try {
      await fn();
      passed += 1;
      process.stdout.write(`  \u2713 ${name} (${Date.now() - started}ms)\n`);
    } catch (err) {
      failures.push({ name, err });
      process.stdout.write(`  \u2717 ${name}\n      ${err && err.message}\n`);
    }
  }

  process.stdout.write(`\n${passed}/${tests.length} tests passed\n`);
  if (failures.length) {
    process.stdout.write('\nFailures:\n');
    failures.forEach(({ name, err }) => process.stdout.write(`  - ${name}: ${err && err.stack}\n`));
    process.exitCode = 1;
  }
}

run();
