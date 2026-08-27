// The extension APIs, under whichever name this browser gives them.
//
// Chrome exposes `chrome`. Firefox exposes both, but only `browser` returns
// promises — its `chrome` alias is callback-based, so `await chrome.storage
// .local.get(k)` there resolves to undefined and every read silently comes back
// empty. Preferring `browser` is what lets one codebase serve both stores.
//
// Read through getters rather than captured once at import: a module that binds
// the namespace at load time can never see a different one, which makes it
// untestable — and returns undefined outside an extension instead of throwing,
// so a panel can still be rendered in a plain DOM test.
//
// Only the namespaces this extension actually uses are exposed; anything else
// is a deliberate miss rather than a silent undefined.
const host = () => globalThis.browser ?? globalThis.chrome;

export const api = {
  get storage() { return host()?.storage; },
  get runtime() { return host()?.runtime; },
  get tabs() { return host()?.tabs; },
};
