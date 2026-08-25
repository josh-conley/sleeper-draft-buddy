// Classic-script loader. MV3 does not support "type": "module" on content
// scripts, but dynamic import() works and gives us real ES modules from here on.
(async () => {
  try {
    const mod = await import(chrome.runtime.getURL('src/main.js'));
    mod.boot();
  } catch (err) {
    console.error('[SleeperRanks] failed to load:', err);
  }
})();
