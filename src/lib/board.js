// Reads picks and the on-the-clock pick off the Sleeper draft board DOM.
//
// Two boards are in the wild and they share no markup:
//   legacy  sleeper.com/draft/nfl/<id>       semantic classes (.cell.drafted)
//   beta    sleeper.com/beta/draft/nfl/<id>  utility classes (bg-dls-picked-*)
//
// Each is handled by an ADAPTER. detectAdapter() picks whichever one actually
// finds board markup, so the URL shape is never load-bearing.
//
// Reading the DOM is required, not merely convenient: Sleeper's public REST API
// reports no picks at all for mock drafts (/picks stays [] and status stays
// "pre_draft") because live state travels over a WebSocket.

import { slotForPick } from './draft.js';

const PICK_RE = /^(\d{1,2})\.(\d{1,2})$/;

/** Text leaves of an element, skipping SVG-internal text. */
function leaves(el) {
  return [...el.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && !e.closest('svg'))
    .map((e) => e.textContent.trim())
    .filter(Boolean);
}

/**
 * The pick label ("1.03") inside a cell, if it has one.
 *
 * Load-bearing rather than cosmetic: the beta board's utility classes are not
 * unique to the grid — bg-dls-alert-warning also colours the position chips in
 * the roster panel — so "is this a board cell?" has to be answered by what the
 * element contains, not by what it is called.
 */
function pickLabelIn(el) {
  return leaves(el).find((t) => PICK_RE.test(t)) || null;
}

/** The first element matching `sel` that actually holds a pick label. */
function labelledCell(root, sel) {
  for (const el of root.querySelectorAll(sel)) {
    if (pickLabelIn(el)) return el;
  }
  return null;
}

function toPick(name, position, team, label) {
  if (!name || !label) return null;
  const parts = name.split(/\s+/);
  return {
    // Shaped like a Sleeper API pick so names.js matches it unchanged.
    player_id: null,
    metadata: {
      first_name: parts[0] || '',
      last_name: parts.slice(1).join(' ') || parts[0] || '',
      position: position || null,
      team: team || '',
    },
    _label: label,
  };
}

// ---------------------------------------------------------------- beta board

export const betaAdapter = {
  id: 'beta',
  SELECTORS: {
    pickedCell: '[class*="bg-dls-picked-"]',
    clockCell: '[class*="bg-dls-alert-warning"]',
    positionFromClass: /bg-dls-picked-([a-z]+)/,
  },

  detect: (root) =>
    !!labelledCell(root, betaAdapter.SELECTORS.pickedCell + ', ' + betaAdapter.SELECTORS.clockCell),

  // A cell reads: ["Jahmyr", "Gibbs", "•", "DET", "(6)", "1.1"]
  // Badge icons carry an SVG <title> ("Rookie") that must not join the name.
  parseCell(cell) {
    const m = String(cell.className).match(this.SELECTORS.positionFromClass);
    const position = m ? m[1].toUpperCase() : null;
    let label = null;
    let team = null;
    let seenBullet = false;
    const nameToks = [];
    for (const t of leaves(cell)) {
      if (PICK_RE.test(t)) { label = t; continue; }
      if (/^\(\d{1,2}\)$/.test(t)) continue;
      if (t === '•') { seenBullet = true; continue; }
      if (seenBullet && /^[A-Z]{2,3}$/.test(t)) { team = t; continue; }
      if (!seenBullet) nameToks.push(t);
    }
    return toPick(nameToks.join(' '), position, team, label);
  },

  readPicks(root) {
    return [...root.querySelectorAll(this.SELECTORS.pickedCell)]
      .map((c) => this.parseCell(c))
      .filter(Boolean);
  },

  readClockLabel(root) {
    const cell = labelledCell(root, this.SELECTORS.clockCell);
    return cell ? pickLabelIn(cell) : null;
  },
};

// -------------------------------------------------------------- legacy board

