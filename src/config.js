'use strict';

/**
 * Configuration + first-run setup.
 *
 * The config lives at `~/.termdeck-config.json` (override with the
 * TERMDECK_CONFIG environment variable, which is handy for testing).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const inquirer = require('inquirer');

const CONFIG_VERSION = 1;

const STATUSES = ['Experimental', 'Live', 'Working', 'Pending'];

/** Color used for each status tag in the TUI. */
const STATUS_COLORS = {
  Experimental: 'magenta',
  Live: 'green',
  Working: 'yellow',
  Pending: 'cyan',
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
  return process.env.TERMDECK_CONFIG || path.join(os.homedir(), '.termdeck-config.json');
}

function configExists() {
  try {
    return fs.statSync(getConfigPath()).isFile();
  } catch (_) {
    return false;
  }
}

/** Normalise one project entry, filling in safe defaults. */
function normalizeProject(raw, root) {
  if (!raw) return null;
  const projectPath = raw.path
    ? path.resolve(raw.path)
    : raw.name
      ? path.join(root || '', raw.name)
      : null;
  if (!projectPath) return null;

  const status = STATUSES.includes(raw.status) ? raw.status : 'Pending';

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
  };
}


/**
 * Read the config file.
 * @returns {object|null} config, or null when missing/corrupt (caller should run setup).
 */
function loadConfig({ onWarn = () => {} } = {}) {
  const file = getConfigPath();
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
    onWarn(`${file} does not look like a termdeck config. Starting setup again.`);
    return null;
  }

  const root = parsed.root ? path.resolve(parsed.root) : '';
  return {
    version: CONFIG_VERSION,
    root,
    createdAt: parsed.createdAt || null,
    updatedAt: parsed.updatedAt || null,
    devCommand: parsed.devCommand || 'npm run dev',
    editorCommand: parsed.editorCommand || 'code .',
    agentCommand: parsed.agentCommand || 'opencode',
    openBrowser: parsed.openBrowser !== false,
    projects: parsed.projects.map((p) => normalizeProject(p, root)).filter(Boolean),
  };
}

const PER_PROJECT_OVERRIDES = ['port', 'devCommand', 'editorCommand', 'agentCommand'];

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
    root: config.root,
    devCommand: config.devCommand || 'npm run dev',
    editorCommand: config.editorCommand || 'code .',
    agentCommand: config.agentCommand || 'opencode',
    openBrowser: config.openBrowser !== false,
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
  let folders = scanDirectories(root);

  while (folders.length === 0) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: `No sub folders found in ${root}.`,
        choices: [
          { name: 'Pick a different root directory', value: 'again' },
          { name: 'Abort setup', value: 'abort' },
        ],
      },
    ]);

    if (action === 'abort') throw new Error('Setup cancelled: no projects found.');
    root = await askRoot(existing);
    folders = scanDirectories(root);
  }

  const { selected } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selected',
      message: `Select the projects to show in termdeck (${folders.length} folders found):`,
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
        choices: STATUSES,
        default: prev.status && STATUSES.includes(prev.status) ? prev.status : 'Working',
      },
    ]);

    const { info } = await inquirer.prompt([
      {
        type: 'input',
        name: 'info',
        message: `${step} ${name} \u2014 short description:`,
        default: prev.info || '',
        validate: (input) => (String(input).trim() ? true : 'A one line description helps nobody but yourself. Add one.'),
      },
    ]);

    projects.push({
      name,
      path: projectPath,
      status,
      info: String(info).trim(),
      // Do not lose per-project overrides from a previous config.
      ...pickOverrides(prev),
    });
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Interactive first-run setup: root -> folder multi-select -> status + blurb.
 * Persists the result to the config file and returns it.
 */
async function runSetupWizard({ existing = null, stdout = process.stdout } = {}) {
  stdout.write('\n  termdeck \u2014 first run setup\n');
  stdout.write('  Answer a few questions and we will remember them in ~/.termdeck-config.json\n\n');

  const root = await askRoot(existing);
  // `askProjects` may re-ask for the root when the first one had no folders.
  const { root: finalRoot, selected } = await askProjects(root, existing);
  const projects = await askDetails(selected, existing);

  const config = {
    version: CONFIG_VERSION,
    root: finalRoot,
    devCommand: (existing && existing.devCommand) || 'npm run dev',
    editorCommand: (existing && existing.editorCommand) || 'code .',
    agentCommand: (existing && existing.agentCommand) || 'opencode',
    openBrowser: existing ? existing.openBrowser !== false : true,
    createdAt: existing && existing.createdAt,
    projects,
  };

  const { save } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'save',
      message: `Save ${projects.length} project${projects.length === 1 ? '' : 's'} to ${getConfigPath()}?`,
      default: true,
    },
  ]);

  if (!save) throw new Error('Setup cancelled: nothing was saved.');

  saveConfig(config);
  stdout.write(`\n  Saved. Run the dashboard any time with: termdeck\n\n`);
  return loadConfig() || config;
}

module.exports = {
  CONFIG_VERSION,
  STATUSES,
  STATUS_COLORS,
  IGNORED_DIRS,
  getConfigPath,
  configExists,
  loadConfig,
  saveConfig,
  pickOverrides,
  normalizeProject,
  rootCandidates,
  scanDirectories,
  isDirectory,
  resolveUserPath,
  runSetupWizard,
};
