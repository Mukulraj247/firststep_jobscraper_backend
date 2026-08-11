/**
 * Fixture: hangs forever so the supervisor can prove hard-kill works.
 * Usage: node hangChild.js
 */
setInterval(() => {}, 1 << 30);
process.send?.({ type: 'ready' });
