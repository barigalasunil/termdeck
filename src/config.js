'use strict';

/**
 * Configuration + first-run setup.
 *
 * The config lives at `~/.projctl-config.json` (override with the
 * TERMDECK_CONFIG environment variable, which is handy for testing).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const inquirer = require('inquirer');

const CONFIG_VERSION = 2;

const STATUSES = ['Experimental', 'Live', 'Working', 'Pending'];

/**
 * Modern short status vocabulary used by the projctl dashboard UI. The legacy
 * `STATUSES` labels remain accepted on read for backward compatibility; the
 * wizard vocabulary fully migrates to these when the dashboard is rewritten.
 */
const MODERN_STATUSES = ['live', 'exp', 'pend', 'scrap'];

/** Every accepted status string, legacy labels and modern short names. */
const ALL_STATUSES = [...STATUSES, ...MODERN_STATUSES];

/** Color used for each status tag in the TUI. */
const STATUS_COLORS = {
  Experimental: 'magenta',
  Live: 'green',
  Working: 'yellow',
  Pending: 'cyan',
  // Modern short labels (dashboard uses these).
  live: 'green',
  exp: 'yellow',
  pend: 'blue',
  scrap: 'gray',
};

/** Directory names that are never project folders. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '$RECYCLE.BIN',
  'System Volume Information',
  'AppData',
  'Program Files',
  'Program Files (x86)',
  'ProgramData',
  'Windows',
  'Windows.old',
  'PerfLogs',
  'MSOCache',
  'Recovery',
  '$WinREAgent',
  'OneDrive',
]);

function getConfigPath() {
  return process.env.TERMDECK_CONFIG || path.join(os.homedir(), '.projctl-config.json');
}

function configExists() {
  try {
    return fs.statSync(getConfigPath()).isFile();
  } catch (_) {
    return false;
  }
}

/** Expand a leading `~` (the home directory) in a hand-written path. */
function expandHome(value) {
  let v = String(value || '');
  if (v === '~') return os.homedir();
  if (v.startsWith('~/') || v.startsWith('~\\')) return path.join(os.homedir(), v.slice(2));
  return v;
}

/** Normalise one project entry, filling in safe defaults. */
function normalizeProject(raw, root) {
  if (!raw) return null;
  // Relative paths (e.g. `hyperion-core` in the sample dataset) are resolved
  // against the config root so they become `~/dev/projects/hyperion-core`.
  const projectPath = raw.path
    ? path.isAbsolute(raw.path)
      ? path.resolve(raw.path)
      : path.resolve(root || '', raw.path)
    : raw.name
      ? path.join(root || '', raw.name)
      : null;
  if (!projectPath) return null;

  const status = ALL_STATUSES.includes(raw.status) ? raw.status : 'Pending';

  return {
    name: raw.name || path.basename(projectPath),
    path: projectPath,
    status,
    info: typeof raw.info === 'string' ? raw.info : '',
    // Optional per-project overrides.
    ...(raw.port ? { port: Number(raw.port) } : {}),
    ...(raw.devCommand ? { devCommand: raw.devCommand } : {}),
    ...(raw.editorCommand ? { editorCommand: raw.editorCommand } : {}),
    ...(raw.agentCommand ? { agentCommand: raw.agentCommand } : {}),
    // projctl v2 additions (all optional).
    ...(raw.packageManager ? { packageManager: raw.packageManager } : {}),
    ...(typeof raw.stack === 'string' ? { stack: raw.stack } : {}),
    ...(raw.branch ? { branch: raw.branch } : {}),
    ...(raw.agents && typeof raw.agents === 'object' ? { agents: { ...raw.agents } } : {}),
    ...(raw.daemon ? { daemon: raw.daemon } : {}),
    ...(raw.lastCommit && typeof raw.lastCommit === 'object' ? { lastCommit: { ...raw.lastCommit } } : {}),
    ...(typeof raw.lastActivity === 'string' ? { lastActivity: raw.lastActivity } : {}),
  };
}


/**
 * Read the config file.
 * @returns {object|null} config, or null when missing/corrupt (caller should run setup).
 */
function loadConfig({ onWarn = () => {} } = {}) {
  return loadConfigFromPath(getConfigPath(), { onWarn });
}

/**
 * Read + normalise a config from an explicit file path (used by the CLI's
 * `--demo` mode, which points at the shipped sample dataset).
 */
