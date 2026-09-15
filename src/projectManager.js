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
const { spawnSync } = require('child_process');

const { timeAgo } = require('./util');

const GIT_CACHE_TTL_MS = 30000;
const GIT_TIMEOUT_MS = 4000;

/** projectPath -> { fetchedAt, info }. Private; use clearGitCache() in tests. */
const cache = new Map();

/** Default git runner: `git <args>` in `cwd`, trimmed stdout or null. */
function runGit(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) return null;
  return result.stdout.trim();
}

/** Test hook: drop every cached git snapshot. */
function clearGitCache() {
  cache.clear();
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
  runGit,
  clearGitCache,
  isGitRepo,
  parseDirtyState,
  readGitInfo,
  getGitInfo,
  getLastActivity,
  scanProjects,
};