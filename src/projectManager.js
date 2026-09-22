'use strict';

/**
 * projectManager - scans project folders and reads git metadata.
 *
 * Git reads shell out to `git` through cross-spawn and are cached per project
 * for GIT_CACHE_TTL_MS, so a 14-project dashboard does not hammer the disk on
 * every 2s render tick. Nothing here ever throws: every failure degrades to
 * `null` / empty values and the UI renders an em-dash for the field.
 *
 * The git runner is injectable (`git` option) so unit tests can feed fake
 * output without needing a real repository or the git binary.
 */

const fs = require('fs');
const path = require('path');
const crossSpawn = require('cross-spawn');
const { timeAgo } = require('./util');

const GIT_CACHE_TTL_MS = 30000;
const GIT_TIMEOUT_MS = 4000;
const STACK_CACHE_TTL_MS = 30000;

/** projectPath -> { fetchedAt, info }. Private; use clearGitCache() in tests. */
const cache = new Map();
const stackCache = new Map();

const STACK_PACKAGE_NAMES = {
  next: 'Next.js',
  react: 'React',
  typescript: 'TypeScript',
  tailwindcss: 'Tailwind',
  express: 'Express',
  vite: 'Vite',
  prisma: 'Prisma',
};

/** Default git runner: `git <args>` in `cwd`, trimmed stdout or null. */
function runGitResult(args, cwd, { spawn = crossSpawn.sync } = {}) {
  let result;
  try {
    result = spawn('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    result = { error, status: null, signal: null, stdout: '', stderr: '' };
  }
  if (typeof result === 'string') {
    return { ok: true, status: 0, signal: null, error: null, stdout: result, stderr: '' };
  }
  const stdout = result && result.stdout != null ? String(result.stdout) : '';
  const stderr = result && result.stderr != null ? String(result.stderr) : '';
  const ok = Boolean(result) && (result.ok === true || (result.ok !== false && !result.error && !result.signal && result.status === 0));
  return {
    ok,
    status: result && result.status != null ? result.status : null,
    signal: result && result.signal ? result.signal : null,
    error: result && result.error ? result.error : null,
    stdout,
    stderr,
  };
}

function runGit(args, cwd, options) {
  const result = runGitResult(args, cwd, options);
  return result.ok ? result.stdout.trim() : null;
}

/** Test hook: drop every cached git snapshot. */
function clearGitCache() {
  cache.clear();
}

function clearStackCache() {
  stackCache.clear();
}

function hasProjectFile(projectPath, name) {
  try {
    return fs.statSync(path.join(projectPath, name)).isFile();
  } catch (_) {
    return false;
  }
}

function readPackageStack(projectPath) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
  } catch (_) {
    return null;
  }

  if (!manifest || typeof manifest !== 'object') return null;
  const dependencies = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
  const stack = [];
  const seen = new Set();
  for (const packageName of Object.keys(dependencies)) {
    const cleanName = STACK_PACKAGE_NAMES[packageName];
    if (cleanName && !seen.has(cleanName)) {
      seen.add(cleanName);
      stack.push(cleanName);
    }
  }
  return stack.length ? stack.join(', ') : null;
}

function detectStack(projectPath, { force = false } = {}) {
  const now = Date.now();
  const hit = force ? null : stackCache.get(projectPath);
  if (hit && now - hit.fetchedAt < STACK_CACHE_TTL_MS) return hit.value;

  let value = 'Unknown';
  if (hasProjectFile(projectPath, 'package.json')) {
    const packageStack = readPackageStack(projectPath);
    value = packageStack || 'Unknown';
  } else {
    const fallbacks = [
      [['requirements.txt', 'Pipfile'], 'Python'],
      [['Cargo.toml'], 'Rust'],
      [['go.mod'], 'Go'],
      [['pom.xml'], 'Java'],
    ];
    for (const [names, stack] of fallbacks) {
      if (names.some((name) => hasProjectFile(projectPath, name))) {
        value = stack;
        break;
      }
    }
  }

  stackCache.set(projectPath, { fetchedAt: now, value });
  return value;
}

