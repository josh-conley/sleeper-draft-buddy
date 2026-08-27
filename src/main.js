// Entry point: detect the draft, boot the panel, keep it in sync.

import { api } from './lib/ext.js';
import * as store from './lib/store.js';
import { buildIndex, pickLabel } from './lib/names.js';
import { isExcludedPick } from './lib/parse.js';
import { loadReference, enrichRows, renumber } from './lib/enrich.js';
import { getDraftId, onUrlChange, DraftPoller } from './lib/draft.js';
import { watchBoard, labelToPickNo, readColumns, readHeaders, readOwners } from './lib/board.js';
import { readSleeperUserId, fetchUserNames } from './lib/whoami.js';
import { ownedPickNos, slotPickNos, applyBoardOwnership, slotOfUsername, usernameOnBoard } from './lib/turn.js';
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

let draftMeta = null;
// The names the signed-in Sleeper account answers to. This is how the panel
// finds your team on the board — read once, never typed, never stored.
let myNames = [];
// Ownership read off the board: who sits above each column, and who drafts each
// pick. This is the primary answer to "is it my turn" — see readOwners().
let boardHeaders = new Map();
let boardOwners = new Map();

export async function boot() {
  if (booted) return;
  booted = true;
  await loadIdentity();
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
  const cssText = await fetch(api.runtime.getURL('src/panel/panel.css')).then((r) => r.text());
  const settings = await store.getSettings();
  rankings = (await store.get(store.KEYS.rankings)) || [];
  index = buildIndex(rankings);

  panel = new Panel(cssText, settings, {
    onSettingsChange: (patch) =>
      store.patchSettings(patch).then(() => {
        if (patch.pollMs && poller) poller.setInterval(patch.pollMs);
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
    onReorder: (fromId, toId) => reorder(fromId, toId),
  });

  panel.update({ rankings });
  window.addEventListener('resize', () => panel.applyGeometry());
  ensureReference().then(() => { if (rankings.length) reEnrich(); });
  if (!rankings.length) seedIfEmpty();
}

/**
 * A panel opening onto an empty board asks for a starting ranking.
 *
 * The install-time seed is the normal route; this is what covers an install
 * that happened offline, or one whose first ADP pull failed. Seeding happens in
 * the service worker rather than here so that two draft tabs opened at once
 * cannot both write a list.
 */
async function seedIfEmpty() {
  try {
    const res = await api.runtime.sendMessage({ type: 'rankings:seed' });
    if (!res?.seeded) return;
    // Read it back through the same path an edit elsewhere takes, so there is
    // one way rankings arrive in this module rather than two.
    await reloadRankings();
    console.info(`${LOG} seeded ${res.count} players in Sleeper ADP order`);
  } catch (err) {
    console.warn(`${LOG} could not seed a starting ranking: ${err.message}`);
  }
}

/**
 * Move one player to another's slot. Applied to the full list by their two
 * positions in it, so it is a valid reordering however filtered the view is —
 * which is the normal case mid-draft.
 */
async function reorder(fromId, toId) {
  const from = rankings.findIndex((r) => r.id === fromId);
  const to = rankings.findIndex((r) => r.id === toId);
  if (from === -1 || to === -1 || from === to) return;

  const next = [...rankings];
  next.splice(to, 0, next.splice(from, 1)[0]);
  rankings = renumber(next);
  index = buildIndex(rankings);
  await store.set(store.KEYS.rankings, rankings);
  panel.update({ rankings });
  mergePicks();
}

/** Two lists are the same board if the same players sit in the same order. */
const sameOrder = (a, b) =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id && r.name === b[i].name);

/**
 * Pick up rankings edited elsewhere — the My Rankings tab, or another draft
 * window. Compared rather than timed: this fires for our own writes too, and a
 * reload on those would fight the user mid-drag.
 */
async function reloadRankings() {
  const stored = (await store.get(store.KEYS.rankings)) || [];
  if (sameOrder(stored, rankings)) return false;
  rankings = stored;
  index = buildIndex(rankings);
  panel.update({ rankings });
  mergePicks();
  console.log(`${LOG} rankings reloaded — ${rankings.length} players`);
  return true;
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[store.KEYS.rankings] && panel) reloadRankings();
});

api.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type !== 'rankings:reload') return false;
  reloadRankings().then((changed) => respond({ ok: true, changed, count: rankings.length }));
  return true;
});

/** Player database + bye weeks, cached for a day in api.storage. */
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

/**
 * The signed-in Sleeper account.
 *
 * Read from sleeper.com's own storage, which a content script shares, then
 * turned into the names the board's header row might show. Held in memory only:
 * nothing is persisted, so it cannot go stale against a different login, and
 * there is nothing for the user to fill in.
 */