function loadConfigFromPath(file, { onWarn = () => {} } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    onWarn(`Could not parse ${file} (${err.message}). Starting setup again.`);
    return null;
  }

  if (!parsed || !Array.isArray(parsed.projects)) {
    onWarn(`${file} does not look like a projctl config. Starting setup again.`);
    return null;
  }

  const root = parsed.root ? path.resolve(expandHome(parsed.root)) : '';
  return {
    version: CONFIG_VERSION,
    root,
    createdAt: parsed.createdAt || null,
    updatedAt: parsed.updatedAt || null,
    devCommand: parsed.devCommand || 'npm run dev',
    editorCommand: parsed.editorCommand || 'code .',
    agentCommand: parsed.agentCommand || 'opencode',
    openBrowser: parsed.openBrowser !== false,
    // projctl v2 flags (additive; safe defaults when a config predates them).
    autoRestart: parsed.autoRestart !== false,
    demoMode: parsed.demoMode === true,
    projects: parsed.projects.map((p) => normalizeProject(p, root)).filter(Boolean),
  };
}

/** Path rendered as `~/dev/projects/<name>` when it lives under home. */
function homePath(p) {
  if (!p) return p;
  const home = os.homedir();
  if (!home) return p;
  const trimmed = String(home).replace(/[\\/]+$/, '');
  if (p === trimmed) return '~';
  if (p.startsWith(`${trimmed}${path.sep}`)) return path.join('~', p.slice(trimmed.length + 1));
  return p;
}

/** Compact path for the UI: relative to `root` when possible, `~`-shortened. */
function displayPath(p, root) {
  if (!p) return p;
  if (root && typeof root === 'string' && p.startsWith(root)) {
    const rest = p.slice(root.length).replace(/^[\\/]+/, '');
    return path.join(homePath(root), rest);
  }
  return homePath(p);
}

const PER_PROJECT_OVERRIDES = ['port', 'devCommand', 'editorCommand', 'agentCommand', 'packageManager', 'stack', 'branch', 'agents', 'lastCommit', 'lastActivity'];

/** Keep any hand-written per-project overrides when a project is rewritten. */
function pickOverrides(project) {
  const overrides = {};
  if (!project) return overrides;
  PER_PROJECT_OVERRIDES.forEach((key) => {
    if (project[key] !== undefined && project[key] !== null && project[key] !== '') overrides[key] = project[key];
  });
  return overrides;
}

function saveConfig(config) {
  const file = getConfigPath();
  const now = new Date().toISOString();
  const payload = {
    version: CONFIG_VERSION,
    root: expandHome(config.root || ''),
    devCommand: config.devCommand || 'npm run dev',
    editorCommand: config.editorCommand || 'code .',
    agentCommand: config.agentCommand || 'opencode',
    openBrowser: config.openBrowser !== false,
    ...(config.demoMode ? { demoMode: config.demoMode } : {}),
    ...(config.autoRestart !== undefined && !config.autoRestart ? { autoRestart: false } : {}),
    createdAt: config.createdAt || now,
    updatedAt: now,
    projects: config.projects.map((p) => ({
      name: p.name,
      path: p.path,
      status: p.status,
      info: p.info,
      ...pickOverrides(p),
    })),
  };
  // A custom TERMDECK_CONFIG may point into a directory that does not exist yet.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

/** Candidate "projects live here" folders for the setup prompt. */
function rootCandidates() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Projects'),
    path.join(home, 'projects'),
    path.join(home, 'dev'),
    path.join(home, 'Development'),
    path.join(home, 'code'),
    path.join(home, 'source', 'repos'),
    path.join(home, 'workspace'),
    home,
  ];

  if (process.platform === 'win32') {
    // Offer every existing drive letter.
    for (let i = 65; i <= 90; i += 1) {
      const drive = `${String.fromCharCode(i)}:\\`;
      try {
        if (fs.statSync(drive).isDirectory()) candidates.push(drive);
      } catch (_) {
        /* drive does not exist */
      }
    }
  } else {
    candidates.push('/');
  }

  const seen = new Set();
  return candidates.filter((dir) => {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) return false;
    seen.add(key);
    try {
      return fs.statSync(dir).isDirectory();
    } catch (_) {
      return false;
    }
  });
}

