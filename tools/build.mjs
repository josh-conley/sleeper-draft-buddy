// Builds a clean, shareable zip: only what the extension needs to run.
// Run: npm run build
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
// --store builds the archive the Chrome Web Store dashboard wants: files at the
// archive root, and no INSTALL.md (its side-loading instructions are wrong, and
// confusing, for someone installing from the store).
const STORE = process.argv.includes('--store');
// --firefox stamps the add-on ID Firefox requires for signing. It is injected
// at build time rather than committed, because Chrome warns about the key and
// there is no reason for one store's package to carry the other's metadata.
const FIREFOX = process.argv.includes('--firefox');
const SUFFIX = FIREFOX ? '-firefox' : STORE ? '-store' : '';
const NAME = `sleeper-draft-buddy-v${manifest.version}${SUFFIX}`;
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, NAME);

// Everything else — tests, tooling, fixtures, node_modules — stays out.
const INCLUDE = STORE || FIREFOX
  ? ['manifest.json', 'src', 'icons', 'LICENSE']
  : ['manifest.json', 'src', 'icons', 'INSTALL.md', 'LICENSE'];

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const item of INCLUDE) {
  const from = join(ROOT, item);
  if (!existsSync(from)) { console.warn(`  (skipped missing ${item})`); continue; }
  cpSync(from, join(STAGE, item), { recursive: true });
}

if (FIREFOX) {
  const staged = JSON.parse(readFileSync(join(STAGE, 'manifest.json'), 'utf8'));
  staged.browser_specific_settings = {
    gecko: {
      id: 'sleeper-draft-buddy@joshconley.dev',
      // 142 is where Firefox for Android gained data_collection_permissions;
      // desktop needed only 140, but a lower floor lints dirty on Android and
      // by now the difference is a rounding error in installed versions.
      strict_min_version: '142.0',
      // Required by AMO for new submissions, and it belongs inside gecko — as a
      // sibling it validates as missing. This extension collects nothing:
      // rankings and preferences never leave the browser, and the two hosts it
      // reads from are sent nothing that identifies anyone.
      data_collection_permissions: { required: ['none'] },
    },
  };
  writeFileSync(join(STAGE, 'manifest.json'), `${JSON.stringify(staged, null, 2)}\n`);
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
// The service worker is referenced by the manifest but by nothing the other
// checks walk, so without this a build that dropped it would zip up clean and
// only fail once someone installed it.
const worker = manifest.background?.service_worker;
if (worker && !existsSync(join(STAGE, worker))) problems.push(`missing service worker: ${worker}`);
if (problems.length) {
  console.error('build failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// Store archives are zipped from inside the folder so manifest.json sits at the
// root; the shareable one keeps its folder so unzipping is tidy for a human.
if (STORE || FIREFOX) {
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
