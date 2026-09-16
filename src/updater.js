'use strict';

/**
 * Silent auto-updater for termdeck-cli.
 *
 * On every interactive dashboard launch we ask the npm registry for the latest
 * termdeck-cli version. When a newer one exists we print one short notice, kick
 * off a detached `npm install -g termdeck-cli@latest` in the background and let
 * the user keep working. Every failure path (offline, timeout, registry hiccup,
 * spawn error) is silent: the app simply runs with the installed version.
 *
 * Deliberately dependency-free on purpose: the check is a plain stdlib `https`
 * GET against the npm registry (configurable for tests via TERMDECK_REGISTRY_URL)
 * and the install reuses `cross-spawn`, which termdeck-cli already depends on.
 */

const http = require('http');
const https = require('https');
const crossSpawn = require('cross-spawn');

const pkg = require('../package.json');

const PACKAGE_NAME = 'termdeck-cli';
const DEFAULT_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CHECK_TIMEOUT_MS = 2000;
const MAX_BODY_BYTES = 64 * 1024;

/** The version of the code that is currently running. */
function currentVersion() {
  return pkg.version;
}

/** Registry endpoint, overridable so tests (and mirrors) can point elsewhere. */
function registryUrl() {
  return process.env.TERMDECK_REGISTRY_URL || DEFAULT_REGISTRY_URL;
}

function clientFor(url) {
  return url.indexOf('https:') === 0 ? https : http;
}

/**
 * Fetch the latest published version of termdeck-cli from the registry.
 * Resolves with the version string, or `null` on any failure (offline,
 * timeout, non-2xx, bad JSON). Never rejects and never takes longer than the
 * configured timeout.
 */
function fetchLatestVersion(options = {}) {
  const url = options.url || registryUrl();
  const timeoutMs = options.timeoutMs == null ? CHECK_TIMEOUT_MS : options.timeoutMs;

  return new Promise((resolve) => {
    let finished = false;
    let body = '';
    let req;

    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      finish(null);
      if (req && !req.destroyed) req.destroy();
    }, timeoutMs);
    if (timer.unref) timer.unref();

    const onError = () => finish(null);

    try {
      req = clientFor(url).get(url, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < MAX_BODY_BYTES) body += chunk;
        });
        res.on('error', onError);
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300 || body.length > MAX_BODY_BYTES) return finish(null);
          try {
            const parsed = JSON.parse(body);
            finish(parsed && typeof parsed.version === 'string' ? parsed.version : null);
          } catch (_) {
            finish(null);
          }
        });
      });
    } catch (_) {
      finish(null);
      return;
    }

    req.on('error', onError);
  });
}

/**
 * Start a silent, detached `npm install -g termdeck-cli@latest` in the
 * background. The child is `unref()`ed so the dashboard can quit while npm
 * keeps working. Returns the child, or `null` when spawning failed.
 */
function installUpdate(options = {}) {
  const spawn = options.spawn || crossSpawn;
  try {
    const child = spawn('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    if (child && typeof child.unref === 'function') child.unref();
    return child;
  } catch (_) {
    return null;
  }
}

/**
 * One-shot, fire-and-forget update check used at the top of every dashboard
 * launch. Never rejects and never blocks the caller: the fetch is capped at
 * CHECK_TIMEOUT_MS and the install is detached.
 *
 * @param {object}    [options]
 * @param {boolean}   [options.enabled=true]   false disables checking entirely (--no-update)
 * @param {object}    [options.stdout]         stream for the one-line banner (defaults to process.stdout)
 * @param {Function}  [options.onUpdating]     called with the new version once an install starts
 * @param {Function}  [options.spawn]          injectable spawn (tests)
 * @param {Function}  [options.fetch]          injectable fetch (tests)
 * @returns {Promise<void>}
 */
async function runAutoUpdate(options = {}) {
  const {
    enabled = true,
    stdout = process.stdout,
    onUpdating = null,
    spawn = null,
    fetch: fetchFn = fetchLatestVersion,
  } = options;
  if (!enabled) return;

  try {
    stdout.write('✨ Checking for updates\u2026\n');
  } catch (_) {
    /* terminal already gone - nothing to tell the user */
  }

  const latest = await fetchFn();
  if (!latest) return; // offline / timeout / registry down -> stay silent
  if (latest === currentVersion()) return; // up to date -> stay silent

  const child = installUpdate({ spawn });
  if (child && typeof onUpdating === 'function') {
    try {
      onUpdating(latest);
    } catch (_) {
      /* the banner itself must never crash the session */
    }
  }
}

module.exports = {
  PACKAGE_NAME,
  DEFAULT_REGISTRY_URL,
  CHECK_TIMEOUT_MS,
  MAX_BODY_BYTES,
  currentVersion,
  registryUrl,
  fetchLatestVersion,
  installUpdate,
  runAutoUpdate,
};