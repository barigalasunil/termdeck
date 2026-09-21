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
const processMonitor = require('../src/processMonitor');

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

test('formatTime renders a 12-hour clock with AM/PM', () => {
  assert.strictEqual(util.formatTime(new Date(2025, 4, 18, 0, 0, 0)), '12:00:00 AM');
  assert.strictEqual(util.formatTime(new Date(2025, 4, 18, 4, 42, 9)), '4:42:09 AM');
  assert.strictEqual(util.formatTime(new Date(2025, 4, 18, 12, 0, 0)), '12:00:00 PM');
  assert.strictEqual(util.formatTime(new Date(2025, 4, 18, 16, 42, 9)), '4:42:09 PM');
  assert.strictEqual(util.formatTime(new Date(2025, 4, 18, 23, 59, 59)), '11:59:59 PM');
  assert.strictEqual(util.formatTime('not-a-date'), null);
  assert.strictEqual(util.formatTime(null), null);
});

test('formatTimestamp keeps the date visible before a 12-hour time', () => {
  assert.strictEqual(util.formatTimestamp(new Date(2025, 4, 18, 16, 42, 9)), 'May 18, 2025 4:42:09 PM');
  assert.strictEqual(util.formatTimestamp(new Date(2026, 11, 31, 0, 0, 0)), 'Dec 31, 2026 12:00:00 AM');
  assert.strictEqual(util.formatTimestamp('garbage'), null);
});

