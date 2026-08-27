// Install-time setup.
//
// The one job here is that a brand-new install already has a ranking in it.
// Waiting for the user to open My Rankings means the first draft they walk into
// shows an empty panel, which reads as a broken extension at the exact moment
// they have no patience for one.
//
// Kept deliberately small: MV3 service workers are killed and restarted at the
// browser's discretion, so nothing here holds state or assumes it stays alive.

import { api } from './lib/ext.js';
import { seedRankings } from './lib/seed.js';

const LOG = '[DraftBuddy]';

api.runtime.onInstalled.addListener(({ reason }) => {
  // On an update the user already has a list — seedRankings would decline
  // anyway, but there is no reason to spend the requests finding that out.
  if (reason !== 'install') return;
  seedRankings().then(({ seeded, count, reason: why }) => {
    console.info(
      seeded
        ? `${LOG} seeded ${count} players in Sleeper ADP order`
        : `${LOG} could not seed a starting ranking (${why}) — it will retry on your first draft page`
    );
  });
});

// The panel asks for this when it opens onto an empty board, which is how an
// install that could not reach the network still ends up with a ranking.
api.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type !== 'rankings:seed') return false;
  seedRankings().then(respond);
  return true; // respond() is called asynchronously
});
