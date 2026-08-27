// Render the ranking page in a real browser and photograph it. jsdom proves
// behaviour; it says nothing about whether the thing is legible.
// Playwright is not a dependency of this extension — it is borrowed from
// wherever it happens to be installed. If this import fails, either npm i -D
// playwright here, or skip it: the jsdom suite covers behaviour, and this only
// answers "is it legible".
const { chromium } = await import('playwright').catch(() =>
  import('/Users/joshconley/Development/ff-rankings/node_modules/playwright/index.mjs')
);
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = '/Users/joshconley/Development/sleeper-draft-buddy';
const OUT = process.argv[2] || new URL('.', import.meta.url).pathname;

const FEED = [
  ['Jahmyr Gibbs','RB','DET',1.3,8],['Bijan Robinson','RB','ATL',2.8,5],["Ja'Marr Chase",'WR','CIN',3.3,10],
  ['Puka Nacua','WR','LAR',4.6,6],['Christian McCaffrey','RB','SF',5.0,14],['Jonathan Taylor','RB','IND',6.5,11],
  ['Jaxon Smith-Njigba','WR','SEA',6.9,9],['Amon-Ra St. Brown','WR','DET',8.3,8],['James Cook','RB','BUF',9.7,7],
  ['CeeDee Lamb','WR','DAL',10.9,10],['Saquon Barkley','RB','PHI',11.5,9],['Justin Jefferson','WR','MIN',12.9,6],
  ['Ashton Jeanty','RB','LV',13.6,8],['Brock Bowers','TE','LV',15.1,8],['Josh Allen','QB','BUF',20.8,7],
];

const rankings = FEED.map(([name, position, team, , bye], i) => ({
  id: `r${i}`, name, position, team, bye, myRank: i + 1,
  posRank: `${position}${FEED.slice(0, i + 1).filter(([, p]) => p === position).length}`,
}));
const adpV1 = { date: '2026-08-26', at: Date.now(), players: FEED.map(([name, position, team, adp], i) => ({ id: String(i), name, position, team, adp })) };

// ES modules will not load over file:// — the origin is null and every import
// is blocked. Serve the extension directory instead.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = join(ROOT, normalize(decodeURI(req.url.split('?')[0])));
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/plain' });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(8391, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 780 }, deviceScaleFactor: 2 });

// Stand in for the extension APIs the page expects.
await page.addInitScript(({ rankings, adpV1 }) => {
  const store = { rankings, adpV1, playerIndexV1: { at: Date.now(), season: '2026', players: [], byes: {} } };
  window.chrome = {
    runtime: { getURL: (p) => p },
    storage: { local: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (o) => Object.assign(store, o),
    } },
  };
}, { rankings, adpV1 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:8391/src/rankings/rankings.html');
await page.waitForTimeout(900);

const count = await page.locator('.row').count();
console.log('rows rendered:', count);
if (count) console.log('first row    :', (await page.locator('.row').first().innerText()).replace(/\n/g, ' | '));
else console.log('empty text   :', await page.locator('#empty').innerText());
console.log('status       :', await page.locator('.status').innerText());
console.log('page errors  :', errors.length ? errors : 'none');
// Measure rather than squint: the badge must hug its text, not fill its track.
const badge = await page.evaluate(() => {
  const el = document.querySelector('.row .pos');
  const track = el.parentElement.getBoundingClientRect();
  return { badge: Math.round(el.getBoundingClientRect().width), column: Math.round(track.width / 6) };
});
console.log('badge width  :', badge.badge + 'px (position column track is wider)');

writeFileSync(`${OUT}/rankings-page.png`, await page.screenshot());
await browser.close();
server.close();
