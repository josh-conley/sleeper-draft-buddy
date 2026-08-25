// Name normalization and matching draft picks to ranking rows.

const SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'`’]/g, '')
    .replace(SUFFIXES, '')
    .replace(/[^a-z0-9]/g, '');
}

// Add entries here when a pick keeps failing to match. Both sides get
// normalized, so write them however you like. Key = variant, value = canonical.
export const ALIASES = {
  hollywoodbrown: 'marquisebrown',
  gabedavis: 'gabrieldavis',
  joshuapalmer: 'joshpalmer',
  mitchelltrubisky: 'mitchtrubisky',
};

const canon = (n) => ALIASES[n] || n;

/**
 * Surname variants for a full name. Two are needed because the two sides
 * disagree about where a surname starts: the classic Sleeper board abbreviates
 * to "A. St. Brown" (whose last_name parses as "St. Brown") while a ranking row
 * says "Amon-Ra St. Brown" (whose final token is just "Brown").
 */
function lastNameVariants(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  if (parts.length === 1) return [parts[0]];
  return [...new Set([parts[parts.length - 1], parts.slice(1).join(' ')])];
}

/** First alphabetic character of a name, so "J." and "Josh" both give "j". */
function initialOf(s) {
  const m = String(s || '').match(/[a-z]/i);
  return m ? m[0].toLowerCase() : '';
}

/**
 * Build lookup tables from ranking rows.
 *
 * Returns { match(pick, opts) } where opts is:
 *   claimed  Set of row ids already taken by earlier picks
 *   pickNo   absolute pick number, used to break ties by rank proximity
 *
 * Surname keys map to *lists*, not single ids, because the classic board's
 * abbreviated names ("B. Robinson") are frequently ambiguous — a list with both
 * Bijan Robinson (RB ATL) and Brian Robinson (RB ATL) cannot be resolved from
 * surname, position and team alone. Disambiguation happens at match time, where
 * the first initial, the picks already made, and the pick number are known.
 */
export function buildIndex(rankings) {
  const byNamePos = new Map();
  const byName = new Map();
  const byLastPosTeam = new Map();
  const byTeamDef = new Map();
  const rowById = new Map();

  for (const r of rankings) {
    rowById.set(r.id, r);
    const n = canon(normalize(r.name));
    const pos = (r.position || '').toUpperCase();
    const team = (r.team || '').toUpperCase();

    if (pos) setOnce(byNamePos, `${n}|${pos}`, r.id);
    setOnce(byName, n, r.id);
    if (pos && team) {
      for (const v of lastNameVariants(r.name)) push(byLastPosTeam, `${normalize(v)}|${pos}|${team}`, r.id);
    }
    if (pos === 'DEF' || pos === 'DST') {
      if (team) setOnce(byTeamDef, team, r.id);
      setOnce(byTeamDef, n, r.id);
    }
  }

  // Exact-name maps: first writer wins, and a genuine collision is recorded as
  // null so we never confidently return the wrong player.
  function setOnce(map, key, val) {
    if (!key || key.startsWith('|')) return;
    if (map.has(key)) { if (map.get(key) !== val) map.set(key, null); return; }
    map.set(key, val);
  }

  function push(map, key, val) {
    if (!key || key.startsWith('|')) return;
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key);
    if (!arr.includes(val)) arr.push(val);
  }

  function match(pick, { claimed = null } = {}) {
    const md = pick.metadata || {};
    const pos = String(md.position || '').toUpperCase();
    const team = String(md.team || '').toUpperCase();
    const first = md.first_name || '';
    const last = md.last_name || '';
    const full = `${first} ${last}`.trim();
    const n = canon(normalize(full));

    if (pos === 'DEF' || pos === 'DST') {
      const hit = byTeamDef.get(team) || byTeamDef.get(normalize(last)) || byTeamDef.get(n);
      if (hit) return hit;
    }

    // Tier 1 & 2: an exact full-name match needs no disambiguation.
    const exact = byNamePos.get(`${n}|${pos}`) || byName.get(n);
    if (exact) return exact;

    // Tier 3: surname + position + team, then narrow the candidates.
    let candidates = [];
    for (const v of lastNameVariants(full)) {
      const arr = byLastPosTeam.get(`${normalize(v)}|${pos}|${team}`);
      if (arr) for (const id of arr) if (!candidates.includes(id)) candidates.push(id);
    }
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    // The board gives us a first initial even when it abbreviates the name.
    const ini = initialOf(first);
    if (ini) {
      const byIni = candidates.filter((id) => initialOf(rowById.get(id)?.name) === ini);
      if (byIni.length === 1) return byIni[0];
      if (byIni.length) candidates = byIni;
    }

    // A player already taken by an earlier pick cannot be this pick.
    if (claimed) {
      const free = candidates.filter((id) => !claimed.has(id));
      if (free.length === 1) return free[0];
      if (free.length) candidates = free;
    }

    // Still tied: the best-ranked candidate still on the board is the pick.
    // Ambiguous namesakes come off the board in rank order, so the first
    // "B. Robinson" drafted is Bijan (rank 2) and a later one is Brian (168).
    // This holds no matter when either is taken, which a "rank nearest to this
    // pick number" rule would not — that would call a fallen Bijan "Brian".
    let best = null;
    let bestRank = Infinity;
    for (const id of candidates) {
      const rank = rowById.get(id)?.myRank;
      if (Number.isFinite(rank) && rank < bestRank) { bestRank = rank; best = id; }
    }
    return best || candidates[0];
  }

  return { match };
}

/** Human-readable name for a pick, used in the unmatched list. */
export function pickLabel(pick) {
  const md = pick.metadata || {};
  const name = `${md.first_name || ''} ${md.last_name || ''}`.trim() || `player ${pick.player_id}`;
  const tag = [md.position, md.team].filter(Boolean).join(' · ');
  return tag ? `${name} (${tag})` : name;
}