/** Immediate sub folders of `root` that look like projects. */
function scanDirectories(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read ${root}: ${err.message}`);
  }

  return entries
    .filter((entry) => {
      if (entry.name.startsWith('.')) return false;
      if (IGNORED_DIRS.has(entry.name)) return false;
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

/** True when `dir` holds a `.git` folder or a `package.json` manifest. */
function isProjectFolder(dir) {
  try {
    if (fs.statSync(path.join(dir, '.git')).isDirectory()) return true;
  } catch (_) { /* no .git */ }
  try {
    if (fs.statSync(path.join(dir, 'package.json')).isFile()) return true;
  } catch (_) { /* no package.json */ }
  return false;
}

/** Sub folders of `root` that contain a real project marker (.git / package.json). */
function scanProjectCandidates(root) {
  return scanDirectories(root).filter((entry) => isProjectFolder(entry.path));
}

/**
 * Guess the package manager from the lockfile convention in `dir`:
 * pnpm-lock.yaml -> pnpm, yarn.lock -> yarn, otherwise npm.
 */
function detectPackageManager(dir) {
  try {
    if (fs.statSync(path.join(dir, 'pnpm-lock.yaml')).isFile()) return 'pnpm';
  } catch (_) { /* no pnpm lockfile */ }
  try {
    if (fs.statSync(path.join(dir, 'yarn.lock')).isFile()) return 'yarn';
  } catch (_) { /* no yarn lockfile */ }
  return 'npm';
}

/**
 * Merge the projects the wizard just produced into the existing config list.
 * - Incoming entries replace their existing twin (by path) — port/status/other
 *   fields the user just set win — but hand-written per-project overrides such
 *   as custom agent commands are kept from the old entry.
 * - Existing projects the wizard did not touch are preserved untouched.
 * - Brand new entries (no existing twin) are appended.
 */
function mergeWizardProjects(existing, wizard) {
  const existingList = Array.isArray(existing) ? existing : [];
  const wizardList = Array.isArray(wizard) ? wizard : [];
  const wizardPaths = new Set(wizardList.map((entry) => entry.path));
  const kept = existingList.filter((entry) => !wizardPaths.has(entry.path));
  return [
    ...kept,
    ...wizardList.map((entry) => {
      const previous = existingList.find((old) => old.path === entry.path);
      if (!previous) return entry;
      // Preserve custom overrides (agent commands, editor, stack, etc.) the
      // wizard did not re-ask about, but never overwrite what the user just
      // entered (status / port / packageManager take the new value).
      const preserved = pickOverrides(previous);
      Object.keys(entry).forEach((key) => {
        if (key in preserved && key in entry) delete preserved[key];
      });
      return { ...entry, ...preserved };
    }),
  ];
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch (_) {
    return false;
  }
}

/** Tilde/relative paths typed by hand in the wizard. */
function resolveUserPath(input) {
  let value = String(input || '').trim().replace(/^"(.*)"$/, '$1');
  if (!value) return null;
  if (value === '~') value = os.homedir();
  else if (value.startsWith('~/') || value.startsWith('~\\')) value = path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

/* ------------------------------------------------------------------ *
 * First run wizard
 * ------------------------------------------------------------------ */

async function askRoot(existing) {
  const candidates = rootCandidates();
  const defaultRoot = existing && existing.root;

  const { root } = await inquirer.prompt([
    {
      type: 'list',
      name: 'root',
      message: 'Where do your projects live?',
      pageSize: 14,
      default: defaultRoot && candidates.includes(defaultRoot) ? defaultRoot : undefined,
      choices: [
        ...candidates.map((dir) => ({ name: dir, value: dir })),
        new inquirer.Separator(),
        { name: 'Enter another path\u2026', value: '__custom__' },
      ],
    },
  ]);

  if (root !== '__custom__') return root;

  const { custom } = await inquirer.prompt([
    {
      type: 'input',
      name: 'custom',
      message: 'Path to the directory that holds your projects:',
      validate: (input) => {
        const resolved = resolveUserPath(input);
        if (!resolved) return 'Please enter a path.';
        if (!isDirectory(resolved)) return `Not a directory: ${resolved}`;
        return true;
      },
    },
  ]);

  return resolveUserPath(custom);
}

async function askProjects(root, existing) {
  const previous = new Map((existing && existing.projects ? existing.projects : []).map((p) => [p.path, p]));
  let folders = scanProjectCandidates(root);

  while (folders.length === 0) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: `No project folders (with .git or package.json) found in ${root}.`,
        choices: [
          { name: 'Pick a different root directory', value: 'again' },
          { name: 'Abort setup', value: 'abort' },
        ],
      },
    ]);

    if (action === 'abort') throw new Error('Setup cancelled: no projects found.');
    root = await askRoot(existing);
    folders = scanProjectCandidates(root);
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: `Select the projects to show in projctl (${folders.length} projects found):`,
      pageSize: 16,
      choices: folders.map((folder) => ({
        name: folder.name,
        value: folder.path,
        checked: previous.has(folder.path),
      })),
      validate: (answer) => (answer.length > 0 ? true : 'Select at least one project (space to toggle).'),
    },
  ]);

  return { root, folders, selected };
}

async function askDetails(selected, existing) {
  const previous = new Map((existing && existing.projects ? existing.projects : []).map((p) => [p.path, p]));
  const projects = [];

  for (let i = 0; i < selected.length; i += 1) {
    const projectPath = selected[i];
    const name = path.basename(projectPath);
    const prev = previous.get(projectPath) || {};
    const step = `[${i + 1}/${selected.length}]`;

    const { status } = await inquirer.prompt([
      {
        type: 'list',
        name: 'status',
        message: `${step} ${name} \u2014 what is its status?`,
        choices: MODERN_STATUSES,
        default: MODERN_STATUSES.includes(prev.status) ? prev.status : 'exp',
      },
    ]);

    const { port } = await inquirer.prompt([
      {
        type: 'number',
        name: 'port',
        message: `${step} ${name} \u2014 dev server port:`,
        default: prev.port || 3000,
        validate: (input) => {
          if (input === undefined || input === null || input === '') return 'Please enter a port number.';
          const n = Number(input);
          return Number.isInteger(n) && n > 0 && n < 65536 ? true : `Not a valid port: ${input}`;
        },
      },
    ]);

    const { packageManager } = await inquirer.prompt([
      {
        type: 'list',
        name: 'packageManager',
        message: `${step} ${name} \u2014 package manager:`,
        choices: ['npm', 'pnpm', 'yarn'],
        default: prev.packageManager || detectPackageManager(projectPath),
      },
    ]);

    projects.push({
      name,
      path: projectPath,
      // Do not lose per-project overrides from a previous config.
      ...pickOverrides(prev),
      status,
      port: Number(port),
      packageManager,
    });
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Interactive first-run setup: root -> folder multi-select -> status + blurb.
 * Persists the result to the config file and returns it.
 */
async function runSetupWizard({ existing = null, stdout = process.stdout } = {}) {
  stdout.write('\n  projctl \u2014 first run setup\n');
  stdout.write('  Answer a few questions and we will remember them in ~/.projctl-config.json\n\n');

  const root = await askRoot(existing);
  // `askProjects` may re-ask for the root when the first one had no folders.
  const { root: finalRoot, selected } = await askProjects(root, existing);
  const projects = await askDetails(selected, existing);

  const mergedProjects = mergeWizardProjects(existing && existing.projects, projects);

  const config = {
    version: CONFIG_VERSION,
    root: finalRoot,
    devCommand: (existing && existing.devCommand) || 'npm run dev',
    editorCommand: (existing && existing.editorCommand) || 'code .',
    agentCommand: (existing && existing.agentCommand) || 'opencode',
    openBrowser: existing ? existing.openBrowser !== false : true,
    autoRestart: existing ? existing.autoRestart !== false : true,
    createdAt: existing && existing.createdAt,
    projects: mergedProjects,
  };

  const { save } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'save',
      message: `Save ${mergedProjects.length} project${mergedProjects.length === 1 ? '' : 's'} to ${getConfigPath()}?`,
      default: true,
    },
  ]);

  if (!save) throw new Error('Setup cancelled: nothing was saved.');

  saveConfig(config);
  stdout.write(`\n  Saved. Run the dashboard any time with: projctl\n\n`);
  return loadConfig() || config;
}

module.exports = {
  CONFIG_VERSION,
  STATUSES,
  MODERN_STATUSES,
  ALL_STATUSES,
  STATUS_COLORS,
  IGNORED_DIRS,
  getConfigPath,
  configExists,
  loadConfig,
  loadConfigFromPath,
  saveConfig,
  pickOverrides,
  normalizeProject,
  rootCandidates,
  scanDirectories,
  scanProjectCandidates,
  detectPackageManager,
  mergeWizardProjects,
  isProjectFolder,
  isDirectory,
  resolveUserPath,
  expandHome,
  homePath,
  displayPath,
  runSetupWizard,
};
