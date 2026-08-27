// Detecting whose turn it is WITHOUT the user picking a draft slot.
// Markup and API shapes are copied from a live Sleeper mock draft.
// Requires jsdom: npm i    Run: node test/onclock.test.mjs
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'Node', 'MutationObserver'])
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];

const { readColumns, readOwnSlot } = await import('../src/lib/board.js');
const { readSleeperUserId, fetchUserNames } = await import('../src/lib/whoami.js');
const { ownedPickNos, picksUntilOwnedTurn, isOnClock, slotOfRoster } = await import('../src/lib/turn.js');

let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

// ---------------------------------------------------------------- identity
// Sleeper stores the signed-in id JSON-encoded, so the quotes come with it.
// Using the raw value 404s the user endpoint into a null, which is exactly the
// bug this decoding exists to avoid.
const fakeStore = (obj) => ({
  ...obj,
  getItem: (k) => (k in obj ? obj[k] : null),
});
ok(readSleeperUserId({ localStorage: fakeStore({ user_id: '"84006772809285632"' }) }) === '84006772809285632',
   'JSON-quoted user_id is unquoted');
ok(readSleeperUserId({ localStorage: fakeStore({ user_id: '84006772809285632' }) }) === '84006772809285632',
   'a bare user_id is taken as-is');
ok(readSleeperUserId({ localStorage: fakeStore({ session: '{"user":{"user_id":"84006772809285632"}}' }) })
     === '84006772809285632',
   'a nested user_id is found when the plain key is gone');
ok(readSleeperUserId({ localStorage: fakeStore({ theme: '"dark"', n: '12' }) }) === null,
   'no user id -> null, not a false positive');
ok(readSleeperUserId({}) === null, 'storage unavailable is survivable');

const names = await fetchUserNames('84006772809285632', async () => ({
  ok: true, json: async () => ({ username: 'joshc94', display_name: 'JoshC94' }),
}));
ok(names.join(',') === 'JoshC94,joshc94', `display name and username (${names})`);
ok((await fetchUserNames('84006772809285632', async () => ({ ok: true, json: async () => null }))).length === 0,
   'a null user body yields no names');

// ------------------------------------------------------------ pick ownership
const teams = 12, rounds = 15;
const slotToRoster = Object.fromEntries([...Array(12)].map((_, i) => [i + 1, i + 1]));

let mine = ownedPickNos({ slot: 2, teams, rounds });
ok(isOnClock(2, mine), 'slot 2 owns pick 2 — on the clock at 1.02');
ok(!isOnClock(3, mine), 'slot 2 is not on the clock at 1.03');
ok(picksUntilOwnedTurn(1, mine) === 1 && picksUntilOwnedTurn(3, mine) === 20,
   'countdown to the next owned pick, across the snake turn');
ok(mine.has(23) && mine.has(26), 'snake: slot 2 owns 2.11 (#23) and 3.02 (#26)');

// Trades: a pick is drafted by whoever owns it, not by whoever's column it sits
// in — so the answer cannot come from board geometry or slot maths.
const traded = [
  { round: 1, roster_id: 2, owner_id: 7 }, // I sold my first-rounder
  { round: 2, roster_id: 5, owner_id: 2 }, // and bought slot 5's second
];
mine = ownedPickNos({ slot: 2, teams, rounds, traded, slotToRoster, rosterId: 2 });
ok(!mine.has(2), 'a pick traded away is no longer mine');
ok(mine.has(20), "a pick bought from another column (slot 5's 2nd) is mine");
ok(mine.has(26), 'untraded picks are untouched');
ok(!isOnClock(2, mine) && isOnClock(20, mine), 'on-the-clock follows the trade, not the column');
ok(slotOfRoster(slotToRoster, 5) === 5 && slotOfRoster(slotToRoster, 99) === null, 'roster -> slot lookup');
ok(ownedPickNos({ slot: 2, teams, rounds, traded, slotToRoster: null, rosterId: null }).has(2),
   'without roster identity the untraded set stands rather than guessing');

// ------------------------------------------------------- slot from the board
// Both boards label every cell and lay columns out left to right, so the labels
// themselves calibrate the grid. jsdom has no layout, so rects are supplied.
const CELL_W = 120, PITCH = 160;
const rects = new Map();
const put = (el, x, y, w = CELL_W, h = 40) => rects.set(el, { x, y, w, h });
const rectOf = (el) => {
  const r = rects.get(el);
  return r ? { x: r.x, y: r.y, width: r.w, height: r.h } : { x: 0, y: 0, width: 0, height: 0 };
};

const build = (myCol) => {
  document.body.innerHTML = '';
  for (let col = 1; col <= teams; col++) {
    const x = col * PITCH;
    // header: your account name in your column, generic names elsewhere
    const head = document.createElement('div');
    head.textContent = col === myCol ? 'JoshC94' : `Team ${col}`;
    document.body.appendChild(head);
    put(head, x + 30, 10, 60);
    // two rounds of labelled cells; round 2 runs backwards (snake)
    for (const [round, label] of [[1, `1.${col}`], [2, `2.${teams - col + 1}`]]) {
      const cell = document.createElement('div');
      const tag = document.createElement('span');
      tag.textContent = label;
      cell.appendChild(tag);
      document.body.appendChild(cell);
      put(cell, x, 60 + round * 50);
      put(tag, x + 90, 65 + round * 50, 24, 12);
    }
  }
};

build(2);
const columns = readColumns(document, { teams, rectOf });
ok(columns.length === 12, `all 12 columns mapped (${columns.length})`);
ok(columns.every((c, i) => c.slot === i + 1), 'columns come back in slot order, left to right');
ok(readOwnSlot(document, ['JoshC94', 'joshc94'], { teams, rectOf }) === 2,
   'your slot read off the header — no slot picker involved');

build(11);
ok(readOwnSlot(document, ['JoshC94'], { teams, rectOf }) === 11, 'works at the far end of the board');
ok(readOwnSlot(document, ['joshc94'], { teams, rectOf }) === 11, 'name match is case-insensitive');
ok(readOwnSlot(document, [], { teams, rectOf }) === null, 'no names -> no guess');
ok(readOwnSlot(document, ['SomeoneElse'], { teams, rectOf }) === null, 'a name not on the board -> no guess');

// Your name also appears in side panels; the header is the topmost hit, and
// anything outside the grid's columns is not a hit at all.
const aside = document.createElement('div');
aside.textContent = 'JoshC94';
document.body.appendChild(aside);
put(aside, 40 * PITCH, 900, 80);
ok(readOwnSlot(document, ['JoshC94'], { teams, rectOf }) === 11,
   'a stray mention outside the grid does not move the answer');

ok(readColumns(document, { teams: null, rectOf }).length === 0, 'no team count -> no column map');

console.log(fails ? `\n${fails} failing check(s)` : '\nAll on-the-clock checks passed');
process.exit(fails ? 1 : 0);
