// Every path that produces ranking rows — the ranking page, a paste, a file
// import — must produce rows the matcher can actually use. A row without an
// `id` indexes to undefined and silently makes every pick "unmatched", which is
// the bug this file exists to catch.
import { buildRows } from '../src/lib/parse.js';
import { enrichRows } from '../src/lib/enrich.js';
import { buildIndex } from '../src/lib/names.js';

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

// What the ranking page holds: names, in board order.
const names = ['Jahmyr Gibbs', 'Bijan Robinson', "Ja'Marr Chase", 'Amon-Ra St. Brown'];
const rows = buildRows(names.map((n) => [n]), ['name']);

check('every row has an id', rows.every((r) => typeof r.id === 'string' && r.id.length));
check('order is preserved', rows.map((r) => r.name).join('|') === names.join('|'));

// Sync sends names only; position and team arrive here the same way they do for
// a pasted list — inferred from Sleeper's own player data by saveList. Index the
// enriched rows, because that is what the panel actually holds.
const reference = {
  season: '2026',
  players: [
    ['1', 'Jahmyr Gibbs', 'RB', 'DET', 2],
    ['2', 'Bijan Robinson', 'RB', 'ATL', 1],
    ['3', "Ja'Marr Chase", 'WR', 'CIN', 3],
    ['4', 'Amon-Ra St. Brown', 'WR', 'DET', 8],
  ],
};
const { rows: enriched } = enrichRows(rows, reference);
check('enrichment fills position and team', enriched.every((r) => r.position && r.team));
check('enrichment keeps the ids', enriched.every((r, i) => r.id === rows[i].id));

const index = buildIndex(enriched);
const pick = (first, last, position, team) => ({
  metadata: { first_name: first, last_name: last, position, team },
});

const matched = index.match(pick('Jahmyr', 'Gibbs', 'RB', 'DET'), { claimed: new Set() });
check('a pick matches a ranked row', !!matched && matched === enriched[0].id);

// The abbreviated form Sleeper's classic board uses.
const abbreviated = index.match(pick('A.', 'St. Brown', 'WR', 'DET'), { claimed: new Set() });
check('abbreviated names still match', !!abbreviated);

// The regression itself: rows without ids must not look healthy.
const handBuilt = names.map((name, i) => ({ name, myRank: i + 1 }));
const brokenIndex = buildIndex(handBuilt);
const broken = brokenIndex.match(pick('Jahmyr', 'Gibbs', 'RB', 'DET'), { claimed: new Set() });
check('rows without ids cannot resolve a pick (the regression)', broken === undefined || broken === null);

// Adding players on an ADP update must not reuse an id already in use.
const existing = buildRows([['Jahmyr Gibbs'], ['Bijan Robinson']], ['name']);
const appended = buildRows([['Ashton Jeanty'], ['De\'Von Achane']], ['name'])
  .map((r, i) => ({ ...r, id: `r${existing.length + i}` }));
const allIds = [...existing, ...appended].map((r) => r.id);
check('appended rows get fresh ids', new Set(allIds).size === allIds.length);

console.log(failures ? `\n${failures} check(s) failed` : '\nRow shape is sound');
process.exit(failures ? 1 : 0);
