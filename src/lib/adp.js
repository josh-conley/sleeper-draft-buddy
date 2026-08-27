// Live Sleeper ADP, from Sleeper.
//
// Sleeper's season projections endpoint carries the ADP fields its own draft
// board displays — adp_half_ppr among them — keyed by the same player ids this
// extension already uses everywhere else. So the numbers here are the numbers
// on screen during the draft, by construction rather than by resemblance.
//
// This used to come from a third-party aggregator's Supabase, which meant an
// anon key in the source, a cold start measured at up to a minute, and a second
// pass to translate its ids into Sleeper's. One request replaces all of it.
//
// Still undocumented, and able to change without notice. Every caller must
// survive it failing: the ranking you already have is stored, so a failed
// update costs freshness and nothing else.

import { api } from './ext.js';

const BASE = 'https://api.sleeper.app';

/** Positions Sleeper pads with a sentinel rather than leaving blank. */
const SENTINEL_MIN = 900;

const TIMEOUT_MS = 30000;

export const ADP_KEY = 'adpV1';

/** Kickers and defenses are out of scope everywhere else in this extension. */
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

/** How deep the board goes. A 12-team, 16-round draft is 192 picks. */
export const BOARD_DEPTH = 300;

/**
 * The season a given date belongs to. The NFL year turns over in March, so
 * January and February still belong to the season that started last autumn —
 * asking for the wrong one gets an empty board rather than an error.
 */
export function seasonFor(date = new Date()) {
  return date.getMonth() >= 2 ? date.getFullYear() : date.getFullYear() - 1;
}

async function getProjections(season, attempt = 0) {
  const url = new URL(`/projections/nfl/${season}`, BASE);
  url.searchParams.set('season_type', 'regular');
  url.searchParams.set('order_by', 'adp_half_ppr');
  for (const p of POSITIONS) url.searchParams.append('position[]', p);

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (attempt < 1) return getProjections(season, attempt + 1);
    throw new Error(
      err.name === 'TimeoutError' ? 'The ADP feed did not answer in time.' : 'Could not reach the ADP feed.'
    );
  }

  if (!res.ok) throw new Error(`The ADP feed responded ${res.status}.`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('The ADP feed returned an unexpected shape.');
  return body;
}

const clean = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < SENTINEL_MIN ? v : null);

/** Rows -> the board, newest ADP first. Exported so it can be tested offline. */
export function boardFrom(rows) {
  const players = [];
  let modified = 0;

  for (const row of rows) {
    // "Sleeper ADP" on their own board is the half-PPR number.
    const adp = clean(row?.stats?.adp_half_ppr);
    if (adp == null) continue;
    const player = row.player || {};
    if (!POSITIONS.has(player.position)) continue;
    const id = row.player_id;
    if (id === null || id === undefined || id === '') continue;

    const name = [player.first_name, player.last_name].filter(Boolean).join(' ');
    if (!name) continue;

    players.push({
      id: String(id),
      name,
      position: player.position,
      team: player.team || player.team_abbr || null,
      adp,
    });
    const at = Number(row.last_modified ?? row.updated_at);
    if (Number.isFinite(at) && at > modified) modified = at;
  }

  players.sort((a, b) => a.adp - b.adp);
  return {
    // The feed dates rows by when they were last recomputed, not by a
    // published-on date, so the freshest row's stamp is the board's date.
    date: modified ? new Date(modified).toISOString().slice(0, 10) : null,
    at: Date.now(),
    players: players.slice(0, BOARD_DEPTH),
  };
}

/** The current Sleeper ADP board: QB/RB/WR/TE, best ADP first, capped. */
export async function fetchAdp(onProgress) {
  onProgress?.({ stage: 'connecting' });

  const season = seasonFor();
  let rows = await getProjections(season);
  let board = boardFrom(rows);

  // Before a season's projections are published, the current year answers with
  // nothing usable. Last season's board is stale but real, and beats an error.
  if (!board.players.length) {
    onProgress?.({ stage: 'connecting' });
    rows = await getProjections(season - 1);
    board = boardFrom(rows);
  }

  if (!board.players.length) throw new Error(`The ADP feed had no usable rows for ${season}.`);
  onProgress?.({ stage: 'matching', done: board.players.length, total: board.players.length });
  return board;
}

/** Read the cached board without going near the network. */
export async function loadAdp() {
  return (await api.storage.local.get(ADP_KEY))[ADP_KEY] || null;
}

export async function saveAdp(board) {
  await api.storage.local.set({ [ADP_KEY]: board });
  return board;
}
