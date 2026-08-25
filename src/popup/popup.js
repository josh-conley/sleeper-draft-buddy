// Tells you at a glance whether the panel is active on this tab and how many
// players are loaded — the two things you'd otherwise have to go and check.
const $ = (id) => document.getElementById(id);
$('ver').textContent = 'v' + chrome.runtime.getManifest().version;

chrome.storage.local.get('rankings').then(({ rankings }) => {
  const n = Array.isArray(rankings) ? rankings.length : 0;
  $('listnote').textContent = n
    ? `${n} players loaded.`
    : 'No player list loaded yet — one name per line is enough.';
});

const DRAFT_URL = /^https:\/\/sleeper\.com\/(beta\/)?draft\//;

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
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
    $('open').onclick = () => chrome.tabs.create({ url: 'https://sleeper.com/leagues' });
  }
});