export const legacyAdapter = {
  id: 'legacy',
  SELECTORS: {
    pickedCell: '.cell.drafted',
    clockCell: '.cell.current-pick',
    pick: '.pick',
    name: '.player-name',
    position: '.position',
  },

  detect: (root) =>
    !!labelledCell(root, legacyAdapter.SELECTORS.pickedCell + ', ' + legacyAdapter.SELECTORS.clockCell),

  // Cell contains .pick "1.1", .player-name "J. Gibbs", .position "RB - DET (6)".
  // NOTE the abbreviated first name — full-name matching cannot work here, so
  // names.js falls through to its last-name + position + team tier, and that
  // tier is only reachable if BOTH position and team parse.
  //
  // The trailing bye is optional in the pattern for exactly that reason: it is
  // present on the live board and was absent from the fixture this was written
  // against, so an anchored match silently produced a null position and team
  // for every cell, and a completed 180-pick board matched nothing at all.
  parseCell(cell) {
    const s = this.SELECTORS;
    const label = cell.querySelector(s.pick)?.textContent.trim() || null;
    const name = cell.querySelector(s.name)?.textContent.trim() || '';
    const posTeam = cell.querySelector(s.position)?.textContent.trim() || '';
    const m = posTeam.match(/^([A-Za-z/]+)\s*-\s*([A-Za-z]{2,3})(?:\s*\(\d{1,2}\))?$/);
    return toPick(name, m ? m[1].toUpperCase() : null, m ? m[2].toUpperCase() : '', label);
  },

  readPicks(root) {
    return [...root.querySelectorAll(this.SELECTORS.pickedCell)]
      .map((c) => this.parseCell(c))
      .filter(Boolean);
  },

  readClockLabel(root) {
    const cell = labelledCell(root, this.SELECTORS.clockCell);
    if (!cell) return null;
    const p = cell.querySelector(this.SELECTORS.pick)?.textContent.trim();
    return p && PICK_RE.test(p) ? p : pickLabelIn(cell);
  },
};

// --------------------------------------------------------- column geometry
//
// Calibration for everything below: which column is which.
//
// Both boards label every cell, drafted or empty ("1.02", "2.11"), and both lay
// the columns out left to right in slot order. So the labels themselves
// calibrate the grid: read each label, work out which slot it belongs to, and
// the cell's horizontal centre becomes that column's x. A username in the
// header row then lands in one of those columns.
//
// This finds your SLOT — where you drafted from. It deliberately does not try
// to answer "is it my turn", because a traded pick is drafted by someone who
// does not own the column it sits in. Ownership lives in turn.js.


const MIN_COL_W = 56;
const MAX_COL_W = 400;
/** Rows of text this close together are treated as one row. */
const HEADER_BAND_PX = 8;

/** Walk up from a label to the cell that holds it. */
function cellOf(el, rectOf) {
  let n = el;
  for (let i = 0; i < 6 && n; i++) {
    if (rectOf(n).width >= MIN_COL_W) return n;
    n = n.parentElement;
  }
  return el;
}

/**
 * Map the board's columns: slot -> horizontal centre.
 * @returns {Array<{slot:number, cx:number}>} sorted left to right
 */
export function readColumns(root = document, { teams, type = 'snake', rectOf = (e) => e.getBoundingClientRect() } = {}) {
  if (!teams) return [];
  const xs = new Map();
  for (const el of root.querySelectorAll('div,span')) {
    if (el.children.length) continue;
    const label = el.textContent.trim();
    if (!PICK_RE.test(label)) continue;
    const r = rectOf(cellOf(el, rectOf));
    if (r.width < MIN_COL_W || r.width > MAX_COL_W) continue;
    const slot = slotForPick(labelToPickNo(label, teams), teams, type);
    if (!slot) continue;
    if (!xs.has(slot)) xs.set(slot, { cx: [], top: Infinity });
    const col = xs.get(slot);
    col.cx.push(r.x + r.width / 2);
    if (r.y < col.top) col.top = r.y;
  }
  return [...xs.entries()]
    .map(([slot, { cx, top }]) => ({ slot, cx: cx.reduce((a, b) => a + b, 0) / cx.length, top }))
    .sort((a, b) => a.cx - b.cx);
}

