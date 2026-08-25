// Builds a clean, shareable zip: only what the extension needs to run.
// Run: npm run build
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
// --store builds the archive the Chrome Web Store dashboard wants: files at the
// archive root, and no INSTALL.md (its side-loading instructions are wrong, and
// confusing, for someone installing from the store).
const STORE = process.argv.includes('--store');
const NAME = `sleeper-draft-buddy-v${manifest.version}${STORE ? '-store' : ''}`;
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, NAME);

// Everything else — tests, tooling, fixtures, node_modules — stays out.
const INCLUDE = STORE
  ? ['manifest.json', 'src', 'icons', 'LICENSE']
  : ['manifest.json', 'src', 'icons', 'INSTALL.md', 'LICENSE'];

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const item of INCLUDE) {
  const from = join(ROOT, item);
  if (!existsSync(from)) { console.warn(`  (skipped missing ${item})`); continue; }
  cpSync(from, join(STAGE, item), { recursive: true });
}

// Fail loudly rather than shipping a broken zip.
const problems = [];
for (const [size, path] of Object.entries(manifest.icons || {})) {
  if (!existsSync(join(STAGE, path))) problems.push(`missing icon ${size}: ${path}`);
}
const popup = manifest.action?.default_popup;
if (popup && !existsSync(join(STAGE, popup))) problems.push(`missing popup: ${popup}`);
for (const cs of manifest.content_scripts || []) {
  for (const js of cs.js) if (!existsSync(join(STAGE, js))) problems.push(`missing content script: ${js}`);
}
if (problems.length) {
  console.error('build failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// Store archives are zipped from inside the folder so manifest.json sits at the
// root; the shareable one keeps its folder so unzipping is tidy for a human.
if (STORE) {
  execFileSync('zip', ['-r', '-q', join(DIST, `${NAME}.zip`), '.'], { cwd: STAGE });
} else {
  execFileSync('zip', ['-r', '-q', `${NAME}.zip`, NAME], { cwd: DIST });
}

const walk = (d) => readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(STAGE);
const zipBytes = statSync(join(DIST, `${NAME}.zip`)).size;

console.log(`\n${NAME}.zip  (${(zipBytes / 1024).toFixed(1)} KB, ${files.length} files)`);
for (const f of files.sort()) console.log('  ' + relative(STAGE, f));
console.log(`\nwrote dist/${NAME}.zip`);
