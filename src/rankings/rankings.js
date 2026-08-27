// The ranking board: where your order is made, outside of any draft.
//
// It writes exactly what a paste writes — rows built by buildRows and filled in
// by enrichRows — so the draft overlay reads one shape and one shape only, and
// the two ways of getting a list in can never drift apart.

import * as store from '../lib/store.js';
import { parsePaste, buildRows } from '../lib/parse.js';
import { loadReference, enrichRows, renumber } from '../lib/enrich.js';
import { normalize } from '../lib/names.js';
import { fetchAdp, loadAdp, saveAdp, BOARD_DEPTH } from '../lib/adp.js';
import { buildRankingRows } from '../lib/seed.js';

const $ = (id) => document.getElementById(id);
// FLEX is what you actually draft from in the middle rounds, so it earns a
// chip of its own. Same membership the draft panel uses.
const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX'];
const FLEX = new Set(['RB', 'WR', 'TE']);
const matchesFilter = (position, f) => {
  const p = String(position || '').toUpperCase();
  return f === 'ALL' || (f === 'FLEX' ? FLEX.has(p) : p === f);
};

/** Re-pull ADP if the cached board is older than this when the page opens. */
const STALE_MS = 12 * 60 * 60 * 1000;

let rows = [];
let adp = null;
let reference = null;
let sort = 'mine';
let filter = 'ALL';
let search = '';
let busy = false;
/** What the fetch is doing right now, so a slow feed reads as slow, not broken. */
let progress = null;

const adpFor = (name) => adp?.byName?.[normalize(name)] ?? null;

/** ADP joins to a ranking row by name: rows carry their own ids, not Sleeper's. */
function indexAdp(board) {
  if (!board) return null;
  const byName = {};
  for (const p of board.players) byName[normalize(p.name)] = p.adp;
  return { ...board, byName };
}

/** Plain words for each phase. */
function describeProgress(p) {
  if (!p) return 'Fetching Sleeper ADP…';
  if (p.stage === 'connecting') return 'Fetching Sleeper ADP…';
  return `Matching players… ${p.done} of ${p.total}`;
}

function note(text, kind = 'note') {
  $('note').textContent = kind === 'note' ? text : '';
  $('hint').textContent = kind === 'warn' ? text : '';
}

async function save() {
  // Renumbered on every write so nothing downstream has to guess what a gap
  // means — and so a dragged player's RB7 becomes RB4 rather than lingering.
  rows = renumber(rows);
  await store.set(store.KEYS.rankings, rows);
  render();
}

async function enrich(list) {
  reference = reference || (await loadReference().catch(() => null));
  if (!reference) return list.map((r, i) => ({ ...r, myRank: r.myRank ?? i + 1 }));
  const { rows: enriched } = enrichRows(list, reference);
  return enriched;
}

/**
 * Rows from ADP names, through the shared builder the install-time seed uses.
 * Same path in for both, so the list you get on a fresh install and the list
 * you get from this page can never be different shapes.
 */
async function rowsFromNames(names, offset = 0) {
  reference = reference || (await loadReference().catch(() => null));
  return buildRankingRows(names, offset, reference);
}

/** Seed an empty board from ADP, or fold a fresh pull into an existing one. */
async function applyAdp(board) {
  adp = indexAdp(board);
  await saveAdp(board);

  if (!rows.length) {
    rows = await rowsFromNames(board.players.map((p) => p.name));
    await save();
    note(`Seeded ${rows.length} players in Sleeper ADP order (${board.date}). Drag to make it yours.`);
    return;
  }

  // A player already ranked keeps his slot; one who has left the feed stays put
  // rather than vanishing from a list you built by hand; a new one lands at the
  // bottom where he is easy to find and disturbs nothing above him.
  const known = new Set(rows.map((r) => normalize(r.name)));
  const fresh = board.players.filter((p) => !known.has(normalize(p.name)));
  if (fresh.length) {
    const nextId = rows.length;
    const added = await rowsFromNames(fresh.map((p) => p.name), nextId);
    rows = [...rows, ...added];
    await save();
  }
  note(
    fresh.length
      ? `ADP updated (${board.date}) — ${fresh.length} new player${fresh.length === 1 ? '' : 's'} added at the bottom.`
      : `ADP updated (${board.date}).`
  );
}

async function updateAdp(auto = false) {
  if (busy) return;
  busy = true;
  $('update').disabled = true;
  $('update').textContent = 'Updating…';
  note(auto ? 'Checking for new ADP…' : 'Fetching ADP…');
  try {
    await applyAdp(
      await fetchAdp((p) => {
        progress = p;
        // Only the waiting screen and the note change; re-rendering 300 rows on
        // every batch would be six full rebuilds for a line of text.
        if (!rows.length) render();
        else note(describeProgress(p));
      })
    );
  } catch (err) {
    // What is already stored still stands, so this costs freshness and nothing
    // else. Say that, rather than implying the board is gone.
    note(`${err.message} Your rankings are unchanged.`, 'warn');
  } finally {
    busy = false;
    progress = null;
    $('update').disabled = false;
    $('update').textContent = 'Update ADP';
    render();
  }
}

