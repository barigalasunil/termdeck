'use strict';

/**
 * termdeck CLI.
 *
 * `termdeck`                launch the dashboard (runs setup on first use)
 * `termdeck --setup`        re-run the setup wizard
 * `termdeck --reset`        delete the config file and run setup again
 * `termdeck --list`         print the configured projects and exit (no TUI)
 * `termdeck --no-open`      do not auto-open the browser for dev servers
 * `termdeck --no-update`    skip the automatic background update check
 */

const fs = require('fs');

const { getConfigPath, configExists, loadConfig, runSetupWizard } = require('./config');

const HELP = `
  termdeck - a terminal dashboard for your local dev projects

  Usage
    $ termdeck [options]

  Options
    -h, --help        Show this help
    -V, --version     Show the version
    -s, --setup       Re-run the interactive setup wizard
    -r, --reset       Delete the config file, then run setup again
    -l, --list        Print the configured projects and exit
        --no-open     Do not open a browser when a dev server starts
        --no-update   Skip the automatic background update check

  Keys (inside the dashboard)
    up/down, j/k      Select a project
    d                 Start \`npm run dev\` and stream its logs into the pane
    e                 Open the project in your editor in a NEW terminal window
    a                 Open your coding agent in a NEW terminal window
    tab / S-tab       Cycle focus to the buttons (space/enter activates)
    x                 Stop the selected project's dev server
    r                 Reload the config file
    PgUp/PgDn, wheel  Scroll the dev server logs (G to follow the tail again)
    q                 Quit (stops every dev server it started)

  Config
    ${getConfigPath()}
    Override the location with the TERMDECK_CONFIG environment variable.
`;

function parseArgs(argv = []) {
  const args = { help: false, version: false, setup: false, reset: false, list: false, noOpen: false, noUpdate: false };
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
      case '-l':
      case '--list':
        args.list = true;
        break;
      case '--no-open':
        args.noOpen = true;
        break;
      case '--no-update':
        args.noUpdate = true;
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
    `termdeck needs an interactive terminal to ${what}.\n` +
      `Open a real terminal and run it again, or use \`termdeck --list\` to inspect the saved config.\n`
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
  let config = existing;

  if (args.list && !config) {
    process.stderr.write(`No config found at ${getConfigPath()}. Run \`termdeck --setup\` in a real terminal first.\n`);
    return 1;
  }

  if (args.setup || args.reset || !config) {
    if (needsTTY('run the setup wizard')) return 1;
    config = await runSetupWizard({ existing });
  }

  if (!config.projects.length) {
    process.stderr.write('No projects configured. Run `termdeck --setup`.\n');
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
  const controller = launchDashboard(config, { autoOpen: !args.noOpen });

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