/** The column whose centre is nearest x, if it is near enough to be a real hit. */
function columnAt(columns, x) {
  if (columns.length < 2) return null;
  const pitch = Math.abs(columns[1].cx - columns[0].cx) || MIN_COL_W;
  let best = null;
  for (const c of columns) {
    const d = Math.abs(c.cx - x);
    if (!best || d < best.d) best = { slot: c.slot, d };
  }
  return best && best.d <= pitch / 2 ? best.slot : null;
}

// ------------------------------------------------------------ pick ownership
//
// Who drafts each pick, read straight off the board.
//
// Every cell belongs to the team whose column it sits in, EXCEPT a traded pick,
// which both boards mark with the acquiring username inside the cell — legacy
// in a .pick-traded element, beta in a small badge pinned to the cell's corner.
// Neither is worth selecting by class: the reliable test is that the text
// matches one of the usernames in the header row, which is data the board
// itself supplies.
//
// This is what makes trades work without asking Sleeper's API anything. It is
// also the only route that works on a mock, where there is no draft order to
// look anybody up in.

/** Text of an element if it is a short, single-line leaf. */
function leafText(el) {
  if (el.children.length) return null;
  const t = el.textContent.trim();
  return t && t.length <= 30 ? t : null;
}

/**
 * The username above each column.
 *
 * Candidates are filtered by position, not by class: a name only counts if it
 * sits above the grid and lines up with a column the pick labels identified.
 * Chat buttons and side panels are excluded by geometry alone, which survives
 * a restyle in a way that a class list does not.
 *
 * @returns {Map<number, string>} slot -> username
 */
export function readHeaders(root = document, opts = {}) {
  const rectOf = opts.rectOf || ((e) => e.getBoundingClientRect());
  const columns = opts.columns || readColumns(root, { ...opts, rectOf });
  if (columns.length < 2) return new Map();

  const gridTop = opts.gridTop ?? Math.min(...columns.map((c) => c.top ?? Infinity));
  const candidates = [];
  for (const el of root.querySelectorAll('div,span,h1,h2,h3,button,a')) {
    const text = leafText(el);
    if (!text || PICK_RE.test(text)) continue;
    const r = rectOf(el);
    if (Number.isFinite(gridTop) && r.y >= gridTop) continue;
    const slot = columnAt(columns, r.x + r.width / 2);
    if (!slot) continue;
    candidates.push({ text, slot, y: r.y });
  }

  // Group what is left into horizontal bands. Taking the topmost name per
  // column instead would pick up whatever page furniture sits above the board —
  // "Flip board layout", "Draft Completed" — and on a real draft that silently
  // stole five of the twelve columns, this user's included.
  candidates.sort((a, b) => a.y - b.y);
  const bands = [];
  for (const c of candidates) {
    const band = bands.find((b) => Math.abs(b.y - c.y) <= HEADER_BAND_PX);
    if (band) { band.items.push(c); band.y = (band.y + c.y) / 2; }
    else bands.push({ y: c.y, items: [c] });
  }

  // The header row is the one row that spans the most columns; a toolbar spans
  // two or three. Ties go to whichever sits closest to the grid.
  let best = null;
  for (const b of bands) {
    const cover = new Set(b.items.map((i) => i.slot)).size;
    if (!best || cover > best.cover || (cover === best.cover && b.y > best.y)) {
      best = { cover, y: b.y, items: b.items };
    }
  }
  const out = new Map();
  for (const i of best?.items || []) if (!out.has(i.slot)) out.set(i.slot, i.text);
  return out;
}

/**
 * Who owns each pick on the board.
 *
 * @returns {Map<string, string>} pick label ("3.07") -> username
 */