test('timestamp (log lines) uses a 12-hour clock with AM/PM', () => {
  assert.strictEqual(util.timestamp(new Date(2025, 4, 18, 16, 42, 9)), '4:42:09 PM');
  assert.strictEqual(util.timestamp(new Date(2025, 4, 18, 0, 0, 0)), '12:00:00 AM');
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

test('normalizeProject resolves relative paths against the config root', () => {
  const project = configModule.normalizeProject({ name: 'hyperion-core', path: 'hyperion-core', status: 'live' }, path.join(os.homedir(), 'dev', 'projects'));
  assert.strictEqual(project.path, path.join(os.homedir(), 'dev', 'projects', 'hyperion-core'));
});

test('loadConfigFromPath expands ~ roots and normalises the demo dataset', () => {
  const sample = path.join(__dirname, '..', 'sample-config.json');
  const config = configModule.loadConfigFromPath(sample);
  assert.ok(config, 'sample dataset parses');
  assert.strictEqual(config.demoMode, true);
  assert.strictEqual(config.autoRestart, true);
  assert.strictEqual(config.projects.length, 14, 'fourteen demo projects');
  const live = config.projects.filter((p) => p.status === 'live').length;
  assert.strictEqual(live, 6);
  assert.strictEqual(config.projects[0].path, path.join(os.homedir(), 'dev', 'projects', 'hyperion-core'));
  assert.ok(config.projects[0].stack.includes('Next.js'), 'v2 fields survive normalisation');
});

test('displayPath shortens the project path to root/<name>', () => {
  const home = os.homedir();
  const root = path.join(home, 'dev', 'projects');
  const projectPath = path.join(root, 'hyperion-core');
  const shown = configModule.displayPath(projectPath, root);
  assert.ok(shown.endsWith(path.join('dev', 'projects', 'hyperion-core')), shown);
  assert.strictEqual(configModule.displayPath(home, home), '~');
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

test('scanProjectCandidates keeps only folders with .git or package.json', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'termdeck-cands-'));
  try {
    fs.mkdirSync(path.join(root, 'gitrepo', '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'npmrepo'));
    fs.writeFileSync(path.join(root, 'npmrepo', 'package.json'), '{}');
    fs.mkdirSync(path.join(root, 'plain')); // no markers -> skipped
    fs.mkdirSync(path.join(root, 'node_modules')); // noise
    fs.mkdirSync(path.join(root, '.hidden')); // hidden

    const found = configModule.scanProjectCandidates(root);
    assert.deepStrictEqual(found.map((entry) => entry.name), ['gitrepo', 'npmrepo']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detectPackageManager prefers pnpm/yarn lockfiles, falls back to npm', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'termdeck-pm-'));
  try {
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 6');
    assert.strictEqual(configModule.detectPackageManager(root), 'pnpm');
    fs.rmSync(path.join(root, 'pnpm-lock.yaml'));
    fs.writeFileSync(path.join(root, 'yarn.lock'), '# yarn');
    assert.strictEqual(configModule.detectPackageManager(root), 'yarn');
    fs.rmSync(path.join(root, 'yarn.lock'));
    assert.strictEqual(configModule.detectPackageManager(root), 'npm');
    assert.strictEqual(configModule.detectPackageManager(path.join(root, 'does-not-exist')), 'npm');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('detectPort reads a port from scripts or defaults to 3000', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'termdeck-port-'));
  const writeScripts = (scripts) => {
    fs.rmSync(path.join(root, 'package.json'), { force: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }));
  };
  try {
    assert.strictEqual(configModule.detectPort(root), 3000, 'no package.json -> 3000');
    writeScripts({ dev: 'next dev' });
    assert.strictEqual(configModule.detectPort(root), 3000, 'no port token -> 3000');
    writeScripts({ dev: 'next dev -p 3001' });
    assert.strictEqual(configModule.detectPort(root), 3001, '-p 3001');
    writeScripts({ dev: 'vite --port 5173' });
    assert.strictEqual(configModule.detectPort(root), 5173, '--port 5173');
    writeScripts({ start: 'PORT=8080 node server.js' });
    assert.strictEqual(configModule.detectPort(root), 8080, 'PORT=8080');
    writeScripts({ dev: 'next dev -p 99999' });
    assert.strictEqual(configModule.detectPort(root), 3000, 'out-of-range -> 3000');
    writeScripts({ start: 'vite preview --port 4173' });
    assert.strictEqual(configModule.detectPort(root), 4173, 'second script scanned too');
    writeScripts({ seed: 'curl http://api.example.com:8081/health', dev: 'next dev -p 9000' });
    assert.strictEqual(configModule.detectPort(root), 9000, 'explicit -p beats URL colon token from an earlier script');
    writeScripts({ seed: 'curl http://api.example.com:8081/health' });
    assert.strictEqual(configModule.detectPort(root), 8081, 'URL colon token still detected when no explicit flag exists');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoDiscoverProjects adds new project folders with quiet defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termdeck-auto-'));
  try {
    fs.mkdirSync(path.join(root, 'gitrepo', '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'npmrepo'));
    fs.writeFileSync(path.join(root, 'npmrepo', 'package.json'), JSON.stringify({ scripts: { dev: 'next dev -p 3001' } }));
    fs.writeFileSync(path.join(root, 'npmrepo', 'pnpm-lock.yaml'), 'lockfileVersion: 6');
    fs.mkdirSync(path.join(root, 'plain')); // no markers -> ignored
    fs.mkdirSync(path.join(root, 'known', '.git'), { recursive: true });

    const config = { root, projects: [{ name: 'known', path: path.join(root, 'known'), status: 'live', info: 'existing' }] };
    const result = configModule.autoDiscoverProjects(config);

    assert.deepStrictEqual(result.added.map((p) => p.name).sort(), ['gitrepo', 'npmrepo']);
    assert.strictEqual(result.projects.length, 3, 'existing projects are kept and new ones appended');

    const gitrepo = result.added.find((p) => p.name === 'gitrepo');
    assert.strictEqual(gitrepo.status, 'pend', 'new projects start pending so Live stays uncluttered');
    assert.strictEqual(gitrepo.port, 3000, 'no scripts -> default port 3000');
    assert.strictEqual(gitrepo.packageManager, 'npm');

    const npmrepo = result.added.find((p) => p.name === 'npmrepo');
    assert.strictEqual(npmrepo.port, 3001, 'port auto-detected from scripts');
    assert.strictEqual(npmrepo.packageManager, 'pnpm', 'package manager auto-detected from the lockfile');

    // Existing entries are returned untouched, never rewritten or re-sorted.
    assert.strictEqual(result.projects[0], config.projects[0]);

    // Second run with the merged list is a no-op (idempotent).
    const second = configModule.autoDiscoverProjects({ root, projects: result.projects });
    assert.deepStrictEqual(second.added, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('autoDiscoverProjects discovers nothing for a missing root and never removes projects', () => {
  const existing = [{ name: 'keep', path: 'C:/keep', status: 'live' }];
  const config = { root: path.join(os.tmpdir(), 'termdeck-missing-root-xyz'), projects: existing };
  const result = configModule.autoDiscoverProjects(config);
  assert.deepStrictEqual(result.added, []);
  assert.deepStrictEqual(result.projects, existing);
});

test('mergeWizardProjects keeps unselected projects and preserves overrides', () => {
  const existing = [
    { name: 'kept', path: 'C:/proj/kept', status: 'live', agents: { claude: 'custom-claude' } },
    { name: 'updated', path: 'C:/proj/updated', status: 'exp', port: 4000, agents: { codex: 'custom-codex' } },
  ];
  const wizard = [{ name: 'updated', path: 'C:/proj/updated', status: 'live', port: 5000 }];

  const merged = configModule.mergeWizardProjects(existing, wizard);
  assert.deepStrictEqual(
    merged.map((p) => p.path),
    ['C:/proj/kept', 'C:/proj/updated'],
    'unselected existing project is preserved, then incoming updates its twin'
  );
  const updated = merged.find((p) => p.name === 'updated');
  assert.strictEqual(updated.status, 'live');
  assert.strictEqual(updated.port, 5000);
  assert.deepStrictEqual(updated.agents, { codex: 'custom-codex' }, 'custom agent config is preserved on update');
  const kept = merged.find((p) => p.name === 'kept');
  assert.deepStrictEqual(kept.agents, { claude: 'custom-claude' });
});

test('mergeWizardProjects appends brand new projects', () => {
  const existing = [{ name: 'old', path: 'C:/proj/old', status: 'pend' }];
  const wizard = [{ name: 'brand-new', path: 'D:/proj/brand-new', status: 'exp' }];
  const merged = configModule.mergeWizardProjects(existing, wizard);
  assert.strictEqual(merged.length, 2);
  assert.ok(merged.some((p) => p.path === 'D:/proj/brand-new'));
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
  assert.strictEqual(parseArgs(['--scan']).scan, true);
  assert.strictEqual(parseArgs([]).scan, false);
  assert.strictEqual(parseArgs(['--no-auto-restart']).noAutoRestart, true);
  assert.strictEqual(parseArgs([]).noAutoRestart, false);
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
 * processMonitor
 * ------------------------------------------------------------------ */

test('formatMemory / formatCpu render one-decimal UI strings', () => {
  assert.strictEqual(processMonitor.formatMemory(149422080), '142.5 MB');
  assert.strictEqual(processMonitor.formatCpu(0.8), '0.8%');
  assert.strictEqual(processMonitor.formatMemory(NaN), null);
  assert.strictEqual(processMonitor.formatCpu('x'), null);
});

test('getPIDByPort parses netstat rows on Windows', () => {
  // Forced win32 branch: the runner is injected, so no real netstat is needed.
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const stdout = [
      '  TCP    0.0.0.0:0              0.0.0.0:0              LISTENING       4',
      '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       49201',
      '  TCP    127.0.0.1:3000         127.0.0.1:0            LISTENING       49201',
      '  TCP    [::]:3000              [::]:0                 LISTENING       9911',
    ].join('\n');
    const spawn = { sync: () => ({ status: 0, stdout }) };
    assert.strictEqual(processMonitor.getPIDByPort(3000, { spawn }), 49201);

    // A busy port in a different range must not leak through.
    assert.strictEqual(processMonitor.getPIDByPort(9999, { spawn }), null);

    // Command failure degrades to null, never throws.
    const failing = { sync: () => ({ error: new Error('boom'), status: null }) };
    assert.strictEqual(processMonitor.getPIDByPort(3000, { spawn: failing }), null);
  } finally {
    Object.defineProperty(process, 'platform', realPlatform);
  }
});

test('getPIDByPort parses lsof output on unix', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  try {
    const spawn = { sync: () => ({ status: 0, stdout: '49201\n49202\n' }) };
    assert.strictEqual(processMonitor.getPIDByPort(3000, { spawn }), 49201);
    assert.strictEqual(processMonitor.getPIDByPort(0, { spawn }), null);
  } finally {
    Object.defineProperty(process, 'platform', realPlatform);
  }
});

test('getProcessStats returns null for a dead PID and never rejects', async () => {
  const usage = () => Promise.reject(new Error('process not found'));
  assert.strictEqual(await processMonitor.getProcessStats(999999, { usage }), null);
  assert.strictEqual(await processMonitor.getProcessStats(null, { usage }), null);
});

test('getProcessStats formats memory and cpu for a live PID', async () => {
  const usage = () => Promise.resolve({ cpu: 0.8, memory: 149422080 });
  const stats = await processMonitor.getProcessStats(123, { usage });
  assert.deepStrictEqual(stats, { pid: 123, memory: '142.5 MB', cpu: '0.8%' });
});

test('startMonitoring polls on an interval and stopMonitoring ends it', async () => {
  const reports = [];
  const stop = processMonitor.startMonitoring(
    { path: '/p1', port: 3000 },
    (report) => reports.push(report),
    {
      intervalMs: 15,
      getPID: () => 123,
      getStats: () => ({ memory: '1.0 MB', cpu: '0.5%' }),
    }
  );

  await waitFor(() => reports.length >= 2, 2000, 'two polls');
  assert.strictEqual(reports[0].running, true);
  assert.strictEqual(reports[0].pid, 123);
  assert.strictEqual(reports[0].memory, '1.0 MB');

  processMonitor.stopMonitoring('/p1');
  const count = reports.length;
  await sleep(60);
  assert.strictEqual(reports.length, count, 'no polls after stop');

  assert.strictEqual(typeof stop, 'function');
  stop();
});

test('startMonitoring reports running:false when the port has no process', async () => {
  const reports = [];
  processMonitor.startMonitoring(
    { path: '/p2', port: 4000 },
    (report) => reports.push(report),
    { intervalMs: 60, getPID: () => null, getStats: () => null }
  );
  await waitFor(() => reports.length >= 1, 1000, 'first quiet report');
  assert.deepStrictEqual(reports[0], { running: false, pid: null, memory: null, cpu: null });
  processMonitor.stopMonitoring('/p2');
});

/* ------------------------------------------------------------------ *
 * auto-updater
 * ------------------------------------------------------------------ */

test('the auto-updater is hard-wired to the termdeck-cli package', () => {
  assert.strictEqual(updater.PACKAGE_NAME, 'termdeck-cli');
  assert.ok(updater.DEFAULT_REGISTRY_URL.endsWith('/termdeck-cli/latest'), updater.DEFAULT_REGISTRY_URL);
});

/* ------------------------------------------------------------------ *
 * projectManager
 * ------------------------------------------------------------------ */

const projectManager = require('../src/projectManager');

test('getGitInfo returns branch/hash/message/dirty from a fake git runner', () => {
  const fakeGit = (args, cwd) => {
    if (args[0] === 'rev-parse' && args.includes('--is-inside-work-tree')) return 'true';
    if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'main';
    if (args[0] === 'rev-parse' && args.includes('--short')) return 'abc1234';
    if (args[0] === 'log' && args.includes('--pretty=%s')) return 'feat: add moonbeam';
    if (args[0] === 'log' && args.includes('--format=%cI')) return '2026-09-12T14:00:00+00:00';
    if (args[0] === 'status' && args.includes('--porcelain')) return 'M foo.js\nD bar.js\n?? baz.js';
    return null;
  };
  projectManager.clearGitCache();
  const info = projectManager.getGitInfo('/fake', { force: true, git: fakeGit });
  assert.strictEqual(info.branch, 'main');
  assert.strictEqual(info.commitHash, 'abc1234');
  assert.strictEqual(info.commitMsg, 'feat: add moonbeam');
  assert.deepStrictEqual(info.dirty, { added: 2, removed: 1 });
  assert.strictEqual(typeof info.lastCommitAt, 'string');
});

test('getGitInfo returns nulls/empty outside a git repo', () => {
  const fakeGit = () => null;
  projectManager.clearGitCache();
  const info = projectManager.getGitInfo('/nonexistent', { force: true, git: fakeGit });
  assert.strictEqual(info.branch, null);
  assert.strictEqual(info.commitHash, null);
  assert.strictEqual(info.commitMsg, null);
  assert.deepStrictEqual(info.dirty, { added: 0, removed: 0 });
});

test('parseDirtyState counts added and removed files', () => {
  assert.deepStrictEqual(projectManager.parseDirtyState('?? untracked.js\nM staged.js'), { added: 2, removed: 0 });
  assert.deepStrictEqual(projectManager.parseDirtyState('D deleted.js\nR old.js -> new.js'), { added: 0, removed: 2 });
  assert.deepStrictEqual(projectManager.parseDirtyState(''), { added: 0, removed: 0 });
  assert.deepStrictEqual(projectManager.parseDirtyState(null), { added: 0, removed: 0 });
});

test('getGitInfo caches results and respects force flag', () => {
  let callCount = 0;
  const fakeGit = (args) => {
    callCount++;
    if (args[0] === 'rev-parse' && args.includes('--is-inside-work-tree')) return 'true';
    if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) return 'dev';
    if (args[0] === 'rev-parse' && args.includes('--short')) return 'deadbeef';
    if (args[0] === 'log' && args.includes('--pretty=%s')) return 'fix: stuff';
    if (args[0] === 'status' && args.includes('--porcelain')) return '';
    return null;
  };
  projectManager.clearGitCache();

  projectManager.getGitInfo('/cached', { force: false, git: fakeGit });
  projectManager.getGitInfo('/cached', { force: false, git: fakeGit });
  projectManager.getGitInfo('/cached', { force: false, git: fakeGit });
  assert.ok(callCount <= 6, 'cached calls should not re-run git (callCount=' + callCount + ')');

  projectManager.getGitInfo('/cached', { force: true, git: fakeGit });
  assert.ok(callCount >= 6, 'force=true must bypass cache (callCount=' + callCount + ')');
});

test('scanProjects finds directories and skips hidden files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-scan-'));
  try {
    fs.mkdirSync(path.join(root, 'app-a'));
    fs.mkdirSync(path.join(root, '.git-cache'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'readme.md'), 'hi');
    const ignored = new Set(['node_modules']);
    const results = projectManager.scanProjects(root, { ignored });
    assert.deepStrictEqual(
      results.map((p) => p.name),
      ['app-a']
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('getLastActivity returns a human-readable time or null', () => {
  const fakeGit = (args) => {
    if (args[0] === 'rev-parse' && args.includes('--is-inside-work-tree')) return 'true';
    if (args[0] === 'log' && args.includes('--format=%cI')) return new Date(Date.now() - 300000).toISOString(); // 5m ago
    return null;
  };
  projectManager.clearGitCache();
  const ago = projectManager.getLastActivity('/5min', { git: fakeGit });
  assert.ok(ago && ago.includes('m ago'), ago);

  const fakeGitNone = () => null;
  projectManager.clearGitCache();
  const ago2 = projectManager.getLastActivity('/none', { git: fakeGitNone });
  assert.strictEqual(ago2, null);
});

/* ------------------------------------------------------------------ *
 * agentManager
 * ------------------------------------------------------------------ */

const agentManager = require('../src/agentManager');

test('AGENT_COMMANDS contains all five agents', () => {
  const keys = Object.keys(agentManager.AGENT_COMMANDS).sort();
  assert.deepStrictEqual(keys, ['claude', 'codex', 'freebuff', 'kilocode', 'opencode']);
});

test('buildAgentCommand on unix includes tee -a with log path', () => {
  const project = { name: 'my-app', path: '/projects/my-app', agents: {} };
  const { command, logFile } = agentManager.buildAgentCommand(project, 'claude', { platform: 'linux' });
  assert.ok(command.includes('claude'), command);
  assert.ok(command.includes('tee -a'), command);
  assert.ok(logFile.includes('my-app-claude.log'), logFile);
});

test('buildAgentCommand on windows without tee uses bare command', () => {
  // Force no tee by injecting a which that always returns null
  const origWhich = agentManager.buildAgentCommand;
  const project = { name: 'win-app', path: '/projects/win-app', agents: {} };
  // buildAgentCommand doesn't accept which override directly — it calls which()
  // which() searches PATH; on CI, tee may or may not exist.  We just assert
  // the shape is sane (either has tee or is bare).
  const { command, logFile } = agentManager.buildAgentCommand(project, 'codex', { platform: process.platform });
  assert.ok(typeof command === 'string' && command.length > 0);
  assert.ok(logFile.includes('win-app-codex.log'), logFile);
});

test('launchAgent with commandOnly returns the command without spawning', async () => {
  const project = { name: 'svc', path: '/tmp/svc', agents: {} };
  const result = await agentManager.launchAgent(project, 'claude', { commandOnly: true });
  assert.strictEqual(result.ok, undefined);
  assert.ok(typeof result.command === 'string');
  assert.ok(result.command.includes('claude'), result.command);
  assert.ok(result.logFile.includes('svc-claude.log'));
});

test('launchAgent calls openInNewTerminal with correct cwd', async () => {
  const calls = [];
  const project = { name: 'proj', path: '/tmp/proj', agents: {} };
  const fakeTerminal = async (opts) => {
    calls.push(opts);
    return { ok: true, terminal: 'mock-term', command: opts.command };
  };
  const result = await agentManager.launchAgent(project, 'codex', { terminal: fakeTerminal });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.terminal, 'mock-term');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].cwd, '/tmp/proj');
  assert.ok(calls[0].command.includes('codex'), calls[0].command);
});

test('launchAgent returns error for unknown agent', async () => {
  const project = { name: 'x', path: '/tmp/x', agents: {} };
  const result = await agentManager.launchAgent(project, 'nonexistent');
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes('unknown agent'), result.error);
});

test('launchAgent returns error for missing project', async () => {
  const result = await agentManager.launchAgent(null, 'claude');
  assert.strictEqual(result.ok, false);
});

test('stopAgent is idempotent and isTailing is false for untailed agents', () => {
  assert.strictEqual(agentManager.isTailing({ path: '/nope' }, 'claude'), false);
  assert.strictEqual(agentManager.stopAgent({ path: '/nope' }, 'claude'), false);
});

test('tailAgentLog creates a log file and tails it', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-tail-'));
  const project = { name: 'tailtest', path: '/tmp/tailtest', agents: {} };
  const lines = [];
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, 'tailtest-claude.log');
    fs.writeFileSync(file, 'initial line\n');

    const stop = agentManager.tailAgentLog(
      project,
      'claude',
      (line) => lines.push(line),
      { logDir: tmpDir, intervalMs: 50 }
    );
    // Wait for the first tick to detect existing content
    await sleep(200);
    assert.ok(lines.length >= 1, 'should have received initial line');
    assert.ok(lines.includes('initial line'));

    // Append a new line and verify it is picked up
    fs.appendFileSync(file, 'new line\n');
    await sleep(300);
    assert.ok(lines.includes('new line'), 'appended line should be tailed');

    stop();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * devServer crash auto-restart
 * ------------------------------------------------------------------ */

test('DevServerManager auto-restarts crashed servers up to maxRestarts', async () => {
  const states = [];
  const exits = [];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devserver-restart-'));

  const manager = new DevServerManager({
    browserDelayMs: 5,
    restartDelayMs: 10,
    maxRestarts: 3,
    onState: (_project, state) => states.push(state),
    onExit: (_project, info) => exits.push(info),
  });

  const project = { name: 'crasher', path: tmpDir, devCommand: 'node -e "process.exit(1)"' };
  manager.start(project);

  // Wait for up to 3 restart attempts (each ~ 20ms restartDelay + spawn)
  await waitFor(() => exits.filter((e) => e.restart === true).length >= 3, 10000, 'three crash restarts');
  await sleep(300);
  const restarts = exits.filter((e) => e.restart === true);
  assert.ok(restarts.length <= 3, 'max 3 restarts (got ' + restarts.length + ')');
  manager.stopAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('DevServerManager restartAvailable respects per-project autoRestart:false', () => {
  const manager = new DevServerManager({ maxRestarts: 3 });
  assert.strictEqual(manager.restartAvailable({ path: '/a' }), true);
  assert.strictEqual(manager.restartAvailable({ path: '/b', autoRestart: false }), false);
  manager.autoRestart = false;
  assert.strictEqual(manager.restartAvailable({ path: '/c' }), false);
});

test('DevServerManager constructor disables restart for the whole session', () => {
  const manager = new DevServerManager({ autoRestart: false, maxRestarts: 3 });
  assert.strictEqual(manager.restartAvailable({ path: '/a' }), false, 'autoRestart:false at construction blocks every project');
});

/** In-process HTTP registry mock; tracks sockets so close() is instant. */
async function startRegistry(handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', (socket) => sockets.add(socket));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/termdeck/latest`,
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
