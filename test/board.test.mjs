// Both draft boards, using markup copied from the live sites.
// Requires jsdom: npm i    Run: node test/board.test.mjs
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'Node', 'MutationObserver'])
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];

const { readBoard, detectAdapter, watchBoard, labelToPickNo, betaAdapter, legacyAdapter } =
  await import('../src/lib/board.js');
const { buildIndex } = await import('../src/lib/names.js');

let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

// ---------- beta board (sleeper.com/beta/draft/nfl/...) ----------
const betaCell = (first, last, pos, team, bye, pick, rookie = false) => `
<div class="flex"><div class="relative isolate w-28 h-16 rounded-xl bg-dls-picked-${pos.toLowerCase()}">
  <div class="w-19 ml-2 mt-2 flex flex-col">
    <div class="flex items-center gap-0.5">
      ${rookie ? '<svg class="badge"><title>Rookie</title><path></path></svg>' : ''}
      <span class="dls-label-small dls-label-sub-regular">${first}</span>
    </div>
    <span class="dls-label-medium dls-label-sub-bold">${last}</span>
    <div class="dls-label-small dls-label-sub-bold flex">
      <span class="dls-label-small dls-label-sub-regular">&bull;</span>
      <span class="dls-label-small dls-label-sub-regular">${team}</span>
      <span class="dls-label-small dls-label-sub-regular ml-0.5">(${bye})</span>
    </div>
  </div>
  <div class="dls-label-medium dls-label-sub-medium absolute right-2 top-2">${pick}</div>
</div></div>`;
const betaClock = (pick) => `
<div class="flex"><div class="relative isolate w-28 h-16 rounded-xl bg-dls-alert-warning-50">
  <div class="dls-label-medium dls-label-sub-medium absolute right-2 top-2">${pick}</div>
  <div class="dls-label-small dls-label-sub-bold absolute left-2 top-2 uppercase">On the clock</div>
</div></div>`;

document.body.innerHTML =
  betaCell('Bijan', 'Robinson', 'RB', 'ATL', 11, '1.2') +
  betaCell('Jahmyr', 'Gibbs', 'RB', 'DET', 6, '1.1') +
  betaCell('Jeremiyah', 'Love', 'RB', 'ARI', 14, '1.3', true) +
  betaClock('1.4');

let a = detectAdapter();
ok(a === betaAdapter, `beta board detected (${a?.id})`);
let r = readBoard();
ok(r.picks.length === 3, `beta: 3 picks (${r.picks.length})`);
ok(r.picks.map((p) => p._label).join(',') === '1.1,1.2,1.3', 'beta: sorted into pick order');
ok(r.clockLabel === '1.4', `beta: on-the-clock label read (${r.clockLabel})`);
ok(r.picks[2].metadata.first_name === 'Jeremiyah' && r.picks[2].metadata.last_name === 'Love',
   'beta: rookie badge SVG <title> stripped from the name');
ok(r.picks[0].metadata.team === 'DET' && r.picks[0].metadata.position === 'RB', 'beta: pos and team');

// ---------- legacy board (sleeper.com/draft/nfl/...) ----------
// NOTE: the legacy board abbreviates first names ("J. Gibbs").
const legacyCell = (name, pos, team, pick) => `
<div class="cell-container"><div class="cell ${pos.toLowerCase()} drafted">
  <div class="pick">${pick}</div>
  <div class="player"><div class="player-name">${name}</div><div class="position">${pos} - ${team}</div></div>
</div></div>`;
const legacyClock = (pick) => `
<div class="cell-container"><div class="cell false current-pick is-active">
  <div class="pick">${pick}</div><div class="timer-text">On the Clock</div>
</div></div>`;

document.body.innerHTML =
  legacyCell('B. Robinson', 'RB', 'ATL', '1.2') +
  legacyCell('J. Gibbs', 'RB', 'DET', '1.1') +
  legacyCell('A. St. Brown', 'WR', 'DET', '1.3') +
  legacyClock('1.4');

a = detectAdapter();
ok(a === legacyAdapter, `legacy board detected (${a?.id})`);
r = readBoard();
ok(r.picks.length === 3, `legacy: 3 picks (${r.picks.length})`);
ok(r.picks.map((p) => p._label).join(',') === '1.1,1.2,1.3', 'legacy: sorted into pick order');
ok(r.clockLabel === '1.4', `legacy: on-the-clock label read (${r.clockLabel})`);
ok(r.picks[0].metadata.position === 'RB' && r.picks[0].metadata.team === 'DET', 'legacy: "RB - DET" split');

// The abbreviated first name must still match a full-name ranking row, via the
// last-name + position + team tier in names.js.
const rankings = [
  { id: 'a', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', myRank: 1 },
  { id: 'b', name: 'Bijan Robinson', position: 'RB', team: 'ATL', myRank: 2 },
  { id: 'c', name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', myRank: 3 },
];
const index = buildIndex(rankings);
const matched = r.picks.map((p) => index.match(p));
ok(matched.filter(Boolean).length === 3,
   `legacy: abbreviated names match full-name rows (${matched.filter(Boolean).length}/3) -> ${matched}`);

// ---------- pick maths + watching ----------
ok(labelToPickNo('1.4', 12) === 4 && labelToPickNo('3.1', 12) === 25, 'label -> absolute pick number');
ok(labelToPickNo('2.3', null) === null, 'no team count -> no pick number');

let calls = 0, last = null;
const stop = watchBoard((res) => { calls++; last = res; }, { debounceMs: 0 });
ok(calls === 1 && last.picks.length === 3, 'watchBoard initial scan');
document.body.insertAdjacentHTML('beforeend', legacyCell('C. McCaffrey', 'RB', 'SF', '1.5'));
await new Promise((r) => setTimeout(r, 50));
ok(calls === 2 && last.picks.length === 4, `watchBoard fires on a new pick (${calls}, ${last.picks.length})`);
document.body.insertAdjacentHTML('beforeend', '<div class="noise">x</div>');
await new Promise((r) => setTimeout(r, 50));
ok(calls === 2, 'unrelated DOM churn does not re-emit');
stop();

document.body.innerHTML = '<div>no draft board here</div>';
ok(detectAdapter() === null, 'no adapter on a non-draft page');
ok(readBoard().picks.length === 0, 'readBoard is safe with no board');

console.log(fails ? `\n${fails} failing check(s)` : '\nAll board checks passed');
process.exit(fails ? 1 : 0);
