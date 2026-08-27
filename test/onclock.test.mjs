// Whose pick is it? Answered from the username on the board, never inferred.
// Markup and API shapes are copied from a live Sleeper mock draft.
// Requires jsdom: npm i    Run: node test/onclock.test.mjs
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const k of ['window', 'document', 'Node', 'MutationObserver'])
  globalThis[k] = k === 'window' ? dom.window : dom.window[k];

const { readColumns, readHeaders, readOwners } = await import('../src/lib/board.js');
const { ownedPickNos, picksUntilOwnedTurn, isOnClock, slotOfRoster, ownedFromBoard, usernameOnBoard } =
  await import('../src/lib/turn.js');

let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

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

// The geometry helpers below need rects; jsdom has no layout, so they are
// supplied. CELL_W/PITCH mirror a real 12-team board.
const CELL_W = 120, PITCH = 160;
const rects = new Map();
const put = (el, x, y, w = CELL_W, h = 40) => rects.set(el, { x, y, w, h });
const rectOf = (el) => {
  const r = rects.get(el);
  return r ? { x: r.x, y: r.y, width: r.w, height: r.h } : { x: 0, y: 0, width: 0, height: 0 };
};

// ------------------------------------------------ ownership read off the board
// Both boards name the acquiring team inside a traded pick's cell — legacy in
// .pick-traded, beta in a corner badge. Neither is worth selecting by class:
// the reliable test is that the text is one of the header usernames.
//
// Shape taken from a real 12-team draft with 9 traded picks.
const USERS = ['Haunter151', 'ExtremeSolution', 'TCoolDaGoat', 'Jacamart', 'TheMurdockle', 'CamDelphia',
               'Jamauro', 'Pressthecot', 'GooberX', 'DavrilOfKurth', 'ItsAllOgre', 'JoshC94'];

/** @param traded  map of "round.pick" label -> username who bought it */
const buildOwned = (traded = {}) => {
  document.body.innerHTML = '';
  rects.clear();
  for (let col = 1; col <= teams; col++) {
    const x = col * PITCH;
    const head = document.createElement('div');
    head.textContent = USERS[col - 1];
    document.body.appendChild(head);
    put(head, x + 20, 40, 80);
    for (const [round, label] of [[1, `1.${col}`], [2, `2.${teams - col + 1}`], [3, `3.${col}`]]) {
      const cell = document.createElement('div');
      const tag = document.createElement('span');
      tag.textContent = label;
      cell.appendChild(tag);
      if (traded[label]) {
        const badge = document.createElement('span');
        badge.textContent = traded[label];
        cell.appendChild(badge);
        put(badge, x + 4, 62 + round * 50, 60, 10);
      }
      document.body.appendChild(cell);
      put(cell, x, 60 + round * 50);
      put(tag, x + 90, 65 + round * 50, 24, 12);
    }
  }
};

buildOwned();
let headers = readHeaders(document, { teams, rectOf });
ok(headers.size === 12, `every column header read (${headers.size})`);
ok(headers.get(1) === 'Haunter151' && headers.get(12) === 'JoshC94', 'headers land on the right slots');
ok(usernameOnBoard(headers, 'joshc94'), 'your username is found regardless of case');
ok(!usernameOnBoard(headers, 'SomebodyElse'), 'a name not on the board is not found');

// Page furniture sits ABOVE the header row — toolbar buttons, the league name,
// a "Draft Completed" banner. Taking the topmost name per column picks those up
// instead of the usernames, which on a real board stole five columns of twelve
// and left the user unable to find themselves. The header row is the row that
// spans the most columns, not the highest one.
const furniture = [
  ['Flip board layout', 11.4 * PITCH],
  ['More options', 11.4 * PITCH],
  ['Turn off sounds', 9.4 * PITCH],
  ['Draft Completed', 1.4 * PITCH],
];
for (const [text, x] of furniture) {
  const el = document.createElement('button');
  el.textContent = text;
  document.body.appendChild(el);
  put(el, x, 8, 70, 12); // its own row, higher up the page than the header
}
headers = readHeaders(document, { teams, rectOf });
ok(headers.size === 12, `page furniture does not displace the header row (${headers.size})`);
ok(headers.get(12) === 'JoshC94', `the last column is still yours (${headers.get(12)})`);
ok(![...headers.values()].some((n) => n.includes('board layout')), 'no toolbar label is mistaken for a team');
ok(usernameOnBoard(headers, 'JoshC94'), 'so your username is still found on the board');

let owners = readOwners(document, { teams, rectOf, headers });
ok(owners.size === 36, `every labelled cell has an owner (${owners.size})`);
ok(owners.get('1.12') === 'JoshC94', 'an untouched pick belongs to its column');

mine = ownedFromBoard(owners, 'JoshC94', teams);
ok(mine.has(12) && mine.has(13), 'slot 12 owns 1.12 (#12) and the 2.01 turn (#13)');
ok(mine.size === 3, `three rounds built, three picks owned (${mine.size})`);