function visible() {
  const term = search.trim().toLowerCase();
  const out = rows
    .map((r, i) => ({ row: r, rank: i + 1 }))
    .filter(({ row }) => matchesFilter(row.position, filter))
    .filter(({ row }) => !term || row.name.toLowerCase().includes(term));

  // Nulls sink: a player the feed does not cover should not lead the board.
  if (sort === 'adp') {
    return [...out].sort((a, b) => (adpFor(a.row.name) ?? Infinity) - (adpFor(b.row.name) ?? Infinity));
  }
  return out;
}

/** Dragging is only meaningful while the screen shows the order being rewritten. */
const draggable = () => sort === 'mine';

let dragId = null;

function render() {
  const list = $('list');
  list.textContent = '';
  const shown = visible();

  for (const { row, rank } of shown) {
    const el = document.createElement('div');
    el.className = 'row';
    el.draggable = draggable();
    el.dataset.id = row.id;

    const cell = (cls, text, pos) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      // Colour comes from the stylesheet, keyed the same way the panel keys it.
      if (pos) s.dataset.pos = pos;
      el.appendChild(s);
    };

    const pos = (row.position || '').toUpperCase();
    cell('rank', String(rank));
    // posRank already reads "RB1" — it carries the position with it, which is
    // why there is no separate position column in either table.
    cell('pos', row.posRank || pos || '—', pos);
    cell('name', row.name);
    cell('team', row.team || '—');
    cell('bye', row.bye ? String(row.bye) : '—');
    const value = adpFor(row.name);
    cell('adp', value == null ? '—' : value.toFixed(1));

    list.appendChild(el);
  }

  $('count').textContent =
    `${rows.length} players${adp?.date ? ` · ADP ${adp.date}` : ''}` +
    (shown.length !== rows.length ? ` · showing ${shown.length}` : '');

  if (!$('hint').textContent) {
    $('hint').textContent = sort === 'adp' ? 'Sorted by ADP — your order is untouched.' : '';
  }

  $('empty').hidden = shown.length > 0;
  // An empty board mid-fetch says what the fetch is doing. The alternative —
  // "press Update ADP" while an Update ADP is already running — reads as a dead
  // screen, which is exactly how a slow first load was being reported.
  $('empty').textContent = rows.length
    ? 'Nobody matches that.'
    : busy
      ? describeProgress(progress)
      : 'No rankings yet — press Update ADP to start from the market.';
}

// Drag to reorder. The move is applied to the full list by the two players'
// positions in it, so it stays a valid reordering however filtered the view is.
$('list').addEventListener('dragstart', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  dragId = row.dataset.id;
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});

$('list').addEventListener('dragover', (e) => {
  if (!dragId) return;
  e.preventDefault();
  const row = e.target.closest('.row');
  for (const r of document.querySelectorAll('.row.over')) r.classList.remove('over');
  if (row && row.dataset.id !== dragId) row.classList.add('over');
});

$('list').addEventListener('drop', async (e) => {
  e.preventDefault();
  const target = e.target.closest('.row');
  if (!dragId || !target || target.dataset.id === dragId) return;
  const from = rows.findIndex((r) => r.id === dragId);
  const to = rows.findIndex((r) => r.id === target.dataset.id);
  if (from === -1 || to === -1) return;
  const next = [...rows];
  next.splice(to, 0, next.splice(from, 1)[0]);
  rows = next;
  await save();
});

$('list').addEventListener('dragend', () => {
  dragId = null;
  for (const r of document.querySelectorAll('.row.dragging, .row.over')) r.classList.remove('dragging', 'over');
});

// Toolbar
for (const p of POSITIONS) {
  const b = document.createElement('button');
  b.textContent = p;
  if (p === 'ALL') b.className = 'on';
  b.onclick = () => {
    filter = p;
    for (const other of $('filters').children) other.className = other === b ? 'on' : '';
    render();
  };
  $('filters').appendChild(b);
}

$('search').oninput = (e) => { search = e.target.value; render(); };
$('sortmine').onclick = () => { sort = 'mine'; $('sortmine').className = 'on'; $('sortadp').className = ''; note(''); render(); };
$('sortadp').onclick = () => { sort = 'adp'; $('sortadp').className = 'on'; $('sortmine').className = ''; render(); };
$('update').onclick = () => updateAdp(false);

$('export').onclick = () => {
  const text = `${rows.map((r) => r.name).join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-rankings.txt';
  a.click();
  URL.revokeObjectURL(url);
  note(`Exported ${rows.length} names.`);
};

$('import').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = parsePaste(await file.text());
    rows = await enrich(buildRows(parsed.rows, parsed.mapping));
    await save();
    note(`Imported ${rows.length} players from ${file.name}.`);
  } catch (err) {
    note(`Could not read that file: ${err.message}`, 'warn');
  }
  e.target.value = '';
};

(async function boot() {
  rows = (await store.get(store.KEYS.rankings)) || [];
  adp = indexAdp(await loadAdp());
  render();

  // Check on open, which is this app's equivalent of a launch. Only when the
  // cached board is actually old, so opening the page twice in an evening does
  // not pull 300 players twice.
  const stale = !adp || Date.now() - (adp.at ?? 0) > STALE_MS;
  if (stale) updateAdp(true);
  else if (!rows.length && adp) applyAdp(adp);
})();
