// The Firefox port in one file: whichever namespace this browser provides, the
// extension must reach for the promise-returning one.
//
// Firefox exposes BOTH `browser` (promises) and `chrome` (callbacks). Reaching
// for `chrome` there is not a crash — it is an await that resolves to undefined
// and a list that silently comes back empty, which is why this is asserted
// rather than eyeballed.
let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

const { api } = await import('../src/lib/ext.js');

// Outside an extension, nothing throws.
delete globalThis.browser;
delete globalThis.chrome;
ok(api.storage === undefined, 'no host: reads as undefined rather than throwing');
ok(api.runtime === undefined, 'no host: runtime likewise');

// Chrome: only `chrome` exists.
globalThis.chrome = { storage: { local: { name: 'chrome-storage' } }, runtime: { id: 'c' }, tabs: { id: 'c' } };
ok(api.storage.local.name === 'chrome-storage', 'Chrome: uses chrome.*');

// Firefox: both exist, and `browser` must win.
globalThis.browser = { storage: { local: { name: 'browser-storage' } }, runtime: { id: 'f' }, tabs: { id: 'f' } };
ok(api.storage.local.name === 'browser-storage', 'Firefox: prefers browser.* over chrome.*');
ok(api.runtime.id === 'f' && api.tabs.id === 'f', 'every namespace comes from the same host');

// Swapping the host after load must be visible: bound-at-import is the bug this
// getter exists to prevent.
delete globalThis.browser;
ok(api.storage.local.name === 'chrome-storage', 'falls back when browser disappears');

delete globalThis.chrome;

// And no source file may reach past the shim.
const { readFileSync, readdirSync, statSync } = await import('node:fs');
const walk = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));

const offenders = walk('src')
  .filter((f) => f.endsWith('.js') && !f.endsWith('lib/ext.js'))
  .filter((f) => {
    const src = readFileSync(f, 'utf8');
    // Classic scripts cannot import, so they declare the same one line inline.
    if (src.includes('globalThis.browser ?? globalThis.chrome')) return false;
    return /(?<!\/\/[^\n]*)\bchrome\.[a-z]/i.test(src.replace(/\/\/[^\n]*/g, ''));
  });

ok(offenders.length === 0, `no file reaches past the shim to chrome.* (${offenders.join(', ') || 'none'})`);

console.log(fails ? `\n${fails} check(s) failed` : '\nBoth browsers are reachable');
process.exit(fails ? 1 : 0);
