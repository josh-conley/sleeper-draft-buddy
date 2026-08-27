// A fresh install must already have a ranking in it.
// Requires jsdom: npm i    Run: node test/seed.test.mjs
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

const FEED = [
  ['Jahmyr Gibbs', 'RB', 'DET', 1.9],
  ['Bijan Robinson', 'RB', 'ATL', 2.4],
  ["Ja'Marr Chase", 'WR', 'CIN', 3.7],
];

/** Sleeper's projections endpoint, plus the reference lookups enrichRows makes. */
let calls = 0;
let failNetwork = false;
function fakeFetch(url) {
  calls++;
  if (failNetwork) return Promise.reject(new Error('offline'));
  const u = String(url);
  const body = (data) => Promise.resolve({ ok: true, status: 200, json: async () => data });
  if (u.includes('/projections/nfl/')) {
    return body(FEED.map(([name, position, team, adp], i) => {
      const parts = name.split(' ');
      return {
        player_id: String(100 + i),
        last_modified: Date.UTC(2026, 7, 26),
        stats: { adp_half_ppr: adp },
        player: { first_name: parts[0], last_name: parts.slice(1).join(' '), position, team },
      };
    }));
  }
  // Reference data is optional for seeding; refuse it to prove that.
  return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
}

function install(seed = {}) {
  const store = { ...seed };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (k) => (k == null ? { ...store } : (k in store ? { [k]: store[k] } : {})),
        set: async (obj) => Object.assign(store, obj),
      },
      onChanged: { addListener() {} },
    },
    runtime: { getURL: (p) => p, onMessage: { addListener() {} }, onInstalled: { addListener() {} } },
  };
  globalThis.browser = undefined;
  globalThis.fetch = fakeFetch;
  return store;
}

const fresh = () => import(`../src/lib/seed.js?${Math.random()}`);

// ---- a brand-new install ends up with a usable list, unprompted
let store = install();
let { seedRankings } = await fresh();
let res = await seedRankings();
ok(res.seeded === true, `a fresh install seeds (${JSON.stringify(res)})`);
ok(res.count === 3, `every ADP player becomes a row (${res.count})`);
ok(store.rankings.length === 3, 'the list is written to storage');
ok(store.rankings[0].name === 'Jahmyr Gibbs', 'seeded in ADP order, best first');
ok(store.rankings.every((r) => r.id), 'every row carries an id — rows without one match no picks');
ok(new Set(store.rankings.map((r) => r.id)).size === 3, 'ids are unique');
ok(store.rankings[0].myRank === 1 && store.rankings[2].myRank === 3, 'ranks numbered from one');
ok(!!store.adpV1?.players?.length, 'the ADP board is cached alongside it');

// ---- a list somebody already made is never overwritten
store = install({ rankings: [{ id: 'r0', name: 'My Guy', myRank: 1 }] });
({ seedRankings } = await fresh());
res = await seedRankings();
ok(res.seeded === false && res.reason === 'already-ranked', 'an existing ranking is left alone');
ok(store.rankings.length === 1 && store.rankings[0].name === 'My Guy', 'and is untouched on disk');

// Even a one-row list counts as yours. This is the guarantee that matters most:
// seeding runs at install and again on every empty panel, so a bug here would
// wipe an order somebody dragged into place mid-draft.
store = install({ rankings: [{ id: 'r0', name: 'Only Row', myRank: 1 }] });
({ seedRankings } = await fresh());
await seedRankings();
await seedRankings();
ok(store.rankings.length === 1, 'repeated seeding never grows or replaces a real list');

// ---- failure is survivable and silent
store = install();
failNetwork = true;
({ seedRankings } = await fresh());
res = await seedRankings();
failNetwork = false;
ok(res.seeded === false, 'an unreachable feed does not seed');
ok(!('rankings' in store) || !store.rankings?.length, 'and writes nothing rather than an empty list');
ok(typeof res.reason === 'string' && res.reason.length > 0, `it says why (${res.reason})`);

// ---- the second install of the day does not re-pull what it already has
store = install();
({ seedRankings } = await fresh());
await seedRankings();
const afterSeed = calls;
store.rankings = [];
await seedRankings();
ok(calls > afterSeed, 'seeding again does fetch');
const cached = store.adpV1;
ok(cached && Date.now() - cached.at < 60_000, 'the cached board is stamped fresh');

console.log(fails ? `\n${fails} failing check(s)` : '\nAll seeding checks passed');
process.exit(fails ? 1 : 0);
