'use strict';

/**
 * Headless TUI smoke test.
 *
 *   npm run smoke
 *
 * Renders the real dashboard into an in-memory blessed screen, then drives the
 * CTAs (including a synthetic mouse click) and checks that dev-server output
 * lands in the log pane. Nothing is written to the terminal, no browser opens
 * and no extra terminal window is spawned.
 */

const assert = require('assert');
const path = require('path');
const { PassThrough } = require('stream');

const FIXTURE_APP = path.join(__dirname, 'fixtures', 'fake-app');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 30000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const { launchDashboard } = require('../src/dashboard');

  // Fake TTYs: blessed only paints when its streams look like a terminal.
  const output = new PassThrough();
  const input = new PassThrough();
  output.isTTY = true;
  output.columns = 120;
  output.rows = 40;
  input.isTTY = true;
  input.columns = 120;
  input.rows = 40;

  let rendered = 0;
  output.on('data', (chunk) => {
    rendered += chunk.length;
  });

  const config = {
    root: path.dirname(FIXTURE_APP),
    devCommand: 'npm run dev',
    editorCommand: 'code .',
    agentCommand: 'opencode',
    openBrowser: false,
    projects: [
      { name: 'fake-app', path: FIXTURE_APP, status: 'Live', info: 'fixture dev server', port: 4599 },
      { name: 'ghost-app', path: path.join(__dirname, 'fixtures', 'ghost-app'), status: 'Experimental', info: 'does not exist' },
    ],
  };

  const controller = launchDashboard(config, {
    autoOpen: false, // never launch a real browser during tests
    screenOptions: {
      input,
      output,
      rows: 40,
      cols: 120,
      terminal: 'xterm',
      forceUnicode: true,
    },
  });

  const { widgets, actions, logView, servers } = controller;

  /** Send a raw xterm SGR mouse sequence, the way a real terminal does. */
  const clickAt = async (x, y) => {
    const col = x + 1;
    const row = y + 1;
    input.write(`\u001b[<0;${col};${row}M`); // press
    await sleep(60);
    input.write(`\u001b[<0;${col};${row}m`); // release -> blessed emits `click`
    await sleep(60);
  };

  const wheelUp = async (x, y) => {
    input.write(`\u001b[<64;${x + 1};${y + 1}M`);
    await sleep(60);
  };    /** Same events blessed's program emits for a real keystroke. */
    const pressKey = async (ch, key) => {
      controller.screen.emit('keypress', ch, key);
      controller.screen.emit(`key ${key.full}`, ch, key);
      // Mirrors the second half of Screen._listenKeys: the focused element
      // gets the key too (that is how a focused Button sees enter/space).
      const focused = controller.screen.focused;
      if (focused && focused.keyable) {
        focused.emit('keypress', ch, key);
        focused.emit(`key ${key.full}`, ch, key);
      }
      await sleep(20);
    };

  try {
    // 1. The dashboard rendered something and knows about both projects.
    await waitFor(() => rendered > 0, 4000, 'screen output');
    assert.ok(rendered > 0, 'screen produced output');
    assert.strictEqual(widgets.projectList.items.length, 2, 'two project rows');
    const firstRow = widgets.projectList.ritems[0];
    assert.ok(firstRow.includes('fake-app'), firstRow);
    assert.ok(firstRow.includes('{green-fg}●{/green-fg}'), firstRow);

    // 2. The selected project card shows name, status and description.
    const cardText = widgets.card.getContent();
    assert.ok(cardText.includes('●'), 'status dot in the card');
    assert.ok(cardText.includes('fake-app'), cardText);
    assert.ok(cardText.includes('LIVE'), cardText);
    assert.ok(cardText.includes('fixture dev server'), cardText);

    // 3. CTA 1 through a REAL mouse click on the button widget.
    const devButton = widgets.buttons.dev;
    assert.ok(devButton.lpos, 'dev button has screen coordinates');
    assert.ok(devButton.getText().includes('Run dev server'), 'dev button shows its action label');
    const clickX = Math.floor((devButton.lpos.xi + devButton.lpos.xl) / 2);
    const clickY = devButton.lpos.yi + 1;
    await clickAt(clickX, clickY);
    await waitFor(() => servers.runningCount === 1, 10000, 'dev server to start');
    await waitFor(() => logView.lines.some((line) => line.includes('localhost:4599')), 30000, 'streamed logs');

    const logText = logView.lines.join('\n');
    assert.ok(/\[termdeck\]/.test(logText), 'termdeck notes appear in the log pane');
    assert.ok(logText.includes('VITE v5.0.0'), 'child stdout reached the log pane');
    assert.ok(!logText.includes('\u001b['), 'ANSI codes were stripped');

    // 4. Selecting the other project updates the card.
    widgets.projectList.select(1);
    await sleep(200);
    assert.ok(widgets.card.getContent().includes('ghost-app'), widgets.card.getContent());
    assert.ok(widgets.card.getContent().includes('EXPERIMENTAL'), widgets.card.getContent());

    // 5. The mouse wheel pauses the log pane; shift+G resumes it.
    widgets.projectList.select(0);
    await wheelUp(clickX, clickY);
    assert.strictEqual(logView.paused, true, 'wheelup pauses following');
    await pressKey('g', { name: 'g', shift: true, full: 'S-g' });
    assert.strictEqual(logView.paused, false, 'shift+G resumes following');

    // 5b. Tab moves focus to the buttons; space/enter activates the focused one.
    assert.strictEqual(controller.screen.focused, widgets.projectList, 'list starts focused');
    await pressKey('t', { name: 'tab', full: 'tab' });
    assert.strictEqual(controller.screen.focused, widgets.buttons.dev, 'tab focuses the dev button');
    // The dev server from step 3 is still running, so activating the button
    // again is a safe no-op (no second process, no editor window spawned).
    await pressKey(' ', { name: 'space', full: 'space' });
    assert.strictEqual(controller.screen.focused, widgets.projectList, 'activating a button hands focus back to the list');
    assert.strictEqual(servers.runningCount, 1, 'no second dev server was spawned');

    // 6. CTA 2/3 build a real terminal command but are not executed here.
    const { openInNewTerminal } = require('../src/terminal');
    const plan = await openInNewTerminal({ cwd: FIXTURE_APP, command: 'code .', dryRun: true });
    assert.strictEqual(plan.ok, true);
    assert.ok(plan.command.includes('code .'), plan.command);

    // 7. Stopping the dev server from the dashboard kills the child.
    assert.strictEqual(actions.stopDevServer(), true);
    await waitFor(() => servers.runningCount === 0, 10000, 'dev server to stop');
    assert.ok(logView.lines.some((line) => line.includes('stopping dev server')), 'stop was logged');

    process.stdout.write('  smoke test passed: dashboard rendered, CTAs wired, logs streamed, server stopped\n');
  } finally {
    actions.destroy();
  }
}

main().catch((err) => {
  process.stderr.write(`  smoke test FAILED: ${err && err.stack ? err.stack : err}\n`);
  process.exitCode = 1;
});
