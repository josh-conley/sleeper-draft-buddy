// Thin promise wrappers over chrome.storage.local.

export const KEYS = {
  rankings: 'rankings',
  columnMap: 'columnMap',
  settings: 'settings',
  manualDrafted: 'manualDrafted',
};

export const DEFAULT_SETTINGS = {
  filter: 'ALL',
  search: '',
  showDrafted: false,
  sortKey: 'myRank',
  sortDir: 'asc',
  pollMs: 2000,
  slot: null,
  panel: { x: null, y: 80, w: 720, h: 560, collapsed: false },
};

export async function get(key, fallback = null) {
  const out = await chrome.storage.local.get(key);
  return key in out && out[key] !== undefined ? out[key] : fallback;
}

export async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function getSettings() {
  const saved = (await get(KEYS.settings)) || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    panel: { ...DEFAULT_SETTINGS.panel, ...(saved.panel || {}) },
  };
}

export async function patchSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await set(KEYS.settings, next);
  return next;
}

export async function getManualDrafted(draftId) {
  if (!draftId) return [];
  const all = (await get(KEYS.manualDrafted)) || {};
  return all[draftId] || [];
}

export async function setManualDrafted(draftId, ids) {
  if (!draftId) return;
  const all = (await get(KEYS.manualDrafted)) || {};
  all[draftId] = ids;
  await set(KEYS.manualDrafted, all);
}
