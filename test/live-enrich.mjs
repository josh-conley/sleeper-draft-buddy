// Live end-to-end inference check against the real Sleeper API.
// Needs network. Run: node test/live-enrich.mjs
import { readFileSync } from 'node:fs';
import { parsePaste, buildRows } from '../src/lib/parse.js';
import { enrichRows } from '../src/lib/enrich.js';

// enrich.js reads chrome.storage in loadReference(); here we call the raw
// fetchers directly so this runs outside the extension.
const { fetchPlayerIndex, fetchByeWeeks, getCurrentSeason } = await import('../src/lib/enrich.js');

const season = await getCurrentSeason();
const [players, byes] = await Promise.all([fetchPlayerIndex(), fetchByeWeeks(season)]);
console.log(`season ${season} · ${players.length} players · ${Object.keys(byes).length} teams with byes`);

const csv = readFileSync(new URL('../fixtures/names-only.csv', import.meta.url), 'utf8');
const parsed = parsePaste(csv);
const { rows, unresolved } = enrichRows(buildRows(parsed.rows, parsed.mapping), { season, players, byes });

const missingPos = rows.filter((r) => !r.position);
const missingBye = rows.filter((r) => r.bye == null);
console.log(`\nrows: ${rows.length}`);
console.log(`unresolved names: ${unresolved.length}${unresolved.length ? ' -> ' + unresolved.join(', ') : ''}`);
console.log(`missing position: ${missingPos.length}`);
console.log(`missing bye:      ${missingBye.length}${missingBye.length ? ' -> ' + missingBye.map(r=>r.name+'/'+r.team).join(', ') : ''}`);
console.log('\nfirst 8 fully inferred rows:');
console.table(rows.slice(0, 8).map((r) => ({
  rank: r.myRank, posRank: r.posRank, pos: r.position, player: r.name, bye: r.bye, team: r.team,
})));
const bad = unresolved.length + missingPos.length + missingBye.length;
console.log(bad ? `\n${bad} problem(s)` : '\nEvery name resolved with a full position, team and bye.');
process.exit(bad ? 1 : 0);
