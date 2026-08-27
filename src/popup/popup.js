// Tells you at a glance whether the panel is active on this tab and how many
// players are loaded — the two things you'd otherwise have to go and check.
// Chrome exposes `chrome`; Firefox's promise-returning namespace is `browser`.
// This file is a classic script and cannot import src/lib/ext.js, so it repeats
// the one line that matters.
const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);
$('ver').textContent = 'v' + api.runtime.getManifest().version;

async function showCount() {
  const { rankings } = await api.storage.local.get('rankings');
  const n = Array.isArray(rankings) ? rankings.length : 0;
  $('listnote').textContent = n
    ? `${n} players loaded.`
    : 'No player list loaded yet — one name per line is enough.';
  return n;
}
showCount();

/**
 * A draft open in another tab holds its rankings in memory. It picks up edits
 * on its own through storage events, so this is the manual nudge for when you
 * want to be sure rather than wait — and it is the one control that reports
 * back what actually happened.
 */
$('refresh').onclick = async () => {
  $('refresh').disabled = true;
  $('refresh').textContent = 'Refreshing…';
  const n = await showCount();

  const tabs = await api.tabs.query({ url: 'https://sleeper.com/*' });
  const results = await Promise.all(
    tabs.map((t) => api.tabs.sendMessage(t.id, { type: 'rankings:reload' }).catch(() => null))
  );
  const reached = results.filter(Boolean).length;

  $('refresh').disabled = false;
  $('refresh').textContent = 'Refresh';
  $('listnote').textContent = reached
    ? `${n} players · updated ${reached} draft tab${reached === 1 ? '' : 's'}.`
    : `${n} players loaded.`;
};

const DRAFT_URL = /^https:\/\/sleeper\.com\/(beta\/)?draft\//;

api.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  const url = tab?.url || '';
  const el = $('status');
  if (DRAFT_URL.test(url)) {
    el.textContent = 'Active on this draft board.';
    el.className = 'status on';
    $('open').textContent = 'Close';
    $('open').onclick = () => window.close();
  } else if (url.startsWith('https://sleeper.com/')) {
    el.textContent = 'On Sleeper — open a draft to see the panel.';
    el.className = 'status off';
    $('open').textContent = 'Close';
    $('open').onclick = () => window.close();
  } else {
    el.textContent = 'Not on Sleeper.';
    el.className = 'status off';
    $('open').onclick = () => api.tabs.create({ url: 'https://sleeper.com/leagues' });
  }
});

// The ranking page is a normal extension page, so it opens in a tab like any
// other and works whether or not a draft is running.
$('rank').onclick = () => {
  api.tabs.create({ url: api.runtime.getURL('src/rankings/rankings.html') });
  window.close();
};
