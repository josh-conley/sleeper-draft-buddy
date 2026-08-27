// The default ranking: Sleeper's ADP order, ready before you ask for it.
//
// An extension that opens onto an empty list is indistinguishable from one that
// is broken, and the draft is the worst moment to discover you have nothing to
// look at. So a fresh install seeds itself from Sleeper's ADP — a real, usable
// order on the very first draft, which you then drag into your own.
//
// Rows are built through buildRows and enrichRows, exactly as a paste is. That
// is not a detail: buildRows assigns the id every lookup in names.js is keyed
// by, and rows made by hand match no picks at all. One shape, one path in.

import * as store from './store.js';
import { buildRows } from './parse.js';
import { loadReference, enrichRows } from './enrich.js';
import { fetchAdp, loadAdp, saveAdp } from './adp.js';

/** A cached ADP board older than this is worth re-pulling before seeding. */
const STALE_MS = 12 * 60 * 60 * 1000;

/**
 * Ranking rows from a list of names, positions and byes filled in where the
 * player reference is available.
 *
 * `offset` keeps appended ids clear of the ones already on the board — reusing
 * an id would quietly transfer a mid-draft "drafted" mark to another player.
 */
export async function buildRankingRows(names, offset = 0, reference = null) {
  const built = buildRows(names.map((n) => [n]), ['name']);
  const rows = offset ? built.map((r, i) => ({ ...r, id: `r${offset + i}` })) : built;

  const ref = reference || (await loadReference().catch(() => null));
  // Without the reference the order still stands; only position, team and bye
  // are missing, and those refill on the next successful load.
  if (!ref) return rows.map((r, i) => ({ ...r, myRank: r.myRank ?? i + 1 }));
  return enrichRows(rows, ref).rows;
}

/** The ADP board, from cache when it is fresh enough and the network when not. */
export async function currentAdpBoard({ force = false } = {}) {
  const cached = await loadAdp();
  if (!force && cached?.players?.length && Date.now() - (cached.at ?? 0) < STALE_MS) return cached;
  const board = await fetchAdp();
  await saveAdp(board);
  return board;
}

/**
 * Seed the ranking list if there is not one yet.
 *
 * Deliberately refuses to touch a list that already exists: this runs at
 * install and again whenever a panel opens onto an empty board, and overwriting
 * an order somebody dragged into place would be unforgivable.
 *
 * Never throws. A failed seed leaves the extension exactly as it was, and the
 * next draft page or visit to My Rankings tries again.
 *
 * @returns {Promise<{seeded: boolean, count: number, reason?: string}>}
 */
export async function seedRankings({ force = false } = {}) {
  try {
    const existing = (await store.get(store.KEYS.rankings)) || [];
    if (existing.length && !force) return { seeded: false, count: existing.length, reason: 'already-ranked' };

    const board = await currentAdpBoard();
    if (!board?.players?.length) return { seeded: false, count: 0, reason: 'no-adp' };

    const rows = await buildRankingRows(board.players.map((p) => p.name));
    if (!rows.length) return { seeded: false, count: 0, reason: 'no-rows' };

    await store.set(store.KEYS.rankings, rows);
    return { seeded: true, count: rows.length };
  } catch (err) {
    return { seeded: false, count: 0, reason: err.message };
  }
}
