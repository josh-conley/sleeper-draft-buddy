// Crops a screenshot to the Chrome Web Store's 1280x800 and writes it into
// store/screenshots/. Mac screenshots are far wider than 16:10, so the crop
// anchor matters: "right" keeps the Draft Buddy panel whole, which is usually
// what you want, since a panel clipped mid-column looks like a mistake.
//
// "fit" crops nothing: it scales the whole image down and letterboxes it to
// 1280x800. Nothing is lost and nothing is distorted, but the content ends up
// smaller, so check the panel text is still readable.
//
//   node tools/crop-shot.mjs <input.png> <name> [left|center|right|fit]
//   node tools/crop-shot.mjs ~/Desktop/Shot.png 1-overlay right
//   node tools/crop-shot.mjs ~/Desktop/Shot.png 1-overlay fit
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const [input, name, anchor = 'right'] = process.argv.slice(2);
if (!input || !name) {
  console.error('usage: node tools/crop-shot.mjs <input.png> <name> [left|center|right|fit]');
  process.exit(1);
}
if (!existsSync(input)) { console.error(`no such file: ${input}`); process.exit(1); }

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = join(ROOT, 'store', 'screenshots');
mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, `${name}.png`);

const dim = (f, k) =>
  Number(execFileSync('sips', ['-g', k, f], { encoding: 'utf8' }).trim().split(/\s+/).pop());
const W = dim(input, 'pixelWidth');
const H = dim(input, 'pixelHeight');

const PAD = '0F1116'; // matches Sleeper's dark surround, so the bars read as intentional
const tmp = '/tmp/crop-shot-stage.png';

if (anchor === 'fit') {
  // Scale so the whole image fits inside 1280x800, then pad out to exactly that.
  const scale = Math.min(1280 / W, 800 / H);
  const fw = Math.round(W * scale);
  const fh = Math.round(H * scale);
  execFileSync('sips', ['-z', String(fh), String(fw), input, '--out', tmp], { stdio: 'ignore' });
  execFileSync('sips', ['-p', '800', '1280', '--padColor', PAD, tmp, '--out', out], { stdio: 'ignore' });
  console.log(`${W}x${H}  ->  fit ${fw}x${fh}  ->  padded to 1280x800 (no crop)`);
  console.log(`wrote ${out.replace(ROOT, '')}`);
  process.exit(0);
}

const TARGET = 1280 / 800; // 1.6
let cw = Math.round(H * TARGET);
let ch = H;
if (cw > W) { cw = W; ch = Math.round(W / TARGET); } // taller than 16:10

const offX = anchor === 'left' ? 0 : anchor === 'center' ? Math.round((W - cw) / 2) : W - cw;
const offY = ch === H ? 0 : Math.round((H - ch) / 2);

execFileSync('sips', ['-c', String(ch), String(cw), '--cropOffset', String(offY), String(offX), input, '--out', tmp], { stdio: 'ignore' });
execFileSync('sips', ['-z', '800', '1280', tmp, '--out', out], { stdio: 'ignore' });

console.log(`${W}x${H}  ->  crop ${cw}x${ch} @ (${offX},${offY}) [${anchor}]  ->  1280x800`);
console.log(`wrote ${out.replace(ROOT, '')}`);
