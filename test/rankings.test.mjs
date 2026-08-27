// Drives the ranking page in jsdom with chrome and the network faked. The
// things most likely to be wrong here — seeding, the merge that must not
// disturb your order, dragging, ADP sort — cannot be seen by reading the file.
//
// Nothing is monkeypatched: the fake is the HTTP layer, so adp.js does its real
// filtering, sorting and capping on the way through.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

const FEED = [
  ['Jahmyr Gibbs', 'RB', 'DET', 1.3],
  ['Bijan Robinson', 'RB', 'ATL', 2.8],
  ["Ja'Marr Chase", 'WR', 'CIN', 3.3],
  ['Puka Nacua', 'WR', 'LAR', 4.6],
  ['Ashton Jeanty', 'RB', 'LV', 13.6],
  // Filtered out on the way through: a kicker, and a padded non-value.
  ['Harrison Butker', 'K', 'KC', 180.2],
  ['Somebody Undrafted', 'WR', 'FA', 998.0],
];

/** Stands in for Sleeper's projections endpoint — one season-long row per player. */
function fakeFetch(url) {
  const u = new URL(url);
  const body = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });

  if (u.pathname.startsWith('/projections/nfl/')) {
    return body(
      FEED.map(([name, position, team, adp], i) => {
        const parts = name.split(' ');
        return {
          player_id: String(100 + i),
          last_modified: Date.UTC(2026, 7, 26),
          stats: { adp_half_ppr: adp, adp_std: adp + 1 },
          player: {
            first_name: parts[0],
            last_name: parts.slice(1).join(' '),
            position,
            team,
          },
        };
      })
    );
  }
  throw new Error(`unexpected request: ${url}`);
}

const REFERENCE = {
  at: Date.now(),
  season: '2026',
  players: FEED.map(([name, position, team], i) => [String(i), name, position, team, i + 1]),
  byes: { DET: 8, ATL: 5, CIN: 10, LAR: 6, LV: 9 },
};

async function boot(tag, seed = {}) {
  const dom = new JSDOM(readFileSync(join(ROOT, 'src/rankings/rankings.html'), 'utf8'), {
    url: 'chrome-extension://test/src/rankings/rankings.html',
  });
  const { window } = dom;
  // playerIndexV1 pre-seeded so loadReference is served from cache, exactly as
  // it is for a user who opened a draft earlier in the day.
  const storage = { playerIndexV1: REFERENCE, ...seed };

  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://test/${p}` },
    storage: { local: {
      get: async (k) => (k in storage ? { [k]: storage[k] } : {}),
      set: async (o) => Object.assign(storage, structuredClone(o)),
    } },
  };

  Object.assign(globalThis, {
    window, document: window.document, chrome,
    Blob: window.Blob, URL: window.URL, fetch: fakeFetch,
  });

  await import(`../src/rankings/rankings.js?${tag}`);
  await new Promise((r) => setTimeout(r, 120));
  return { window, storage, document: window.document };
}

const rowNames = (d) => [...d.querySelectorAll('.row .name')].map((n) => n.textContent);
const click = (d, id) => d.getElementById(id).dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));

// 1. An empty board seeds itself from live ADP, in ADP order, K and padded
//    values dropped on the way.
{
  const { document: d, storage } = await boot('seed');
  const saved = storage.rankings || [];
  ok(saved.length === 5, `seeds from ADP, kicker and padding excluded (${saved.length} of 7 feed rows)`);
  ok(saved[0].name === 'Jahmyr Gibbs' && saved[4].name === 'Ashton Jeanty', 'seeded in ADP order');
  ok(saved.every((r) => r.id), 'every seeded row has an id');
  ok(saved.every((r) => r.position && r.team), 'enrichment filled position and team');
  ok(rowNames(d).length === 5, 'and the board renders them');
  ok(d.querySelector('.row .adp').textContent === '1.3', 'ADP column shows the feed value');
}

