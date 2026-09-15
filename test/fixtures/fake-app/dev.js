'use strict';

// Minimal stand-in for a real dev server: prints a localhost URL the way Vite
// does, then idles until it is killed.
console.log('\u001b[32m  VITE v5.0.0\u001b[0m  ready in 123 ms');
console.log('');
console.log('  \u279c  Local:   http://localhost:4599/');
console.log('  \u279c  Network: use --host to expose');

setInterval(() => {}, 1000);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
