// Headless render of the Panel via jsdom, driven by a bare name list.
// Requires jsdom:  npm i -D jsdom     Run:  node test/render.test.mjs
import { JSDOM } from 'jsdom';

// The settings view links to the ranking page when the extension APIs are
// there; without this stub it simply omits the link.
globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://test/${p}` } };
import { readFileSync } from 'node:fs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const k of ['window','document','HTMLElement','Node','Event','CustomEvent','getComputedStyle'])
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];
globalThis.queueMicrotask = queueMicrotask;

const BASE = new URL('../', import.meta.url);
const css = readFileSync(new URL('src/panel/panel.css', BASE), 'utf8');

const { Panel, FILTERS } = await import(new URL('src/panel/panel.js', BASE));
const { parsePaste, buildRows } = await import(new URL('src/lib/parse.js', BASE));
const { enrichRows } = await import(new URL('src/lib/enrich.js', BASE));
const { buildIndex } = await import(new URL('src/lib/names.js', BASE));
const { bandFor } = await import(new URL('src/lib/value.js', BASE));

// A bare name list plus a stand-in reference set: exactly the headline flow.
const names = readFileSync(new URL('fixtures/names-only.csv', BASE), 'utf8').trim().split('\n');
const POS = ['RB','WR','QB','TE'];
const TEAMS = ['ATL','DET','CIN','BUF','LV','LAR','SF','KC','PHI','MIN','NYJ','SEA'];
const reference = {
  season: '2026',
  players: names.map((n, i) => [String(i+1), n, POS[i % POS.length], TEAMS[i % TEAMS.length], i+1]),
  byes: Object.fromEntries(TEAMS.map((t, i) => [t, (i % 12) + 5])),
};
const parsed = parsePaste(names.join('\n'));
const rankings = enrichRows(buildRows(parsed.rows, parsed.mapping), reference).rows;

let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

const settings = {
  filter: 'ALL', search: '', showDrafted: false, sortKey: 'myRank', sortDir: 'asc',
  pollMs: 2000, slot: 7, panel: { x: 100, y: 80, w: 720, h: 560, collapsed: false },
};
const saved = [];
const reorders = [];
const panel = new Panel(css, settings, {
  onSettingsChange: (p) => saved.push(p),
  onSaveRankings: () => {}, onClearRankings: () => {}, onToggleManual: () => {},
  onReorder: (from, to) => reorders.push([from, to]),
});

const $ = (sel) => panel.shadow.querySelector(sel);
const $$ = (sel) => [...panel.shadow.querySelectorAll(sel)];

ok(!!$('.wrap'), 'panel mounts into shadow root');
ok($$('.empty').length === 1, 'empty state shown with no rankings');

// index the picks for a simulated draft
const index = buildIndex(rankings);
const mkPick = (r) => ({ metadata: {
  first_name: r.name.split(' ')[0], last_name: r.name.split(' ').slice(1).join(' '),
  position: r.position, team: r.team } });

panel.update({ rankings, teams: 12, type: 'snake', status: 'live' });
ok($$('tbody tr').length === 75, `all 75 rows render (${$$('tbody tr').length})`);
// Rank, Pos Rank, Player, Team, Bye — the same five the ranking page shows, in
// the same order. No separate Pos column: "RB1" already says the position.
const headers = $$('thead th').map((th) => th.textContent.replace(/[▲▼\s]+$/, ''));
ok(headers.length === 5, `five sortable column headers (${headers.length}: ${headers.join(', ')})`);
ok(!headers.includes('Pos'), 'no redundant Pos column');
ok(
  $$('tbody tr td .pos').every((s) => s.getAttribute('data-pos')),
  'positional rank is colour-coded by position'
);
ok($('thead th').getAttribute('aria-sort') === 'ascending', 'default sort is My Rank asc');