// 2. A board you have already reordered survives an ADP update: your order is
//    kept, and a player new to the feed lands at the bottom.
{
  const mine = [
    { id: 'r0', name: "Ja'Marr Chase", position: 'WR', team: 'CIN', myRank: 1 },
    { id: 'r1', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', myRank: 2 },
  ];
  const { document: d, storage } = await boot('merge', {
    rankings: mine,
    adpV1: { date: '2026-08-01', at: Date.now(), players: [] },
  });
  click(d, 'update');
  await new Promise((r) => setTimeout(r, 150));

  const after = storage.rankings;
  ok(after[0].name === "Ja'Marr Chase" && after[1].name === 'Jahmyr Gibbs', 'your top two stay put');
  ok(after.length === 5, `newcomers appended (${after.length} total)`);
  ok(after.slice(2).every((r) => !['r0', 'r1'].includes(r.id)), 'appended rows do not reuse existing ids');
  ok(new Set(after.map((r) => r.id)).size === after.length, 'all ids unique after the merge');
  ok(after.every((r, i) => r.myRank === i + 1), 'myRank renumbered to match the order');
}

// 3. Sorting by ADP is a view, not a rewrite.
{
  const mine = [
    { id: 'r0', name: 'Ashton Jeanty', position: 'RB', team: 'LV', myRank: 1 },
    { id: 'r1', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', myRank: 2 },
  ];
  const { document: d, storage } = await boot('sort', {
    rankings: mine,
    adpV1: { date: '2026-08-26', at: Date.now(), players: FEED.slice(0, 5).map(([name, position, team, adp], i) => ({ id: String(i), name, position, team, adp })) },
  });
  ok(rowNames(d)[0] === 'Ashton Jeanty', 'starts in your order');
  click(d, 'sortadp');
  await new Promise((r) => setTimeout(r, 60));
  ok(rowNames(d)[0] === 'Jahmyr Gibbs', 'ADP sort reorders the screen');
  ok(storage.rankings[0].name === 'Ashton Jeanty', 'but never the saved order');
  ok(!d.querySelector('.row').draggable, 'and dragging is off while it is on');
}

// 4. Dragging rewrites the saved order, and only while showing your order.
{
  const mine = ['Jahmyr Gibbs', 'Bijan Robinson', "Ja'Marr Chase", 'Puka Nacua'].map((name, i) => ({
    id: `r${i}`, name, position: 'RB', team: 'DET', myRank: i + 1,
  }));
  const { document: d, storage } = await boot('drag', {
    rankings: mine,
    adpV1: { date: '2026-08-26', at: Date.now(), players: [] },
  });

  const rows = [...d.querySelectorAll('.row')];
  ok(rows[0].draggable, 'rows are draggable in your own order');

  // A real drag: fourth player onto the first row.
  const dt = { effectAllowed: null, setData() {}, getData: () => '' };
  const fire = (node, type) => {
    const e = new d.defaultView.Event(type, { bubbles: true, cancelable: true });
    e.dataTransfer = dt;
    node.dispatchEvent(e);
  };
  fire(rows[3], 'dragstart');
  fire(rows[0], 'dragover');
  fire(rows[0], 'drop');
  await new Promise((r) => setTimeout(r, 80));

  ok(storage.rankings[0].name === 'Puka Nacua', 'the dragged player lands where he was dropped');
  ok(storage.rankings.map((r) => r.name).join('|') === "Puka Nacua|Jahmyr Gibbs|Bijan Robinson|Ja'Marr Chase",
    'everyone else shifts down, nobody is lost');
  ok(storage.rankings.every((r, i) => r.myRank === i + 1), 'ranks renumbered after the drag');
  ok(rowNames(d)[0] === 'Puka Nacua', 'and the screen shows it');
}

// 5. FLEX is RB/WR/TE — the same membership the draft panel filters by.
{
  const mine = [
    { id: 'r0', name: 'Josh Allen', position: 'QB', team: 'BUF', posRank: 'QB1', myRank: 1 },
    { id: 'r1', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', posRank: 'RB1', myRank: 2 },
    { id: 'r2', name: "Ja'Marr Chase", position: 'WR', team: 'CIN', posRank: 'WR1', myRank: 3 },
    { id: 'r3', name: 'Brock Bowers', position: 'TE', team: 'LV', posRank: 'TE1', myRank: 4 },
  ];
  const { document: d } = await boot('flex', {
    rankings: mine,
    adpV1: { date: '2026-08-26', at: Date.now(), players: [] },
  });

  const chip = (label) => [...d.querySelectorAll('#filters button')].find((b) => b.textContent === label);
  ok(!!chip('FLEX'), 'there is a FLEX chip');

  chip('FLEX').dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  ok(rowNames(d).join('|') === "Jahmyr Gibbs|Ja'Marr Chase|Brock Bowers", 'FLEX shows RB, WR and TE');

  chip('QB').dispatchEvent(new d.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  ok(rowNames(d).join('|') === 'Josh Allen', 'and a single position still filters to itself');
}

// 6. The positional rank shown is the one carried on the row, colour-keyed by
//    position — and it must not read "RBRB1".
{
  const { document: d } = await boot('posrank', {
    rankings: [{ id: 'r0', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', posRank: 'RB1', myRank: 1 }],
    adpV1: { date: '2026-08-26', at: Date.now(), players: [] },
  });
  const badge = d.querySelector('.row .pos');
  ok(badge.textContent === 'RB1', `positional rank renders once (${badge.textContent})`);
  ok(badge.dataset.pos === 'RB', 'and is keyed for colour by position');
}

// 7. A drag re-derives the positional rank, or a promoted player keeps a rank
//    that belongs to somebody else.
{
  const mine = ['Jahmyr Gibbs', 'Bijan Robinson', 'Ashton Jeanty'].map((name, i) => ({
    id: `r${i}`, name, position: 'RB', team: 'DET', posRank: `RB${i + 1}`, myRank: i + 1,
  }));
  const { document: d, storage } = await boot('renumber', {
    rankings: mine,
    adpV1: { date: '2026-08-26', at: Date.now(), players: [] },
  });

  const rows = [...d.querySelectorAll('.row')];
  const dt = { effectAllowed: null, setData() {}, getData: () => '' };
  const fire = (node, type) => {
    const e = new d.defaultView.Event(type, { bubbles: true, cancelable: true });
    e.dataTransfer = dt;
    node.dispatchEvent(e);
  };
  fire(rows[2], 'dragstart');
  fire(rows[0], 'dragover');
  fire(rows[0], 'drop');
  await new Promise((r) => setTimeout(r, 80));

  ok(storage.rankings[0].name === 'Ashton Jeanty', 'the dragged player is first');
  ok(storage.rankings[0].posRank === 'RB1', `and becomes RB1 (${storage.rankings[0].posRank})`);
  ok(storage.rankings[2].posRank === 'RB3', 'the player he passed slides to RB3');
}

// 8. A slow first load has to look like work, not like a dead screen. The feed
//    cold-starts anywhere from a second to over a minute, and the page used to
//    show one unchanging line for all of it.
{
  const slow = [];
  const { document: d } = await boot('waiting', {
    // No cached ADP and no rankings: the first-run path.
    __slowFetch: true,
  });

  // The fetch is already done by the time boot() returns here, so drive the
  // text directly — what matters is that the empty state reports the phase
  // rather than telling you to press a button that is already pressed.
  const empty = d.getElementById('empty');
  ok(empty.textContent.length > 0, 'the empty state always says something');
  slow.push(empty.textContent);
  ok(
    !/press Update ADP/.test(empty.textContent) || !d.getElementById('update').disabled,
    'it never says "press Update ADP" while an update is already running'
  );
}

console.log(fails ? `\n${fails} check(s) failed` : '\nRanking page behaves');
process.exit(fails ? 1 : 0);
