// Entry point: detect the draft, boot the panel, keep it in sync.

import * as store from './lib/store.js';
import { buildIndex, pickLabel } from './lib/names.js';
import { isExcludedPick } from './lib/parse.js';
import { loadReference, enrichRows } from './lib/enrich.js';
import { getDraftId, onUrlChange, DraftPoller } from './lib/draft.js';
import { watchBoard, labelToPickNo } from './lib/board.js';
import { Panel } from './panel/panel.js';

const LOG = '[DraftBuddy]';

let panel = null;
let poller = null;
let index = null;
let draftId = null;
let rankings = [];
let manualIds = new Set();
let booted = false;
let reference = null;

// Two independent sources of draft state. The board DOM is primary — the REST
// API reports nothing at all for mock drafts. The API is the safety net for the
// day Sleeper's markup changes.
let boardPicks = [];
let boardClockLabel = null;
let apiPicks = [];
let stopBoard = null;
let teams = null;

export async function boot() {
  if (booted) return;
  booted = true;
  onUrlChange(() => onRoute());
  await onRoute();
}

async function onRoute() {
  const id = getDraftId();
  if (!id) {
    poller?.stop();
    stopBoard?.();
    poller = null;
    draftId = null;
    panel?.update({ status: 'stale' });
    return;
  }
  if (!panel) await createPanel();
  await attach(id);
}

async function createPanel() {
  const cssText = await fetch(chrome.runtime.getURL('src/panel/panel.css')).then((r) => r.text());
  const settings = await store.getSettings();
  rankings = (await store.get(store.KEYS.rankings)) || [];
  index = buildIndex(rankings);

  panel = new Panel(cssText, settings, {
    onSettingsChange: (patch) =>
      store.patchSettings(patch).then(() => {
        if (patch.pollMs && poller) poller.setInterval(patch.pollMs);
        if ('slot' in patch) panel.render(); // the dot depends on the slot
      }),
    onSaveRankings: (rows, mapping) => saveList(rows, mapping),
    onClearRankings: async () => {
      rankings = [];
      index = buildIndex(rankings);
      await store.set(store.KEYS.rankings, []);
      panel.update({ rankings, draftedIds: new Set(), unmatched: [] });
    },
    onToggleManual: async (id) => {
      if (manualIds.has(id)) manualIds.delete(id); else manualIds.add(id);
      await store.setManualDrafted(draftId, [...manualIds]);
      panel.update({ manualIds: new Set(manualIds) });
    },
    onRefreshReference: () => ensureReference({ force: true }).then(() => reEnrich()),
  });

  panel.update({ rankings });
  window.addEventListener('resize', () => panel.applyGeometry());
  ensureReference().then(() => { if (rankings.length) reEnrich(); });
}

/** Player database + bye weeks, cached for a day in chrome.storage. */
async function ensureReference(opts) {
  try {
    reference = await loadReference(opts);
    panel.update({ reference });
    return reference;
  } catch (err) {
    console.warn(`${LOG} reference data unavailable: ${err.message}`);
    panel.update({ reference: null });
    return null;
  }
}

async function saveList(rows, mapping) {
  const ref = reference || (await ensureReference());
  const { rows: enriched, unresolved } = ref
    ? enrichRows(rows, ref)
    : { rows: rows.map((r, i) => ({ ...r, myRank: r.myRank ?? i + 1 })), unresolved: [] };

  if (unresolved.length) {
    console.warn(`${LOG} ${unresolved.length} name(s) not found in Sleeper:`, unresolved);
  }
  rankings = enriched;
  index = buildIndex(rankings);
  await store.set(store.KEYS.rankings, rankings);
  await store.set(store.KEYS.columnMap, mapping);
  panel.update({ rankings });
  mergePicks();
}

/** Re-run inference over the saved list, e.g. after refreshing player data. */
async function reEnrich() {
  if (!reference || !rankings.length) return;
  const stripped = rankings.map((r) => ({
    id: r.id, name: r.name,
    myRank: r.myRank,
    // Drop previously-inferred values so they get recomputed from fresh data.
    position: r.inferred?.position ? null : r.position,
    team: r.inferred?.team ? null : r.team,
    bye: r.inferred?.bye ? null : r.bye,
    posRank: r.posRank,
  }));
  const { rows } = enrichRows(stripped, reference);
  rankings = rows;
  index = buildIndex(rankings);
  await store.set(store.KEYS.rankings, rankings);
  panel.update({ rankings });
  mergePicks();
}

async function attach(id) {
  if (!id || id === draftId) return;
  poller?.stop();
  stopBoard?.();
  draftId = id;
  boardPicks = [];
  apiPicks = [];
  boardClockLabel = null;
  manualIds = new Set(await store.getManualDrafted(draftId));
  panel.update({ manualIds: new Set(manualIds), draftedIds: new Set(), unmatched: [], pickNo: null });
  console.info(`${LOG} tracking draft ${draftId}`);

  poller = new DraftPoller(draftId, {
    onMeta: (draft) => {
      teams = draft?.settings?.teams ?? null;
      panel.update({ teams, type: draft?.type || 'snake' });
    },
    onPicks: (picks) => { apiPicks = picks || []; mergePicks(); },
    onStatus: ({ state, error }) => {
      if (error) console.warn(`${LOG} poll ${state}: ${error}`);
      if (!boardPicks.length) panel.update({ status: state });
    },
  });
  await poller.start(panel.settings.pollMs);

  stopBoard = watchBoard(({ adapter, picks, clockLabel }) => {
    boardPicks = picks || [];
    boardClockLabel = clockLabel;
    if (adapter) panel.update({ boardKind: adapter.id });
    mergePicks();
  });
}

/** Whichever source knows about more picks drives the panel. */
function mergePicks() {
  const useBoard = boardPicks.length >= apiPicks.length;
  const picks = useBoard ? boardPicks : apiPicks;

  // The board states the on-the-clock pick outright, which beats inferring it
  // from a pick count — it stays correct even if a cell fails to parse.
  const fromLabel = useBoard ? labelToPickNo(boardClockLabel, teams) : null;
  const pickNo = fromLabel ?? picks.length + 1;

  panel.update({ source: picks.length ? (useBoard ? 'board' : 'api') : null });
  if (boardPicks.length || boardClockLabel) panel.update({ status: 'live' });
  applyPicks(picks, pickNo);
}

function applyPicks(picks, pickNo) {
  const draftedIds = new Set();
  const unmatched = [];
  // In draft order, carrying what has already been taken: ambiguous namesakes
  // ("B. Robinson" = Bijan or Brian) resolve only when earlier picks are known.
  for (const p of inDraftOrder(picks)) {
    const id = index.match(p, { claimed: draftedIds });
    if (id) { draftedIds.add(id); continue; }
    // Defenses and kickers are deliberately absent from the list, so one coming
    // off the board is expected, not a matching failure.
    if (isExcludedPick(p)) continue;
    if (rankings.length) unmatched.push(pickLabel(p));
  }
  panel.update({ draftedIds, unmatched, pickNo });
}

/** Sort picks into true draft order, from either source. */
function inDraftOrder(picks) {
  const key = (p) => {
    if (Number.isFinite(p.pick_no)) return p.pick_no;
    const m = String(p._label || '').match(/^(\d+)\.(\d+)$/);
    return m ? Number(m[1]) * 1000 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
  };
  return picks.slice().sort((a, b) => key(a) - key(b));
}