// Now the case columns cannot answer: picks change hands.
// 1.12 sold to Haunter151; 1.01 and 2.11 bought from others.
buildOwned({ '1.12': 'Haunter151', '1.1': 'JoshC94', '2.11': 'JoshC94' });
headers = readHeaders(document, { teams, rectOf });
owners = readOwners(document, { teams, rectOf, headers });
mine = ownedFromBoard(owners, 'JoshC94', teams);

ok(owners.get('1.12') === 'Haunter151', 'a pick you sold reads as the buyer\'s');
ok(owners.get('1.1') === 'JoshC94', 'a pick you bought reads as yours, in someone else\'s column');
ok(!mine.has(12), 'the sold pick is not yours, though it sits in your column');
ok(mine.has(1), 'the bought pick is yours, though it sits in column 1');
ok(mine.has(23), 'and 2.11 — overall #23, over in column 2 — too');
ok(!isOnClock(12, mine) && isOnClock(1, mine), 'on-the-clock follows the badge, not the column');
// #12 was sold, so the next turn is your own 2.01 (#13) rather than the pick
// still sitting in your column.
ok(picksUntilOwnedTurn(2, mine) === 11,
   `the countdown skips the pick you sold (${picksUntilOwnedTurn(2, mine)} to #13)`);

// Without a username there is nothing to compare against, and a name nobody
// on the board answers to must not silently return somebody else's picks.
ok(ownedFromBoard(owners, '', teams).size === 0, 'no username -> no picks claimed');
ok(ownedFromBoard(owners, 'Nobody', teams).size === 0, 'an unknown username claims nothing');
ok(ownedFromBoard(new Map(), 'JoshC94', teams).size === 0, 'an unread board claims nothing');

// ---------------------------------- the countdown, looking forward past a trade
// The case the board alone cannot be trusted for. Every trade observable on a
// live board was on a pick already made; whether Sleeper badges a pick that has
// not happened yet is unverified. So the countdown is based on the traded-picks
// feed, which covers all rounds, and the board only overrides what it renders.
const { applyBoardOwnership, slotOfUsername } = await import('../src/lib/turn.js');

const R = 15;
// You draft from slot 12. You sold your round-2 pick (#13) and bought slot 5's
// round-3 (#29). Rosters map 1:1 to slots here.
const rosterMap = Object.fromEntries([...Array(12)].map((_, i) => [i + 1, i + 1]));
const futureTrades = [
  { round: 2, roster_id: 12, owner_id: 3 },
  { round: 3, roster_id: 5, owner_id: 12 },
];
const base = ownedPickNos({
  slot: 12, teams, rounds: R, type: 'snake',
  traded: futureTrades, slotToRoster: rosterMap, rosterId: 12,
});

// Nothing drafted yet, so the board renders no badges at all — the worst case.
let merged = applyBoardOwnership(base, new Map(), ['JoshC94'], teams);
ok(!merged.has(13), 'a pick sold away is excluded before it is ever drafted');
ok(merged.has(29), 'a pick bought is included before it is ever drafted');
ok(merged.has(12), 'your own first-rounder is untouched');
// From pick 1, the next turn is #12, and after that #29 — never the sold #13.
ok(picksUntilOwnedTurn(1, merged) === 11, `countdown to your first pick (${picksUntilOwnedTurn(1, merged)})`);
ok(picksUntilOwnedTurn(13, merged) === 16,
   `countdown from the sold pick runs on to #29, not 0 (${picksUntilOwnedTurn(13, merged)})`);
ok(!isOnClock(13, merged), 'and you are not on the clock for a pick you traded away');

// Once the board does render a badge, it wins — that is the mock-draft case,
// where the traded-picks feed reports nothing.
const boardSays = new Map([['1.12', 'Haunter151'], ['2.1', 'JoshC94']]);
merged = applyBoardOwnership(base, boardSays, ['JoshC94'], teams);
ok(!merged.has(12), 'a rendered badge can take a pick away that the feed gave you');
ok(merged.has(13), 'and give one back that the feed took');

// With no feed at all — a mock — the board is the whole answer.
merged = applyBoardOwnership(new Set(), boardSays, ['JoshC94'], teams);
ok(merged.has(13) && !merged.has(12), 'with no feed, the board alone decides');

ok(slotOfUsername(new Map([[1, 'Haunter151'], [12, 'JoshC94']]), ['joshc94']) === 12,
   'your column is found from the header row, case-insensitively');
ok(slotOfUsername(new Map([[1, 'Haunter151']]), ['JoshC94']) === null, 'and is null when you are not on it');

console.log(fails ? `\n${fails} failing check(s)` : '\nAll on-the-clock checks passed');
process.exit(fails ? 1 : 0);