export function readOwners(root = document, opts = {}) {
  const rectOf = opts.rectOf || ((e) => e.getBoundingClientRect());
  const columns = opts.columns || readColumns(root, { ...opts, rectOf });
  const headers = opts.headers || readHeaders(root, { ...opts, columns, rectOf });
  if (!headers.size) return new Map();

  const known = new Set([...headers.values()].map((n) => n.toLowerCase()));
  const owners = new Map();

  for (const el of root.querySelectorAll('div,span')) {
    const text = leafText(el);
    if (!text || !PICK_RE.test(text)) continue;
    const cell = cellOf(el, rectOf);
    const r = rectOf(cell);
    if (r.width < MIN_COL_W || r.width > MAX_COL_W) continue;

    // A username inside the cell means the pick was traded to that person; with
    // no badge it belongs to whoever sits above the column.
    const badge = [...cell.querySelectorAll('div,span')]
      .map(leafText)
      .find((t) => t && known.has(t.toLowerCase()));
    const slot = columnAt(columns, r.x + r.width / 2);
    const owner = badge || (slot ? headers.get(slot) : null);
    if (owner) owners.set(text, owner);
  }
  return owners;
}

export const ADAPTERS = [betaAdapter, legacyAdapter];

export function detectAdapter(root = document) {
  return ADAPTERS.find((a) => a.detect(root)) || null;
}

export function cmpLabel(a, b) {
  const [ar, ap] = a.split('.').map(Number);
  const [br, bp] = b.split('.').map(Number);
  return ar - br || ap - bp;
}

/** "2.3" + 12 teams -> absolute pick 15. */
export function labelToPickNo(label, teams) {
  const m = String(label || '').match(PICK_RE);
  if (!m || !teams) return null;
  return (Number(m[1]) - 1) * teams + Number(m[2]);
}

/**
 * Read the whole board once.
 * Returns { adapter, picks, clockLabel } with picks in true draft order.
 */
export function readBoard(root = document, adapter = detectAdapter(root)) {
  if (!adapter) return { adapter: null, picks: [], clockLabel: null };
  const picks = adapter.readPicks(root);
  picks.sort((a, b) => cmpLabel(a._label, b._label));
  return { adapter, picks, clockLabel: adapter.readClockLabel(root) };
}

/**
 * Watch the board. Calls onChange({adapter, picks, clockLabel}) whenever the
 * set of made picks or the on-the-clock pick changes. Returns stop().
 */
export function watchBoard(onChange, { debounceMs = 150, selfTestMs = 8000, onScan = null } = {}) {
  let timer = null;
  let lastKey = null;
  let adapter = null;
  let sawBoard = false;

  const scan = () => {
    if (!adapter) adapter = detectAdapter();
    const res = readBoard(document, adapter);
    if (res.adapter) { adapter = res.adapter; sawBoard = true; }

    // Every scan, not only the ones that changed the picks. A trade re-badges a
    // cell without adding a pick, so keying this on the pick list alone would
    // hold a stale answer until somebody drafted — for a trade agreed between
    // picks, the countdown would be wrong for exactly as long as it mattered.
    // Measured at ~3ms on a full 15-round board, behind the same debounce.
    onScan?.(res);

    const key = `${res.adapter?.id}|${res.clockLabel}|${res.picks.map((p) => p._label).join(',')}`;
    if (key === lastKey) return;
    lastKey = key;
    onChange(res);
  };

  const obs = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, debounceMs);
  });
  obs.observe(document.body, { childList: true, subtree: true });
  scan();

  const selfTest = setTimeout(() => {
    if (!sawBoard && !detectAdapter()) {
      console.warn(
        '[DraftBuddy] no draft board recognised — Sleeper markup may have changed. ' +
          'Update the adapters in src/lib/board.js. Falling back to the REST API.'
      );
      onChange({ adapter: null, picks: [], clockLabel: null });
    }
  }, selfTestMs);

  return () => { clearTimeout(timer); clearTimeout(selfTest); obs.disconnect(); };
}
