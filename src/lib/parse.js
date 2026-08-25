// Ingest: accepts anything from a bare newline-separated list of names up to a
// full CSV. Only the player name is required; everything else is inferred by
// enrich.js, and any column you do supply overrides the inference.

export const FIELDS = [
  { key: 'myRank', label: 'Rank', type: 'num' },
  { key: 'posRank', label: 'Pos Rank', type: 'text' },
  { key: 'position', label: 'Pos', type: 'text' },
  { key: 'name', label: 'Player', type: 'text' },
  { key: 'bye', label: 'Bye', type: 'num' },
  { key: 'team', label: 'Team', type: 'text' },
];

// Defenses and kickers are out of scope: not ranked, not filtered, not shown.
// Picks of these positions are also excluded from the "unmatched" warning so
// drafting one never looks like a matching failure.
export const EXCLUDED_POSITIONS = new Set(['DEF', 'DST', 'D/ST', 'K', 'PK']);

export function isExcludedPick(pick) {
  const pos = String(pick?.metadata?.position || '').toUpperCase();
  return EXCLUDED_POSITIONS.has(pos);
}

const SYNONYMS = {
  myRank: ['rank', 'myrank', 'overall', 'ovr', '#', 'no', 'rk'],
  posRank: ['posrank', 'positionalrank', 'positionrank', 'prk', 'posrk'],
  position: ['position', 'pos'],
  name: ['playername', 'player', 'name', 'players'],
  bye: ['bye', 'byeweek', 'byewk'],
  team: ['team', 'tm', 'nflteam'],
};

const NUMERIC = new Set(FIELDS.filter((f) => f.type === 'num').map((f) => f.key));

const normHeader = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9#]/g, '');

function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function guessField(header, taken) {
  const h = normHeader(header);
  if (!h) return null;
  for (const [k, syns] of Object.entries(SYNONYMS)) if (!taken.has(k) && syns.includes(h)) return k;
  for (const [k, syns] of Object.entries(SYNONYMS)) {
    if (taken.has(k)) continue;
    if (syns.some((s) => s.length >= 3 && h.includes(s))) return k;
  }
  return null;
}

export function detectMapping(cells) {
  const taken = new Set();
  return cells.map((c) => {
    const k = guessField(c, taken);
    if (k) taken.add(k);
    return k;
  });
}

/**
 * Strip a leading rank that people paste inline: "1. Ja'Marr Chase",
 * "1 Ja'Marr Chase", "1) Ja'Marr Chase". Returns [name, rank|null].
 */
export function splitLeadingRank(s) {
  const m = String(s).match(/^\s*(\d{1,3})\s*[.):-]?\s+(.+)$/);
  if (!m) return [String(s).trim(), null];
  return [m[2].trim(), Number(m[1])];
}

/**
 * Parse pasted text. Handles:
 *   - one name per line, no header       -> single column
 *   - "1. Name" per line                 -> rank stripped out
 *   - CSV/TSV with or without a header   -> mapped by header, else by position
 */
export function parsePaste(text) {
  if (!text || !text.trim()) throw new Error('Nothing to parse — the box is empty.');

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) throw new Error('No rows found.');

  const delim = lines.some((l) => l.includes('\t')) ? '\t' : ',';
  const rows = lines.map((l) => splitLine(l, delim));
  const width = Math.max(...rows.map((r) => r.length));

  // Single column: a bare list of names. No header, no mapping questions.
  if (width === 1) {
    const first = rows[0][0];
    const headerish = ['player', 'players', 'name', 'playername'].includes(normHeader(first));
    const body = headerish ? rows.slice(1) : rows;
    if (!body.length) throw new Error('Found a header but no names underneath it.');
    return {
      namesOnly: true,
      headerCells: ['Player'],
      mapping: ['name'],
      rows: body,
      hasHeader: headerish,
    };
  }

  const firstMapping = detectMapping(rows[0]);
  const matched = firstMapping.filter(Boolean).length;
  const numericCells = rows[0].filter((c) => c !== '' && !Number.isNaN(Number(c))).length;
  const hasHeader = matched >= 2 && numericCells < rows[0].length / 2;

  const headerCells = hasHeader ? rows[0] : rows[0].map((_, i) => `Column ${i + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (!dataRows.length) throw new Error('Found a header row but no player rows underneath it.');

  let mapping;
  if (hasHeader) {
    mapping = firstMapping;
  } else {
    // No header: guess by shape. The name is the column with the most spaces
    // and fewest numbers; a leading all-numeric column is the rank.
    mapping = Array(width).fill(null);
    const score = (col) =>
      dataRows.reduce((acc, r) => acc + (/[a-z]{2,}\s+[a-z]{2,}/i.test(r[col] || '') ? 1 : 0), 0);
    let nameCol = 0;
    let best = -1;
    for (let c = 0; c < width; c++) { const s = score(c); if (s > best) { best = s; nameCol = c; } }
    mapping[nameCol] = 'name';
    const allNum = (col) => dataRows.every((r) => r[col] === '' || !Number.isNaN(Number(r[col])));
    if (nameCol > 0 && allNum(0)) mapping[0] = 'myRank';
  }

  if (!mapping.includes('name')) {
    throw new Error(
      'Could not tell which column holds the player name. Add a "Player" header row, or paste just the names one per line.'
    );
  }
  return { namesOnly: false, headerCells, mapping, rows: dataRows, hasHeader };
}

function coerce(key, raw) {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  if (NUMERIC.has(key)) {
    const n = Number(v.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

/** Apply a mapping to raw rows. Inference happens later, in enrich.js. */
export function buildRows(rows, mapping) {
  const out = [];
  rows.forEach((cells, i) => {
    const rec = { id: `r${i}` };
    mapping.forEach((key, col) => {
      if (!key) return;
      rec[key] = coerce(key, cells[col]);
    });
    if (!rec.name) return;

    // "1. Ja'Marr Chase" pasted as one column: pull the rank out of the name.
    const [name, inlineRank] = splitLeadingRank(rec.name);
    rec.name = name;
    if (rec.myRank == null && inlineRank != null) rec.myRank = inlineRank;

    if (rec.position) rec.position = String(rec.position).toUpperCase();
    if (rec.team) rec.team = String(rec.team).toUpperCase();
    if (EXCLUDED_POSITIONS.has(rec.position)) return;
    out.push(rec);
  });
  if (!out.length) throw new Error('No rows had a player name.');
  return out;
}
