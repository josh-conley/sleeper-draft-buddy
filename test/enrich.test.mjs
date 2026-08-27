// Inference: a bare list of names -> full ranking rows.
// Requires jsdom only for chrome shim-free bits; runs plain. Run: node test/enrich.test.mjs
import { readFileSync } from 'node:fs';
import { parsePaste, buildRows, splitLeadingRank } from '../src/lib/parse.js';
import { enrichRows, buildPlayerLookup } from '../src/lib/enrich.js';
import { clockState, clockTooltip, SOON_MAX } from '../src/lib/clock.js';

let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

// A stand-in reference set, shaped exactly like fetchPlayerIndex() output:
// [player_id, name, position, team, search_rank]
const reference = {
  season: '2026',
  players: [
    ['1', 'Bijan Robinson', 'RB', 'ATL', 1],
    ['2', 'Jahmyr Gibbs', 'RB', 'DET', 2],
    ['3', "Ja'Marr Chase", 'WR', 'CIN', 3],
    ['4', 'Josh Allen', 'QB', 'BUF', 4],
    ['5', 'Brock Bowers', 'TE', 'LV', 5],
    ['6', 'Puka Nacua', 'WR', 'LAR', 6],
    ['7', 'Amon-Ra St. Brown', 'WR', 'DET', 7],
    ['8', 'Justin Tucker', 'K', 'BAL', 900],
  ],
  byes: { ATL: 11, DET: 6, CIN: 6, BUF: 7, LV: 13, LAR: 11, BAL: 13 },
};

// ---- bare list of names, the headline case ----
const bare = "Bijan Robinson\nJahmyr Gibbs\nJa'Marr Chase\nJosh Allen\nBrock Bowers";
const p1 = parsePaste(bare);
ok(p1.namesOnly === true, 'bare list detected as names-only (no mapping step)');
const r1 = enrichRows(buildRows(p1.rows, p1.mapping), reference);
ok(r1.rows.length === 5, `5 rows (${r1.rows.length})`);
ok(r1.unresolved.length === 0, `all names resolved (${r1.unresolved.length} unresolved)`);
ok(r1.rows.map((r) => r.myRank).join(',') === '1,2,3,4,5', 'rank inferred from row order');
ok(r1.rows[0].position === 'RB' && r1.rows[0].team === 'ATL', 'position and team inferred');
ok(r1.rows[0].bye === 11 && r1.rows[1].bye === 6, 'bye inferred from the schedule');
ok(r1.rows.map((r) => r.posRank).join(',') === 'RB1,RB2,WR1,QB1,TE1', `positional rank computed (${r1.rows.map((r) => r.posRank).join(',')})`);
ok(r1.rows[0].sleeperId === '1', 'resolved to a Sleeper player_id');
ok(r1.rows[0].inferred.position && r1.rows[0].inferred.bye, 'inferred values are flagged as inferred');

// ---- inline ranks ----
ok(splitLeadingRank('1. Bijan Robinson')[0] === 'Bijan Robinson', 'strips "1. "');
ok(splitLeadingRank('12) Josh Allen')[1] === 12, 'strips "12) " and keeps the rank');
ok(splitLeadingRank('Amon-Ra St. Brown')[0] === 'Amon-Ra St. Brown', 'leaves a plain name alone');
const p2 = parsePaste("3. Ja'Marr Chase\n1. Bijan Robinson\n2. Jahmyr Gibbs");
const r2 = enrichRows(buildRows(p2.rows, p2.mapping), reference);
ok(r2.rows.map((r) => r.myRank).join(',') === '3,1,2', 'inline ranks win over row order');
ok(r2.rows.find((r) => r.name === 'Bijan Robinson').posRank === 'RB1', 'pos rank follows the stated rank, not file order');

// ---- explicit columns beat inference ----
const p3 = parsePaste('Player,Pos,Team,Bye\nBijan Robinson,RB,ATL,99');
const r3 = enrichRows(buildRows(p3.rows, p3.mapping), reference);
ok(r3.rows[0].bye === 99, 'an explicit bye overrides the inferred one');
ok(r3.rows[0].inferred.bye === false, 'explicit values are not flagged as inferred');

// ---- unknown names survive rather than vanish ----
const p4 = parsePaste('Bijan Robinson\nNotta Realplayer');
const r4 = enrichRows(buildRows(p4.rows, p4.mapping), reference);
ok(r4.rows.length === 2, 'an unknown name is kept in the list, not dropped');
ok(r4.unresolved.length === 1 && r4.unresolved[0] === 'Notta Realplayer', 'unknown name reported');
ok(r4.rows[1].position === null, 'unknown name has no position, so the UI can flag it');

// ---- DEF/K excluded ----
const p5 = parsePaste('Player,Pos\nJustin Tucker,K\nBijan Robinson,RB');
ok(buildRows(p5.rows, p5.mapping).length === 1, 'kickers dropped at ingest');

// ---- ambiguity resolves to the better-ranked player ----
const dupRef = { ...reference, players: [...reference.players, ['9', 'Josh Allen', 'WR', 'JAX', 500]] };
const lk = buildPlayerLookup(dupRef.players);
ok(lk.byName.get('joshallen')[0] === '4', 'duplicate names resolve to the better-ranked player');

// ---- real fixture ----
const csv = readFileSync(new URL('../fixtures/names-only.csv', import.meta.url), 'utf8');
const pf = parsePaste(csv);
ok(pf.namesOnly, 'real fixture parses as a bare name list');
ok(buildRows(pf.rows, pf.mapping).length === 75, 'real fixture yields 75 rows');

// ---- the dot ----
ok(clockState(0).id === 'on-clock', 'dot: 0 away = green');
ok(clockState(1).id === 'soon' && clockState(SOON_MAX).id === 'soon', 'dot: 1-4 away = yellow');
ok(clockState(SOON_MAX + 1).id === 'far' && clockState(30).id === 'far', 'dot: 5+ away = red');
ok(clockState(null).id === 'unknown', 'dot: unknown when picks-away is unknown');
ok(clockState(0, false).id === 'unknown', 'dot: disconnected never shows a confident colour');
ok(/on the clock/i.test(clockTooltip(0)), 'tooltip for on the clock');
ok(/3 picks/.test(clockTooltip(3)), 'tooltip counts picks');
// Nothing is inferred: with no username the dot says so rather than counting
// down to a turn it cannot know is yours.
ok(/username/i.test(clockTooltip(3, true, false)), 'tooltip asks for the username when nothing is known');

console.log(fails ? `\n${fails} failing check(s)` : '\nAll enrichment checks passed');
process.exit(fails ? 1 : 0);
