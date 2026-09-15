#!/usr/bin/env node
'use strict';

/**
 * termdeck binary entry point.
 *
 * The shebang above (plus the `bin` field in package.json) is what makes
 * `npm i -g termdeck` give you a global `termdeck` command.
 */

const { main } = require('../src/index.js');

main(process.argv.slice(2))
  .then((code) => {
    // The dashboard keeps the process alive; only surface real exit codes.
    if (typeof code === 'number' && code !== 0) process.exitCode = code;
  })
  .catch((err) => {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`termdeck: ${message}\n`);
    process.exitCode = 1;
  });