/** True when `cwd` sits inside a git working tree. */
function isGitRepo(projectPath, { git = runGit } = {}) {
  return git(['rev-parse', '--is-inside-work-tree'], projectPath) === 'true';
}

/**
 * Turn `git status --porcelain` into a (+added, -removed) pair. Counts files,
 * not diff lines: `??`/`A`/`M` lines are additions, `D`/`R` are removals, and
 * a differently-staged file (e.g. `AM typo.js`) still counts once.
 */
function parseDirtyState(porcelain) {
  if (!porcelain || typeof porcelain !== 'string') return { added: 0, removed: 0 };

  let added = 0;
  let removed = 0;
  for (const raw of porcelain.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('??') || /^[AM]/.test(line)) added += 1;
    else if (/^[DR]/.test(line)) removed += 1;
    // Anything else (e.g. `U`) counts as neither side.
  }
  return { added, removed };
}

/**
 * Read branch + last commit + dirty state from a real repo.
 * Returns zero-ish values (nulls / empty dirty) when git is unavailable or the
 * directory is not a repository, so callers never have to handle failure.
 */
function readGitInfo(projectPath, { git = runGit } = {}) {
  if (!isGitRepo(projectPath, { git })) {
    return { branch: null, commitHash: null, commitMsg: null, lastCommitAt: null, dirty: { added: 0, removed: 0 } };
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
  const commitHash = git(['rev-parse', '--short', 'HEAD'], projectPath);
  const commitMsg = git(['log', '-1', '--pretty=%s'], projectPath);
  const lastCommitAt = git(['log', '-1', '--format=%cI'], projectPath) || null;
  const porcelain = git(['status', '--porcelain'], projectPath);

  return {
    branch,
    commitHash,
    commitMsg,
    lastCommitAt,
    dirty: parseDirtyState(porcelain),
  };
}

/**
 * Cached git info for a project. Re-reads only when the cache entry is older
 * than GIT_CACHE_TTL_MS or `force` is set. Returns the same shape as
 * readGitInfo.
 */
function getGitInfo(projectPath, { force = false, git = null } = {}) {
  const now = Date.now();
  const hit = force ? null : cache.get(projectPath);
  if (hit && now - hit.fetchedAt < GIT_CACHE_TTL_MS) return hit.info;

  const info = readGitInfo(projectPath, git ? { git } : {});
  cache.set(projectPath, { fetchedAt: now, info });
  return info;
}

/**
 * "12m ago" style relative activity time for a project, derived from its last
 * commit. Falls back to `null` (dashboard shows an em-dash) outside a repo.
 */
function getLastActivity(projectPath, { git = null } = {}) {
  const info = getGitInfo(projectPath, git ? { git } : {});
  return timeAgo(info.lastCommitAt) || null;
}

function parseDiffStat(stat) {
  if (!stat || typeof stat !== 'string') return [];
  const files = [];
  for (const raw of stat.split('\n')) {
    const match = raw.match(/^\s*(.*?)\s*\|\s*(?:\d+|Bin\b)/);
    if (!match) continue;
    let file = match[1].trim();
    if (!file) continue;
    if (file.includes(' => ')) file = file.split(' => ').pop().trim();
    if (file.startsWith('"') && file.endsWith('"')) {
      try {
        file = JSON.parse(file);
      } catch (_) {
        file = file.slice(1, -1);
      }
    }
    files.push(file);
  }
  return [...new Set(files)];
}

function uniquePatterns(files) {
  const patterns = [];
  const add = (pattern) => {
    if (!patterns.includes(pattern)) patterns.push(pattern);
  };
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/');
    const basename = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
    if (basename === 'package.json') add('dependencies');
    if (basename === 'readme.md') add('docs');
    if (/(^|\/)(src|lib)\//.test(normalized)) add('source code');
  }
  return patterns;
}

function changedDirectories(files) {
  const directories = [];
  for (const file of files) {
    const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
    const slash = normalized.lastIndexOf('/');
    if (slash <= 0) continue;
    const directory = normalized.slice(0, slash);
    if (!directories.includes(directory)) directories.push(directory);
  }
  return directories.length ? directories : ['root'];
}

function buildCommitMessage(files) {
  const changedFiles = [...new Set((files || []).filter(Boolean).map((file) => String(file).trim()).filter(Boolean))];
  if (!changedFiles.length) return null;

  const patterns = uniquePatterns(changedFiles);
  const names = changedFiles.join(', ');
  let message;
  if (changedFiles.length === 1) {
    message = `Update ${changedFiles[0]}`;
  } else if (changedFiles.length <= 5) {
    message = `Modified ${changedFiles.length} files: ${names}`;
  } else {
    message = `Updated ${changedFiles.length} files across ${changedDirectories(changedFiles).join(', ')}`;
  }

  if (
    patterns.includes('dependencies') &&
    patterns.includes('docs') &&
    changedFiles.length === 2 &&
    changedFiles.some((file) => {
      const normalized = file.replace(/\\/g, '/').toLowerCase();
      return normalized.endsWith('/package.json') || normalized === 'package.json';
    }) &&
    changedFiles.some((file) => {
      const normalized = file.replace(/\\/g, '/').toLowerCase();
      return normalized.endsWith('/readme.md') || normalized === 'readme.md';
    })
  ) {
    return `chore: update dependencies and docs (${names})`;
  }
  return patterns.length ? `${message} (${patterns.join(', ')})` : message;
}

function gitResultFailed(value) {
  return Boolean(value && typeof value === 'object' && (value.__failed === true || value.ok === false || (value.ok !== true && value.status !== 0) || value.error));
}

function generateCommitMessage(projectPath, { git = runGit } = {}) {
  const stagedStat = safeGitOutput(git, ['diff', '--cached', '--stat'], projectPath);
  let files = parseDiffStat(stagedStat);
  let allStat = null;
  if (!files.length) {
    allStat = safeGitOutput(git, ['diff', 'HEAD', '--stat'], projectPath);
    files = parseDiffStat(allStat);
  }
  let untrackedResult = null;
  if (!files.length) {
    untrackedResult = safeGitOutput(git, ['ls-files', '--others', '--exclude-standard'], projectPath);
    if (typeof untrackedResult === 'string') files = untrackedResult.split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean);
  }
  if (
    !files.length &&
    ((stagedStat === null && allStat === null) ||
      gitResultFailed(stagedStat) ||
      gitResultFailed(allStat) ||
      gitResultFailed(untrackedResult))
  ) return 'Update project files';
  return files.length ? buildCommitMessage(files) : null;
}