async function loadIdentity() {
  try {
    const userId = readSleeperUserId(window);
    if (!userId) {
      console.warn(`${LOG} not signed in to Sleeper — cannot tell which team is yours`);
      return;
    }
    myNames = await fetchUserNames(userId);
    console.info(`${LOG} signed in as ${myNames[0] || userId}`);
  } catch (err) {
    console.warn(`${LOG} could not identify the signed-in user: ${err.message}`);
  }
}

/**
 * Read who owns what off the board.
 *
 * Both boards name the acquiring team inside a traded pick's cell, so this is
 * the one source that gets trades right without asking Sleeper's API — and the
 * only one that works on a mock, where there is no draft order to look anyone
 * up in.
 */
function readOwnership() {
  try {
    const type = draftMeta?.type || 'snake';
    const columns = readColumns(document, { teams, type });
    if (columns.length < 2) return false;
    const headers = readHeaders(document, { teams, type, columns });
    const owners = readOwners(document, { teams, type, columns, headers });

    // Only report a change when one actually happened: this runs on every
    // debounced board mutation, and re-rendering 300 rows for an unchanged
    // answer would be the expensive half of doing it that often.
    const before = ownershipKey();
    boardHeaders = headers;
    boardOwners = owners;
    return ownershipKey() !== before;
  } catch (err) {
    console.warn(`${LOG} could not read pick ownership from the board: ${err.message}`);
    return false;
  }
}

const ownershipKey = () =>
  `${[...boardHeaders].join('|')}#${[...boardOwners].join('|')}`;

/**
 * The overall pick numbers you own, trades included.
 *
 * Built from two sources because neither is complete on its own:
 *
 *   Sleeper's traded_picks feed covers every round whether or not the pick has
 *   been made, which is what the countdown needs — it looks forward. It is
 *   empty for mock drafts.
 *
 *   The board is the truth for any cell actually on screen, works on mocks, and
 *   needs no API at all. What it says about a pick nobody has made yet is not
 *   something this code relies on.
 *
 * The feed lays the base; the board overrides it. Nothing is inferred: with no
 * idea which team is yours, the answer is null and the panel says so.
 */
function ownPicks() {
  if (!teams) return null;
  const slot = slotOfUsername(boardHeaders, myNames);
  const rounds = draftMeta?.settings?.rounds || 15;
  const type = draftMeta?.type || 'snake';

  let base = null;
  if (slot) {
    const slotToRoster = draftMeta?.slot_to_roster_id || null;
    base = slotToRoster
      ? ownedPickNos({
          slot, teams, rounds, type,
          traded: draftMeta?.traded_picks || [],
          slotToRoster,
          rosterId: slotToRoster[slot] ?? slotToRoster[String(slot)],
        })
      : new Set(slotPickNos(slot, teams, rounds, type));
  }
  if (!base && !boardOwners.size) return null;

  const mine = applyBoardOwnership(base, boardOwners, myNames, teams);
  return mine.size ? mine : null;
}

/** Push the board's answer about your picks into the panel. */
function pushOwnership() {
  panel.update({
    ownPicks: ownPicks(),
    myNames,
    boardNames: [...boardHeaders.values()],
    // null while there is no board to check against, so "not found" only ever
    // means the board was read and the account genuinely was not on it.
    usernameFound: !myNames.length || !boardHeaders.size ? null : usernameOnBoard(boardHeaders, myNames),
  });
}

async function attach(id) {
  if (!id || id === draftId) return;
  poller?.stop();
  stopBoard?.();
  draftId = id;
  boardPicks = [];
  apiPicks = [];
  boardClockLabel = null;
  draftMeta = null;
  boardHeaders = new Map();
  boardOwners = new Map();
  panel.update({ ownPicks: null, boardNames: [], usernameFound: null });
  manualIds = new Set(await store.getManualDrafted(draftId));
  panel.update({ manualIds: new Set(manualIds), draftedIds: new Set(), unmatched: [], pickNo: null });
  console.info(`${LOG} tracking draft ${draftId}`);

  poller = new DraftPoller(draftId, {
    onMeta: (draft) => {
      draftMeta = draft || null;
      teams = draft?.settings?.teams ?? null;
      panel.update({ teams, type: draft?.type || 'snake' });
      pushOwnership();
    },
    onPicks: (picks) => { apiPicks = picks || []; mergePicks(); },
    onStatus: ({ state, error }) => {
      if (error) console.warn(`${LOG} poll ${state}: ${error}`);
      if (!boardPicks.length) panel.update({ status: state });
    },
  });
  await poller.start(panel.settings.pollMs);

  stopBoard = watchBoard(
    ({ adapter, picks, clockLabel }) => {
      boardPicks = picks || [];
      boardClockLabel = clockLabel;
      if (adapter) panel.update({ boardKind: adapter.id });
      readOwnership();
      pushOwnership();
      mergePicks();
    },
    {
      // A trade re-badges a cell without adding a pick, so ownership is re-read
      // on every board change rather than only when somebody drafts.
      onScan: () => { if (readOwnership()) pushOwnership(); },
    }
  );
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
