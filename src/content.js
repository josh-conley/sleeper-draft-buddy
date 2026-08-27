// Classic-script loader. MV3 does not support "type": "module" on content
// scripts, but dynamic import() works and gives us real ES modules from here on.
// Chrome exposes `chrome`; Firefox's promise-returning namespace is `browser`.
// This file is a classic script and cannot import src/lib/ext.js, so it repeats
// the one line that matters.
const api = globalThis.browser ?? globalThis.chrome;

(async () => {
  try {
    const mod = await import(api.runtime.getURL('src/main.js'));
    mod.boot();
  } catch (err) {
    console.error('[SleeperRanks] failed to load:', err);
  }
})();
