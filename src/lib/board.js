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

  // Cell contains .pick "1.1", .player-name "J. Gibbs", .position "RB - DET".
  // NOTE the abbreviated first name — full-name matching cannot work here, so
  // names.js falls through to its last-name + position + team tier.
  parseCell(cell) {
    const s = this.SELECTORS;
    const label = cell.querySelector(s.pick)?.textContent.trim() || null;
    const name = cell.querySelector(s.name)?.textContent.trim() || '';
    const posTeam = cell.querySelector(s.position)?.textContent.trim() || '';
    const m = posTeam.match(/^([A-Za-z/]+)\s*-\s*([A-Za-z]{2,3})$/);
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
// Fallback for working out YOUR draft slot when the API cannot say — a public
// mock has no draft_order to look you up in.
//
// Both boards label every cell, drafted or empty ("1.02", "2.11"), and both lay
// the columns out left to right in slot order. So the labels themselves
// calibrate the grid: read each label, work out which slot it belongs to, and
// the cell's horizontal centre becomes that column's x. Your name in the header
// then lands in one of those columns.
//
// This finds your SLOT — where you drafted from. It deliberately does not try
// to answer "is it my turn", because a traded pick is drafted by someone who
// does not own the column it sits in. Ownership lives in turn.js.


const MIN_COL_W = 56;
const MAX_COL_W = 400;

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
    if (!xs.has(slot)) xs.set(slot, []);
    xs.get(slot).push(r.x + r.width / 2);
  }
  return [...xs.entries()]
    .map(([slot, list]) => ({ slot, cx: list.reduce((a, b) => a + b, 0) / list.length }))
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

/**
 * Your slot, by finding your account name in the board header.
 *
 * The header is above the grid, so candidates are ranked by how high they sit —
 * your name also appears in side panels ("drafted players: JoshC94"), and those
 * are both lower down and usually outside the grid's columns.
 *
 * @param {string[]} names  display name and username
 */
export function readOwnSlot(root = document, names = [], opts = {}) {
  const wanted = names.map((n) => String(n).trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return null;
  const rectOf = opts.rectOf || ((e) => e.getBoundingClientRect());
  const columns = opts.columns || readColumns(root, { ...opts, rectOf });
  if (columns.length < 2) return null;

  const hits = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.children.length) continue;
    const t = el.textContent.trim();
    if (t.length > 40 || !wanted.includes(t.toLowerCase())) continue;
    const r = rectOf(el);
    const slot = columnAt(columns, r.x + r.width / 2);
    if (slot) hits.push({ slot, y: r.y });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.y - b.y);
  return hits[0].slot;
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
export function watchBoard(onChange, { debounceMs = 150, selfTestMs = 8000 } = {}) {
  let timer = null;
  let lastKey = null;
  let adapter = null;
  let sawBoard = false;

  const scan = () => {
    if (!adapter) adapter = detectAdapter();
    const res = readBoard(document, adapter);
    if (res.adapter) { adapter = res.adapter; sawBoard = true; }
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
