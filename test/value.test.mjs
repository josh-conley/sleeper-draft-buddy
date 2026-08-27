// Banding and the "can I wait?" question, which is the one that decides a pick.
import { BANDS, bandFor } from '../src/lib/value.js';

let fails = 0;
const ok = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) fails++; };

// Bands are unchanged in meaning; only their colours moved.
ok(bandFor(1, 20).id === 'steal', 'rank 1 still on the board at pick 20 is a steal');
ok(bandFor(20, 20).id === 'fair', 'taken at his rank is fair');
ok(bandFor(30, 20).id === 'reach', 'ten early is a reach');
ok(bandFor(60, 20).id === 'big-reach', 'forty early is a big reach');
ok(BANDS.map((b) => b.id).join(',') === 'steal,value,fair,reach,big-reach', 'band order unchanged');

console.log(fails ? `\n${fails} check(s) failed` : '\nValue logic is sound');
process.exit(fails ? 1 : 0);
