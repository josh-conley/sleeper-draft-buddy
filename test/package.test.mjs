// Validates the shipped package: every file the manifest references exists,
// nothing developer-only leaks in, and the zip is loadable as an extension.
// Run: npm run build && node test/package.test.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative, dirname } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const NAME = `sleeper-draft-buddy-v${manifest.version}`;
const STAGE = join(ROOT, 'dist', NAME);
const ZIP = join(ROOT, 'dist', `${NAME}.zip`);

ok(existsSync(STAGE) && existsSync(ZIP), 'build output exists (run `npm run build` first)');
if (!existsSync(STAGE)) process.exit(1);

const has = (p) => existsSync(join(STAGE, p));

// ---- manifest completeness ----
ok(manifest.manifest_version === 3, 'manifest v3');
ok(/^\d+\.\d+\.\d+$/.test(manifest.version), `version is a valid extension version (${manifest.version})`);
ok(manifest.name && manifest.description, 'name and description present');
ok(manifest.description.length <= 132, `description fits the store limit (${manifest.description.length}/132)`);

// ---- every referenced file ships ----
for (const [size, p] of Object.entries(manifest.icons || {})) ok(has(p), `icon ${size} ships (${p})`);
ok(has(manifest.action.default_popup), `popup ships (${manifest.action.default_popup})`);
for (const cs of manifest.content_scripts) for (const js of cs.js) ok(has(js), `content script ships (${js})`);

// web_accessible_resources globs must actually resolve to something
for (const war of manifest.web_accessible_resources || []) {
  for (const res of war.resources) {
    if (!res.includes('*')) { ok(has(res), `web-accessible file ships (${res})`); continue; }
    const dir = dirname(res);
    const ext = res.slice(res.lastIndexOf('.'));
    const found = has(dir) && readdirSync(join(STAGE, dir)).some((f) => f.endsWith(ext));
    ok(found, `web-accessible glob resolves (${res})`);
  }
}

// ---- the popup's own references ----
const popupDir = dirname(manifest.action.default_popup);
const html = readFileSync(join(STAGE, manifest.action.default_popup), 'utf8');
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  ok(has(join(popupDir, m[1])), `popup asset resolves (${m[1]})`);
}

// ---- imports resolve inside the package ----
const walk = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(STAGE);
let badImports = [];
for (const f of files.filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
    if (!existsSync(join(dirname(f), m[1]))) badImports.push(`${relative(STAGE, f)} -> ${m[1]}`);
  }
}
ok(badImports.length === 0, `all relative imports resolve${badImports.length ? ': ' + badImports.join(', ') : ''}`);

// ---- nothing developer-only leaks in ----
const rel = files.map((f) => relative(STAGE, f));
const leaked = rel.filter((f) =>
  /(^|\/)(test|tools|fixtures|node_modules|dist)(\/|$)/.test(f) ||
  /(package\.json|package-lock\.json|\.gitignore|preview\.html|\.test\.mjs)$/.test(f)
);
ok(leaked.length === 0, `no developer files in the package${leaked.length ? ': ' + leaked.join(', ') : ''}`);
ok(rel.includes('INSTALL.md'), 'install guide is included for friends');
ok(rel.includes('LICENSE'), 'license is included');

// ---- the zip itself ----
const listing = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).trim().split('\n');
ok(listing.every((l) => l.startsWith(NAME + '/')), 'zip contains one top-level folder, so unzipping is tidy');
ok(listing.some((l) => l === `${NAME}/manifest.json`), 'manifest sits at the root of that folder');
const kb = statSync(ZIP).size / 1024;
ok(kb < 500, `zip is small (${kb.toFixed(1)} KB)`);

console.log(fails ? `\n${fails} failing check(s)` : '\nPackage looks shippable');
process.exit(fails ? 1 : 0);
