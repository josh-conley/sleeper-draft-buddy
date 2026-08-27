// The ADP board, built from Sleeper's own projections endpoint.
// Run: node test/adp.test.mjs
const { boardFrom, seasonFor, BOARD_DEPTH } = await import('../src/lib/adp.js');

let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

const row = (id, first, last, position, team, adp, extra = {}) => ({
  player_id: id,
  last_modified: Date.UTC(2026, 7, 26),
  stats: { adp_half_ppr: adp, adp_std: adp + 2, adp_dynasty: 999 },
  player: { first_name: first, last_name: last, position, team },
  ...extra,
});

// Shapes copied from a live response: the row carries Sleeper's own player id
// at the top level, which is the id every other part of this extension uses.
const rows = [
  row('9509', 'Bijan', 'Robinson', 'RB', 'ATL', 2.4),
  row('9221', 'Jahmyr', 'Gibbs', 'RB', 'DET', 1.9),
  row('7564', "Ja'Marr", 'Chase', 'WR', 'CIN', 3.7),
];
let board = boardFrom(rows);
ok(board.players.length === 3, `three usable rows (${board.players.length})`);
ok(board.players[0].name === 'Jahmyr Gibbs' && board.players[0].adp === 1.9, 'best ADP first');
ok(board.players[0].id === '9221', 'keyed by Sleeper player id, not a feed id');
ok(board.players[2].name === "Ja'Marr Chase", 'first and last name joined');
ok(board.players[0].team === 'DET' && board.players[0].position === 'RB', 'position and team carried');
ok(board.date === '2026-08-26', `dated from the freshest row (${board.date})`);

// Half-PPR is the number Sleeper's own board shows, so it is the one taken.
ok(boardFrom([row('1', 'A', 'B', 'RB', 'X', 5, { stats: { adp_half_ppr: 5, adp_std: 99 } })])
     .players[0].adp === 5, 'adp_half_ppr is the field used, not adp_std');

// Sleeper pads players it has no ADP for rather than leaving the field out.
ok(boardFrom([row('1', 'A', 'B', 'RB', 'X', 999)]).players.length === 0, 'the 999 sentinel is not an ADP');
ok(boardFrom([row('1', 'A', 'B', 'RB', 'X', 0)]).players.length === 0, 'zero is not an ADP');
ok(boardFrom([{ player_id: '1', stats: {}, player: { first_name: 'A', last_name: 'B', position: 'RB' } }])
     .players.length === 0, 'a missing ADP is skipped, not defaulted');

// Kickers and defenses are out of scope everywhere else in this extension.
ok(boardFrom([row('1', 'A', 'B', 'K', 'X', 5), row('2', 'C', 'D', 'DEF', 'X', 6),
              row('3', 'E', 'F', 'FB', 'X', 7), row('4', 'G', 'H', 'TE', 'X', 8)])
     .players.map((p) => p.position).join(',') === 'TE',
   'only QB/RB/WR/TE reach the board');

// Malformed rows must not take the whole board down with them.
ok(boardFrom([null, {}, { player: null }, row('9', 'A', 'B', 'RB', 'X', 4)]).players.length === 1,
   'junk rows are skipped rather than thrown on');
ok(boardFrom([row('', 'A', 'B', 'RB', 'X', 4)]).players.length === 0, 'a row with no id is unusable');
ok(boardFrom([row('7', '', '', 'RB', 'X', 4)]).players.length === 0, 'a row with no name is unusable');
ok(boardFrom([row('7', 'A', 'B', 'RB', null, 4)]).players[0].team === null,
   'a free agent keeps a null team rather than an empty string');
ok(boardFrom([]).players.length === 0 && boardFrom([]).date === null, 'an empty feed yields an empty board');

// The board is capped at what a draft can actually show.
board = boardFrom([...Array(BOARD_DEPTH + 50)].map((_, i) => row(String(i), 'P', `L${i}`, 'RB', 'X', i + 1)));
ok(board.players.length === BOARD_DEPTH, `capped at board depth (${board.players.length})`);
ok(board.players[0].adp === 1, 'the cap keeps the best, not an arbitrary page');

// The NFL year turns over in March: January still belongs to last autumn's
// season, and asking for the wrong one returns an empty board, not an error.
// Constructed local, because that is how the clock reaches seasonFor.
ok(seasonFor(new Date(2026, 7, 27)) === 2026, 'August is the current season');
ok(seasonFor(new Date(2027, 0, 15)) === 2026, 'January still belongs to the previous season');
ok(seasonFor(new Date(2027, 1, 28)) === 2026, 'February likewise');
ok(seasonFor(new Date(2027, 2, 1)) === 2027, 'March starts the new one');

console.log(fails ? `\n${fails} failing check(s)` : '\nAll ADP checks passed');
process.exit(fails ? 1 : 0);