// Drag to reorder, in the draft panel itself. Only while sorted by your own
// rank: under any other sort the rows on screen are not the list being written.
{
  const rows = $$('tbody tr');
  ok(rows[0].draggable, 'rows are draggable while sorted by My Rank');

  const dt = { effectAllowed: null, setData() {}, getData: () => '' };
  const fire = (node, type) => {
    const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
    e.dataTransfer = dt;
    node.dispatchEvent(e);
  };
  fire(rows[4], 'dragstart');
  fire(rows[0], 'dragover');
  ok($$('tbody tr.over').length === 1, 'the drop target is marked while dragging over it');
  fire(rows[0], 'drop');

  ok(reorders.length === 1, 'a drop reports one reorder');
  ok(
    reorders[0][0] === rows[4].dataset.id && reorders[0][1] === rows[0].dataset.id,
    'reporting the dragged player and where he was dropped'
  );

  // The click that follows a drag must not also strike the player off.
  let struck = 0;
  panel.cb.onToggleManual = () => { struck += 1; };
  rows[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  ok(struck === 0, 'the click ending a drag does not strike a player off');
}

// simulate 20 picks
const drafted = new Set(rankings.slice(0, 20).map((r) => r.id));
const matchedAll = rankings.slice(0, 20).every((r) => index.match(mkPick(r)) === r.id);
ok(matchedAll, 'all 20 simulated picks matched the index');
panel.update({ draftedIds: drafted, pickNo: 21, unmatched: [] });
ok($$('tbody tr').length === 55, `drafted players hidden (${$$('tbody tr').length} left)`);
ok(/55 shown · 20 drafted/.test($('.count').textContent), `count line: "${$('.count').textContent}"`);
// pick 21 of a 12-team snake is 2.09.
ok(/2\.09/.test($('.pickinfo').textContent),
   `pick info: "${$('.pickinfo').textContent}"`);

// value colouring at pick 21: ranks 1-20 are gone, so the best available is
// rank 21 at pick 21 -> delta 0 -> fair. Assert every badge against bandFor.
const badges = $$('tbody tr').map((tr) => [
  Number(tr.querySelector('.rankbadge').textContent),
  tr.querySelector('.rankbadge').dataset.band,
]);
ok(badges[0][1] === 'fair', `rank 21 at pick 21 is fair (${badges[0][1]})`);
ok(badges.every(([rank, band]) => bandFor(rank, 21).id === band), 'every badge matches bandFor');
ok(badges.some(([, b]) => b === 'big-reach'), 'deep players band as big reach');

// a genuine steal: rank 11 still on the board at pick 21
panel.update({ draftedIds: new Set(rankings.filter((r) => r.myRank !== 11 && r.myRank <= 21).map((r) => r.id)) });
ok($$('tbody tr')[0].querySelector('.rankbadge').dataset.band === 'value', 'rank 11 at pick 21 shows as value');
panel.update({ draftedIds: drafted });

// filters
for (const [id, expect] of [['QB', (r) => r.position === 'QB'], ['FLEX', (r) => ['RB','WR','TE'].includes(r.position)]]) {
  panel.patch({ filter: id });
  const want = rankings.filter((r) => !drafted.has(r.id) && expect(r)).length;
  ok($$('tbody tr').length === want, `${id} filter shows ${want} rows (${$$('tbody tr').length})`);
}
ok(FILTERS.map((f) => f.id).join(',') === 'ALL,QB,RB,WR,TE,FLEX', 'filter chip set has no DEF or K');

// sorting: click Underdog ADP header three times
panel.patch({ filter: 'ALL' });
const udCol = 4; // Bye
const rowNames = () => $$('tbody tr').map((tr) => tr.children[3].textContent);
panel.cycleSort('bye');
const asc = $$('tbody tr').map((tr) => parseFloat(tr.children[udCol].textContent));
ok(asc.every((v, i) => i === 0 || asc[i-1] <= v), 'ascending sort on Bye');
panel.cycleSort('bye');
const desc = $$('tbody tr').map((tr) => parseFloat(tr.children[udCol].textContent));
ok(desc.every((v, i) => i === 0 || desc[i-1] >= v), 'descending sort on Bye');
panel.cycleSort('bye');
ok(panel.settings.sortKey === 'myRank' && panel.settings.sortDir === 'asc', 'third click resets to default');

// text column sort
panel.cycleSort('name');
ok(rowNames()[0].localeCompare(rowNames()[1], undefined, {numeric:true}) <= 0, 'text column sorts alphabetically');
panel.patch({ sortKey: 'myRank', sortDir: 'asc' });

// search
panel.patch({ search: 'chase' });
ok($$('tbody tr').length <= 2 && $$('tbody tr').length >= 0, 'search narrows the list');
panel.patch({ search: '' });

// show drafted toggle
panel.patch({ showDrafted: true });
ok($$('tbody tr').length === 75, 'show-drafted reveals all 75');
ok($$('tbody tr.drafted').length === 20, '20 rows struck through');
panel.patch({ showDrafted: false });

// a player struck manually and then actually drafted counts once, not twice
const dup = rankings[30].id;
panel.update({ draftedIds: new Set([...drafted, dup]), manualIds: new Set([dup]) });
ok(/21 drafted/.test($('.count').textContent), `overlap counted once: "${$('.count').textContent}"`);
panel.update({ draftedIds: drafted, manualIds: new Set() });

// unmatched chip
panel.update({ unmatched: ['Someone Unknown (WR · NYJ)'] });
ok(!$('.chip-warn').hidden && /1 unmatched pick/.test($('.chip-warn').textContent), 'unmatched chip appears');
panel.state.showUnmatched = true; panel.render();
ok(/Someone Unknown/.test($('.unmatched').textContent), 'unmatched list expands');
panel.state.showUnmatched = false; panel.update({ unmatched: [] });
ok($('.chip-warn').hidden, 'chip hides when nothing is unmatched');

// the status dot now reports clock proximity, not connection health
const dotState = () => $('.dot').dataset.state;
panel.update({ status: 'live', teams: 12, type: 'snake', pickNo: 21 });
panel.patch({ slot: 9 });   // pick 21 is 2.09; slot 9 picks again at 2.04? -> compute
const away = panel.state.picksAway;
ok(typeof away === 'number', `picksAway computed (${away})`);
panel.patch({ slot: null });
ok(dotState() === 'unknown', 'dot is grey with no slot set');
// drive each band directly
for (const [n, want] of [[0, 'on-clock'], [1, 'soon'], [4, 'soon'], [5, 'far'], [40, 'far']]) {
  panel.settings.slot = 1; panel.state.picksAway = n; panel.renderDot();
  ok(dotState() === want, `dot: ${n} picks away -> ${want} (${dotState()})`);
}
// Regression: the dot used to render one update behind, because picksAway was
// computed in renderHeaderInfo() *after* renderDot() had already read it.
panel.settings.slot = 12; panel.update({ status: 'live', teams: 12, type: 'snake', pickNo: 12 });
ok($('.dot').dataset.state === 'on-clock',
   `dot is correct on the first render after an update (${$('.dot').dataset.state}, away=${panel.state.picksAway})`);
panel.update({ pickNo: 1 });
ok($('.dot').dataset.state === 'far', `dot updates immediately, not one render late (${$('.dot').dataset.state})`);

// the toolbar slot picker
ok(!!$('.slotsel'), 'slot picker is in the toolbar, not only behind the gear');
panel.patch({ slot: null });
ok($('.slotwrap').classList.contains('needed'), 'slot picker is highlighted while unset');
ok($$('.slotsel option').length === 13, `slot picker offers 12 slots plus a placeholder (${$$('.slotsel option').length})`);
panel.patch({ slot: 7 });
ok(!$('.slotwrap').classList.contains('needed'), 'highlight clears once a slot is chosen');
ok($('.slotsel').value === '7', 'slot picker reflects the saved slot');

panel.settings.slot = 1; panel.state.picksAway = 0; panel.state.status = 'error'; panel.renderDot();
ok(dotState() === 'unknown', 'dot goes grey when the feed is down rather than lying');
panel.state.status = 'live';

// settings view
panel.setView('settings');
ok(!!$('textarea'), 'settings view renders the paste box');
ok(
  $$('.settings a').some((a) => (a.getAttribute('href') || '').includes('rankings.html')),
  'settings view links to the ranking page'
);
ok($$('.settings select').length >= 1, 'slot selector present');
panel.setView('ranks');
ok(!!$('table'), 'returns to the table');

// collapse + geometry persistence
panel.toggleCollapse();
ok($('.wrap').classList.contains('collapsed'), 'collapse works');
ok(saved.some((p) => p.panel && p.panel.collapsed === true), 'collapse persisted to settings');
panel.toggleCollapse();



// The on-the-clock dot is green, and has its own token. It used to borrow
// --steal, which was silently wrong the moment "must draft" became blue: being
// on the clock is not a value judgement and must not share a colour with one.
{
  const styles = panel.shadow.querySelector('style').textContent;
  ok(/--up:\s*#17c964/.test(styles), 'there is a dedicated --up token, and it is green');
  ok(
    /\.dot\[data-state="on-clock"\][\s\S]{0,120}var\(--up\)/.test(styles),
    'the on-clock dot is painted from it'
  );
  ok(!/\.dot[^}]*var\(--steal\)/.test(styles), 'and the dot no longer borrows --steal');
}

console.log(fails ? `\n${fails} failing check(s)` : '\nAll render checks passed');
process.exit(fails ? 1 : 0);
