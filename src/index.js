#!/usr/bin/env node
'use strict';

/**
 * projctl CLI.
 *
 * `projctl`                launch the dashboard (runs setup on first use)
 * `projctl --setup`        re-run the setup wizard
 * `projctl --scan`         scan for projects and merge them into the config
 * `projctl --reset`        delete the config file and run setup again
 * `projctl --list`         print the configured projects and exit (no TUI)
 * `projctl --demo`         launch with the shipped 14-project sample dataset
 * `projctl --no-open`      do not auto-open the browser for dev servers
 * `projctl --no-update`    skip the automatic background update check
 * `projctl --no-auto-restart`  disable dev-server crash recovery for this session
 */

const fs = require('fs');
const path = require('path');

const { getConfigPath, configExists, loadConfig, loadConfigFromPath, runSetupWizard } = require('./config');

const DEMO_CONFIG_PATH = path.join(__dirname, '..', 'sample-config.json');

const HELP = `
  projctl - a terminal dashboard for your local dev projects

  Usage
    $ projctl [options]

  Options
    -h, --help        Show this help
    -V, --version     Show the version
    -s, --setup       Re-run the interactive setup wizard
        --scan        Scan for projects and merge them into the config
    -r, --reset       Delete the config file, then run setup again
    -l, --list        Print the configured projects and exit
        --demo        Launch with the shipped 14-project sample dataset
        --no-open     Do not open a browser when a dev server starts
        --no-update   Skip the automatic background update check
        --no-auto-restart  Disable dev-server crash recovery for this session

  Keys (inside the dashboard)
    up/down, j/k      Select a project
    r                 Run \`npm run dev\` for the selected project
    e                 Open the project in your editor in a NEW terminal window
    c/x/o/f/k, a      Open claude / codex / opencode / freebuff / kilocode
    s                 Change the selected project's status
    tab / S-tab       Cycle focus: project list -> actions -> output
    shift+x           Stop the selected project's dev server
    PgUp/PgDn, wheel  Scroll the dev server logs (G to follow the tail again)
    /                 Search filter (type to filter, enter to commit)
    1-5               Filter by status: all / live / exp / pend / scrap
    q                 Quit (stops every dev server it started)

  Config
    ${getConfigPath()}
    Override the location with the TERMDECK_CONFIG environment variable.
`;

function parseArgs(argv = []) {
  const args = { help: false, version: false, setup: false, reset: false, scan: false, list: false, demo: false, noOpen: false, noUpdate: false, noAutoRestart: false };
  for (const raw of argv) {
    const arg = String(raw);
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '-V':
      case '--version':
        args.version = true;
        break;
      case '-s':
      case '--setup':
        args.setup = true;
        break;
      case '-r':
      case '--reset':
        args.reset = true;
        break;
      case '--scan':
        args.scan = true;
        break;
      case '-l':
      case '--list':
        args.list = true;
        break;
      case '--demo':
        args.demo = true;
        break;
      case '--no-open':
        args.noOpen = true;
        break;
      case '--no-update':
        args.noUpdate = true;
        break;
      case '--no-auto-restart':
        args.noAutoRestart = true;
        break;
      default:
        args.unknown = arg;
    }
  }
  return args;
}

function printProjects(config) {
  const lines = [`Config: ${getConfigPath()}`, `Root:   ${config.root}`, ''];
  const nameWidth = Math.max(...config.projects.map((p) => p.name.length), 4) + 2;
  lines.push(`  ${'NAME'.padEnd(nameWidth)}${'STATUS'.padEnd(14)}DESCRIPTION / PATH`);
  for (const project of config.projects) {
    lines.push(`  ${project.name.padEnd(nameWidth)}${project.status.padEnd(14)}${project.info}`);
    lines.push(`  ${' '.repeat(nameWidth)}${' '.repeat(14)}${project.path}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function needsTTY(what) {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (interactive) return false;
  process.stderr.write(
    `projctl needs an interactive terminal to ${what}.\n` +
      `Open a real terminal and run it again, or use \`projctl --list\` to inspect the saved config.\n`
  );
  return true;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} exit code (the dashboard keeps the event loop alive)
 */
async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (args.version) {
    // eslint-disable-next-line global-require
    process.stdout.write(`${require('../package.json').version}\n`);
    return 0;
  }

  if (args.reset) {
    const file = getConfigPath();
    if (configExists()) {
      fs.unlinkSync(file);
      process.stdout.write(`Removed ${file}\n`);
    } else {
      process.stdout.write(`No config file at ${file}\n`);
    }
  }

  const existing = args.reset ? null : loadConfig({ onWarn: (message) => process.stderr.write(`${message}\n`) });
  let config = args.demo
    ? loadConfigFromPath(DEMO_CONFIG_PATH, { onWarn: (message) => process.stderr.write(`${message}\n`) })
    : existing;

  if (args.demo && !config) {
    process.stderr.write(`Could not load the sample dataset at ${DEMO_CONFIG_PATH}.\n`);
    return 1;
  }

  if (args.list && !config) {
    process.stderr.write(`No config found at ${getConfigPath()}. Run \`projctl --setup\` in a real terminal first.\n`);
    return 1;
  }

  if (args.setup || args.scan || args.reset || !config) {
    if (needsTTY('run the setup wizard')) return 1;
    config = await runSetupWizard({ existing });
  }

  if (!config.projects.length) {
    process.stderr.write('No projects configured. Run `projctl --setup`.\n');
    return 1;
  }

  if (args.list) {
    printProjects(config);
    return 0;
  }

  if (needsTTY('render the dashboard')) return 1;

  // Loaded lazily so `--help`, `--version` and `--list` stay fast and work
  // even when blessed has no usable terminal.
  // eslint-disable-next-line global-require
  const { launchDashboard } = require('./dashboard');
  const controller = launchDashboard(config, { autoOpen: !args.noOpen, autoRestart: !args.noAutoRestart });

  // Fire-and-forget auto-update: the registry check is capped at 2s and runs
  // in the background, and any banner is routed through the TUI footer so the
  // blessed screen is never corrupted by stray terminal output.
  // eslint-disable-next-line global-require
  const { runAutoUpdate } = require('./updater');
  runAutoUpdate({
    stdout: process.stdout,
    enabled: !args.noUpdate,
    onUpdating: (version) => controller.updateStatus(`Found v${version} — updating in the background…`),
  });

  return 0;
}

module.exports = { main, parseArgs, printProjects, HELP, getConfigPath };

// projctl's bin entry point maps straight to this file, so running it directly
// means "run the CLI". When required as a module (tests, embedding), do nothing.
if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      // The dashboard keeps the process alive; only surface real exit codes.
      if (typeof code === 'number' && code !== 0) process.exitCode = code;
    })
    .catch((err) => {
      const message = err && err.message ? err.message : String(err);
      process.stderr.write(`projctl: ${message}\n`);
      process.exitCode = 1;
    });
}