function safeGitOutput(git, args, cwd) {
  try {
    return git(args, cwd);
  } catch (_) {
    return { __failed: true };
  }
}

function runInjectedGitResult(args, cwd, git) {
  if (git === runGit) return runGitResult(args, cwd);
  let result;
  try {
    result = git(args, cwd);
  } catch (error) {
    result = { error, status: null, signal: null, stdout: '', stderr: '' };
  }
  if (typeof result === 'string') {
    return { ok: true, status: 0, signal: null, error: null, stdout: result, stderr: '' };
  }
  const stdout = result && result.stdout != null ? String(result.stdout) : '';
  const stderr = result && result.stderr != null ? String(result.stderr) : '';
  return {
    ok: Boolean(result) && (result.ok === true || (result.ok !== false && !result.error && !result.signal && result.status === 0)),
    status: result && result.status != null ? result.status : null,
    signal: result && result.signal ? result.signal : null,
    error: result && result.error ? result.error : null,
    stdout,
    stderr,
  };
}

function outputLines(result) {
  const lines = [];
  for (const stream of ['stdout', 'stderr']) {
    const text = result && result[stream] ? String(result[stream]) : '';
    for (const line of text.split(/\r?\n|\r/)) {
      if (line.trim()) lines.push({ line, stream });
    }
  }
  return lines;
}

