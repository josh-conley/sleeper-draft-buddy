// Ambiguous abbreviated names, as produced by the classic Sleeper draft board.
// Run: node test/ambiguity.test.mjs
import { buildIndex } from '../src/lib/names.js';
import { enrichRows } from '../src/lib/enrich.js';
import { parsePaste, buildRows } from '../src/lib/parse.js';

let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

// Real collisions from a live 443-player list.
const rows = [
  { id: 'bijan', name: 'Bijan Robinson', position: 'RB', team: 'ATL', myRank: 2 },
  { id: 'josh',  name: 'Josh Allen',     position: 'QB', team: 'BUF', myRank: 50 },
  { id: 'brian', name: 'Brian Robinson', position: 'RB', team: 'ATL', myRank: 168 },
  { id: 'kyle',  name: 'Kyle Allen',     position: 'QB', team: 'BUF', myRank: 338 },
  { id: 'gibbs', name: 'Jahmyr Gibbs',   position: 'RB', team: 'DET', myRank: 1 },
];
const index = buildIndex(rows);
const pick = (name, position, team) => {
  const t = name.split(' ');
  return { metadata: { first_name: t[0], last_name: t.slice(1).join(' '), position, team } };
};
/** Match a sequence the way main.js does: in order, carrying what is claimed. */
const run = (seq) => {
  const claimed = new Set();
  return seq.map((s) => {
    const id = index.match(pick(...s), { claimed });
    if (id) claimed.add(id);
    return id;
  });
};

// The first initial resolves Josh vs Kyle outright.
ok(run([['J. Allen', 'QB', 'BUF']])[0] === 'josh', 'first initial picks Josh over Kyle Allen');
ok(run([['K. Allen', 'QB', 'BUF']])[0] === 'kyle', 'first initial picks Kyle over Josh Allen');

// Bijan and Brian share an initial, so order + rank decide.
ok(run([['B. Robinson', 'RB', 'ATL']])[0] === 'bijan', 'first "B. Robinson" drafted is Bijan (better ranked)');
ok(run([['B. Robinson', 'RB', 'ATL'], ['B. Robinson', 'RB', 'ATL']]).join(',') === 'bijan,brian',
   'second "B. Robinson" is Brian, because Bijan is already claimed');

// This is the case a "rank nearest the pick number" rule would get wrong.
ok(run([['B. Robinson', 'RB', 'ATL']])[0] === 'bijan', 'a fallen Bijan is still Bijan, not Brian');

// Unabbreviated names must be unaffected.
ok(run([['Bijan Robinson', 'RB', 'ATL']])[0] === 'bijan', 'full name matches directly');
ok(run([['Brian Robinson', 'RB', 'ATL']])[0] === 'brian', 'full name of the lower-ranked namesake still works');
ok(run([['Jahmyr Gibbs', 'RB', 'DET']])[0] === 'gibbs', 'unambiguous name unaffected');
ok(index.match(pick('Nobody Atall', 'WR', 'NYJ')) === null, 'a genuine unknown is still unmatched');

// A whole classic-board draft, in order.
const seq = [
  ['J. Gibbs', 'RB', 'DET'], ['B. Robinson', 'RB', 'ATL'], ['J. Allen', 'QB', 'BUF'],
  ['B. Robinson', 'RB', 'ATL'], ['K. Allen', 'QB', 'BUF'],
];
ok(run(seq).join(',') === 'gibbs,bijan,josh,brian,kyle', `full sequence resolves (${run(seq).join(',')})`);
ok(run(seq).filter(Boolean).length === 5, 'no unmatched picks in the sequence');

// ---- defenses must not survive a names-only paste ----
const reference = {
  season: '2026',
  players: [['1', 'Bijan Robinson', 'RB', 'ATL', 1], ['2', 'Justin Tucker', 'K', 'BAL', 900]],
  byes: { ATL: 11, BAL: 13 },
};
const p = parsePaste('Bijan Robinson\nJAX DST\nRavens D/ST\nSF DEF\nJustin Tucker');
const e = enrichRows(buildRows(p.rows, p.mapping), reference);
ok(e.rows.length === 1 && e.rows[0].name === 'Bijan Robinson',
   `DST/DEF/K dropped after inference (kept ${e.rows.length}: ${e.rows.map((r) => r.name)})`);
ok(e.dropped === 4, `four rows dropped (${e.dropped})`);
ok(e.unresolved.length === 0, `defenses are not reported as unresolved names (${e.unresolved})`);

console.log(fails ? `\n${fails} failing check(s)` : '\nAll ambiguity checks passed');
process.exit(fails ? 1 : 0);
