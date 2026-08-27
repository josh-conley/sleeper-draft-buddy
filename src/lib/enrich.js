// Turns a bare list of player names into full ranking rows.
//
// A names-only CSV gives us nothing but an ordered list. Everything else is
// inferred:
//   rank      row order in the file (the order you typed them IS your ranking)
//   position  Sleeper's player database
//   team      Sleeper's player database
//   bye       derived from the NFL schedule (the one week a team has no game)
//   posRank   computed — Nth player of that position, by rank
//
// Any column actually present in the CSV wins over the inferred value.

import { api } from './ext.js';
import { normalize } from './names.js';
import { EXCLUDED_POSITIONS } from './parse.js';

const API = 'https://api.sleeper.app';
const CACHE_KEY = 'playerIndexV1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // the players payload is ~15MB; fetch once a day

/**
 * Slim player index: [player_id, name, position, team, search_rank].
 * The raw endpoint is ~15MB, so we shrink it to ~80KB before storing and never
 * keep the full payload around.
 */
export async function fetchPlayerIndex() {
  const res = await fetch(`${API}/v1/players/nfl`);
  if (!res.ok) throw new Error(`players/nfl HTTP ${res.status}`);
  const raw = await res.json();
  const keep = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
  const slim = [];
  for (const p of Object.values(raw)) {
    if (!keep.has(p.position)) continue;
    const rank = Number.isInteger(p.search_rank) ? p.search_rank : 9999999;
    if (p.position === 'DEF' ? !p.team : !p.team && rank === 9999999) continue;
    const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
    if (!name) continue;
    slim.push([p.player_id, name, p.position, p.team || '', rank]);
  }
  slim.sort((a, b) => a[4] - b[4]);
  return slim;
}

/** Bye week per team, derived from the schedule: the week with no game. */
export async function fetchByeWeeks(season) {
  const res = await fetch(`${API}/schedule/nfl/regular/${season}`);
  if (!res.ok) throw new Error(`schedule HTTP ${res.status}`);
  const games = await res.json();
  const played = new Map();
  let maxWeek = 0;
  for (const g of games) {
    maxWeek = Math.max(maxWeek, g.week);
    for (const t of [g.home, g.away]) {
      if (!t) continue;
      if (!played.has(t)) played.set(t, new Set());
      played.get(t).add(g.week);
    }
  }
  const byes = {};
  for (const [team, weeks] of played) {
    for (let w = 1; w <= maxWeek; w++) {
      if (!weeks.has(w)) { byes[team] = w; break; }
    }
  }
  return byes;
}

export async function getCurrentSeason() {
  try {
    const res = await fetch(`${API}/v1/state/nfl`);
    if (res.ok) return (await res.json()).season;
  } catch { /* fall through */ }
  return String(new Date().getFullYear());
}

/**
 * Load the reference data, using api.storage as a day-long cache.
 * `force` refetches even if the cache is warm.
 */
export async function loadReference({ force = false } = {}) {
  const cached = (await api.storage.local.get(CACHE_KEY))[CACHE_KEY];
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;

  const season = await getCurrentSeason();
  const [players, byes] = await Promise.all([fetchPlayerIndex(), fetchByeWeeks(season)]);
  const payload = { at: Date.now(), season, players, byes };
  await api.storage.local.set({ [CACHE_KEY]: payload });
  return payload;
}

/** Lookup keyed by normalized name; ambiguous names resolve to the better-ranked player. */
export function buildPlayerLookup(players) {
  const byName = new Map();
  const byLast = new Map();
  for (const row of players) {
    const [, name, position, team, rank] = row;
    const n = normalize(name);
    const prev = byName.get(n);
    if (!prev || rank < prev[4]) byName.set(n, row);
    const last = normalize(name.split(/\s+/).slice(-1)[0]);
    const prevL = byLast.get(last);
    if (!prevL || rank < prevL[4]) byLast.set(last, row);
  }
  return { byName, byLast };
}

/**
 * Fill in whatever the CSV did not supply.
 * Returns { rows, resolved, unresolved } — unresolved rows still appear in the
 * list (with a blank position) so nothing silently vanishes from your board.
 */
/** "JAX DST", "Ravens D/ST", "SF DEF" — recognisable even when unresolved. */
const DEF_NAME_RE = /\b(d\/?st|def|defense)\b/i;

/**
 * Re-derive the rank fields from the order the rows are in. Needed after any
 * reorder: enrichRows only fills posRank when it is missing, so without this a
 * dragged player keeps the positional rank he had three moves ago.
 */
export function renumber(rows) {
  const seen = new Map();
  return rows.map((r, i) => {
    const position = String(r.position || '').toUpperCase();
    if (!position) return { ...r, myRank: i + 1 };
    const n = (seen.get(position) || 0) + 1;
    seen.set(position, n);
    return { ...r, myRank: i + 1, posRank: `${position}${n}` };
  });
}

export function enrichRows(rows, reference) {
  const { byName, byLast } = buildPlayerLookup(reference.players);
  const byes = reference.byes || {};
  const unresolved = [];

  const out = rows.map((r, i) => {
    const hit = byName.get(normalize(r.name)) || byLast.get(normalize(r.name.split(/\s+/).slice(-1)[0]));
    if (!hit) unresolved.push(r.name);
    const position = r.position || (hit ? hit[2] : null);
    const team = r.team || (hit ? hit[3] : null);
    return {
      ...r,
      // The order you listed them in IS your ranking, unless you gave a rank.
      myRank: r.myRank ?? i + 1,
      position,
      team,
      bye: r.bye ?? (team ? byes[team] ?? null : null),
      sleeperId: hit ? hit[0] : null,
      inferred: {
        position: !r.position && !!position,
        team: !r.team && !!team,
        bye: r.bye == null && team != null && byes[team] != null,
      },
    };
  });

  // Drop defenses and kickers here as well as at ingest. A names-only paste has
  // no position column, so ingest-time exclusion cannot fire — the position is
  // only known once inference has run. Names we could not resolve are matched
  // on shape instead, so "JAX DST" goes too.
  const kept = out.filter(
    (r) => !EXCLUDED_POSITIONS.has(String(r.position || '').toUpperCase()) && !DEF_NAME_RE.test(r.name)
  );
  const dropped = out.length - kept.length;

  // Positional rank: Nth player of that position, in your rank order.
  const seen = new Map();
  kept
    .slice()
    .sort((a, b) => a.myRank - b.myRank)
    .forEach((r) => {
      if (!r.position) return;
      const n = (seen.get(r.position) || 0) + 1;
      seen.set(r.position, n);
      if (!r.posRank) r.posRank = `${r.position}${n}`;
    });

  const stillUnresolved = unresolved.filter((n) => !DEF_NAME_RE.test(n));
  return {
    rows: kept,
    resolved: kept.length - stillUnresolved.length,
    unresolved: stillUnresolved,
    dropped,
  };
}
