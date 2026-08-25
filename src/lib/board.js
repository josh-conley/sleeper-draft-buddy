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

const PICK_RE = /^(\d{1,2})\.(\d{1,2})$/;

/** Text leaves of an element, skipping SVG-internal text. */
function leaves(el) {
  return [...el.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && !e.closest('svg'))
    .map((e) => e.textContent.trim())
    .filter(Boolean);
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

  detect: (root) => !!root.querySelector(betaAdapter.SELECTORS.pickedCell + ', ' + betaAdapter.SELECTORS.clockCell),

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
    const cell = root.querySelector(this.SELECTORS.clockCell);
    if (!cell) return null;
    return leaves(cell).find((t) => PICK_RE.test(t)) || null;
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

  detect: (root) => !!root.querySelector(legacyAdapter.SELECTORS.pickedCell + ', ' + legacyAdapter.SELECTORS.clockCell),

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
    const cell = root.querySelector(this.SELECTORS.clockCell);
    if (!cell) return null;
    const p = cell.querySelector(this.SELECTORS.pick)?.textContent.trim();
    if (p && PICK_RE.test(p)) return p;
    return leaves(cell).find((t) => PICK_RE.test(t)) || null;
  },
};

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