function summarizeGitFailure(result) {
  const text = [result && result.stderr, result && result.stdout]
    .filter(Boolean)
    .join('\n')
    .trim();
  const lines = text.split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean);
  const spawnError = result && result.error && (result.error.message || String(result.error));
  if (!lines.length && spawnError) return spawnError;
  if (!lines.length) return 'git command failed';
  if (/rejected/i.test(text) && /fetch first|upstream/i.test(text)) return 'rejected (fetch first)';
  return lines.find((line) => /rejected|failed|error|fatal|upstream/i.test(line)) || lines[0];
}

function countChangedFiles(projectPath, { git = runGit } = {}) {
  const tracked = safeGitOutput(git, ['diff', '--name-only', 'HEAD'], projectPath);
  if (!tracked) return 0;
  return [...new Set(tracked.split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean))].length;
}

function commitAndPush(projectPath, commitMessage, { git = runGit, onOutput = null } = {}) {
  const message = String(commitMessage == null ? '' : commitMessage).trim();
  if (!message) return { ok: false, error: 'Commit message cannot be empty.' };

  const status = safeGitOutput(git, ['status', '--porcelain'], projectPath);
  if (typeof status === 'string' && !status.trim()) {
    return { ok: false, warning: 'No changes to commit.' };
  }

  const addResult = runInjectedGitResult(['add', '.'], projectPath, git);
  for (const item of outputLines(addResult)) {
    if (onOutput) onOutput(item.line, item.stream);
  }
  if (!addResult.ok) {
    return { ok: false, error: `Add failed: ${summarizeGitFailure(addResult)}`, output: addResult };
  }

  const commitResult = runInjectedGitResult(['commit', '-m', message], projectPath, git);
  for (const item of outputLines(commitResult)) {
    if (onOutput) onOutput(item.line, item.stream);
  }
  if (!commitResult.ok) {
    const failure = summarizeGitFailure(commitResult);
    if (/nothing added|no changes|nothing to commit/i.test(`${commitResult.stdout}\n${commitResult.stderr}`)) {
      return { ok: false, warning: 'No changes to commit.', output: commitResult };
    }
    return { ok: false, error: `Commit failed: ${failure}`, output: commitResult };
  }

  const pushResult = runInjectedGitResult(['push'], projectPath, git);
  for (const item of outputLines(pushResult)) {
    if (onOutput) onOutput(item.line, item.stream === 'stderr' ? 'stderr' : 'stdout');
  }
  if (!pushResult.ok) {
    return { ok: false, error: `Push failed: ${summarizeGitFailure(pushResult)}`, output: pushResult };
  }

  let fileCount = countChangedFiles(projectPath, { git });
  if (!fileCount) {
    const commitText = `${commitResult.stdout}\n${commitResult.stderr}`;
    const match = commitText.match(/(\d+)\s+files?\s+changed/i);
    fileCount = match ? Number(match[1]) : 0;
  }
  return { ok: true, message, fileCount };
}

/**
 * Immediate sub-folders of `root` that look like projects: directories that
 * are not hidden and not on the ignore list. Returns sorted {name, path}.
 */
function scanProjects(root, { ignored = new Set() } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return [];
  }

  return entries
    .filter((entry) => {
      if (entry.name.startsWith('.')) return false;
      if (ignored.has(entry.name)) return false;
      if (entry.isDirectory()) return true;
      if (entry.isSymbolicLink()) {
        try {
          return fs.statSync(path.join(root, entry.name)).isDirectory();
        } catch (_) {
          return false;
        }
      }
      return false;
    })
    .map((entry) => ({ name: entry.name, path: path.join(root, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

module.exports = {
  GIT_CACHE_TTL_MS,
  GIT_TIMEOUT_MS,
  STACK_CACHE_TTL_MS,
  runGit,
  runGitResult,
  clearGitCache,
  clearStackCache,
  isGitRepo,
  parseDirtyState,
  readGitInfo,
  getGitInfo,
  getLastActivity,
  detectStack,
  parseDiffStat,
  buildCommitMessage,
  generateCommitMessage,
  commitAndPush,
  scanProjects,
};
