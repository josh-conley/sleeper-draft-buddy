// Static wiring checks on the entry points.
//
// This file exists because a refactor deleted five module-level `let`s from
// main.js and every other suite still passed: they exercise panel.js and lib/,
// and nothing loaded main.js at all. The extension was completely dead — no
// picks, no clock, "waiting for draft…" forever — with a green test run.
//
// Assigning to an undeclared binding inside an ES module throws a ReferenceError
// only when that line runs, so no amount of importing catches it. It has to be
// read out of the source.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

const walk = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  .filter((f) => f.endsWith('.js'));

const files = walk(join(ROOT, 'src'));

// 1. Nothing assigns to a binding it never declared.
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const declared = new Set(
    [...src.matchAll(/^\s*(?:export\s+)?(?:let|const|var|function|async function|class)\s+(\w+)/gm)].map((m) => m[1])
  );
  for (const m of src.matchAll(/^\s*(?:export\s+)?(?:let|const)\s+\{([^}]+)\}/gm)) {
    for (const n of m[1].split(',')) declared.add(n.trim().split(':').pop().trim());
  }
  for (const m of src.matchAll(/^import\s+(?:\{([^}]*)\}|(\w+)|\*\s+as\s+(\w+))/gm)) {
    if (m[2] || m[3]) declared.add(m[2] || m[3]);
    for (const n of (m[1] ?? '').split(',').filter(Boolean)) declared.add(n.trim().split(/\s+as\s+/).pop().trim());
  }

  const orphans = [...src.matchAll(/^\s{0,2}(\w+)\s=\s/gm)]
    .map((m) => m[1])
    .filter((name) => !declared.has(name) && !['globalThis', 'window', 'module', 'exports'].includes(name));

  const rel = file.slice(ROOT.length + 1);
  if (orphans.length) ok(false, `${rel} assigns to undeclared: ${[...new Set(orphans)].join(', ')}`);
}
ok(true, `no file assigns to a binding it never declared (${files.length} checked)`);

// 2. Every named import actually exists in the module it comes from — the same
//    mistake in the other direction.
let missing = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^import\s+\{([^}]+)\}\s+from\s+'(\.[^']+)'/gm)) {
    const target = resolve(dirname(file), m[2]);
    const targetSrc = readFileSync(target, 'utf8');
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      const exported = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(targetSrc);
      if (!exported) { ok(false, `${file.slice(ROOT.length + 1)} imports ${name}, which ${m[2]} does not export`); missing++; }
    }
  }
}
ok(missing === 0, 'every named import resolves to a real export');

// 3. main.js still wires the draft up: the state the pick pipeline writes to
//    must exist, or picks land in a ReferenceError.
const main = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
// Only names this codebase actually references: the two extensions grew apart
// and a fixed list fails on whichever one is older, which is a broken test
// rather than a broken extension.
const pipeline = ['boardPicks', 'boardClockLabel', 'apiPicks', 'stopBoard', 'teams', 'poller', 'draftId']
  // Declared, or assigned at the top level. A bare word match also hits object
  // keys — `panel.update({ teams: ... })` is not module state.
  .filter((name) => new RegExp(`^let ${name}\\b|^\\s{0,2}${name} = `, 'm').test(main));
for (const name of pipeline) {
  ok(new RegExp(`^let ${name}\\b`, 'm').test(main), `main.js declares ${name}`);
}
ok(pipeline.length >= 4, `the pick pipeline's state is accounted for (${pipeline.length} names)`);
ok(/DraftPoller/.test(main) && /watchBoard/.test(main), 'and still starts both pick sources');

// The popup is the only place that tells a new user the board is draggable at
// all — nothing on the panel says so.
const popup = readFileSync(join(ROOT, 'src/popup/popup.html'), 'utf8');
ok(/Drag players to rank/i.test(popup), 'the popup tells you players can be dragged to rank');

// 4. Your team is detected, never typed.
//    The panel finds you from the Sleeper account signed in to the browser.
//    There is deliberately no entry box anywhere: a field that duplicates
//    something the browser already knows is a question not worth asking, and an
//    earlier build shipped both, which is how a stale typed name silently
//    tracked the wrong team.
const panelSrc = readFileSync(join(ROOT, 'src/panel/panel.js'), 'utf8');
const settingsSrc = readFileSync(join(ROOT, 'src/panel/settings.js'), 'utf8');
const storeSrc = readFileSync(join(ROOT, 'src/lib/store.js'), 'utf8');
const mainSrc = readFileSync(join(ROOT, 'src/main.js'), 'utf8');

ok(!/nameinput|renderUsernamePrompt/.test(panelSrc), 'the panel has no username entry box');
ok(!/username/i.test(settingsSrc) || !/input/.test(settingsSrc.split('username')[0].slice(-200)),
   'settings has no username field');
ok(!/username:/.test(storeSrc), 'and no username is persisted to settings');
ok(/readSleeperUserId/.test(mainSrc) && /fetchUserNames/.test(mainSrc),
   'the account is read from the browser instead');
ok(existsSync(join(ROOT, 'src/lib/whoami.js')), 'the module that does it is present');

// The slot is still never inferred — that was a separate assumption.
ok(!/autoSlot|resolveSlot|readOwnSlot/.test(mainSrc), 'no draft slot is inferred');

console.log(fails ? `\n${fails} check(s) failed` : '\nWiring is intact');
process.exit(fails ? 1 : 0);
