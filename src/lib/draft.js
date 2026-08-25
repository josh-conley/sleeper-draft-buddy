// Draft id detection, picks polling, and snake-order math.

const API = 'https://api.sleeper.app/v1';

/** Pull the 18-ish digit draft id out of the current URL. */
export function getDraftId(href = location.href) {
  let m = href.match(/\/draft\/\w+\/(\d{6,})/);
  if (m) return m[1];
  m = href.match(/(\d{15,})/);
  return m ? m[1] : null;
}

/**
 * Watch for SPA navigation. Sleeper is a single-page app, so a draft id change
 * arrives without a page load. We patch the history methods, listen to
 * popstate, and keep a 1s href poll as a backstop for anything that slips past.
 */
export function onUrlChange(cb) {
  let last = location.href;
  const fire = () => {
    if (location.href === last) return;
    last = location.href;
    cb(location.href);
  };
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...args) {
      const r = orig.apply(this, args);
      queueMicrotask(fire);
      return r;
    };
  }
  window.addEventListener('popstate', fire);
  const timer = setInterval(fire, 1000);
  return () => clearInterval(timer);
}

/** Total picks made before a given slot's next turn, for snake or linear order. */
export function picksUntilTurn(pickNo, teams, slot, type = 'snake') {
  if (!teams || !slot || !Number.isFinite(pickNo)) return null;
  for (let p = pickNo; p < pickNo + teams * 2 + 2; p++) {
    if (slotForPick(p, teams, type) === slot) return p - pickNo;
  }
  return null;
}

export function slotForPick(pickNo, teams, type = 'snake') {
  const round = Math.ceil(pickNo / teams);
  const idx = ((pickNo - 1) % teams) + 1;
  if (type === 'snake' && round % 2 === 0) return teams - idx + 1;
  return idx;
}

export function formatPick(pickNo, teams) {
  if (!Number.isFinite(pickNo)) return '—';
  if (!teams) return `Pick ${pickNo}`;
  const round = Math.ceil(pickNo / teams);
  const inRound = ((pickNo - 1) % teams) + 1;
  return `${round}.${String(inRound).padStart(2, '0')}`;
}

/**
 * Polls /picks on an interval. Uses If-None-Match so unchanged responses come
 * back as a cheap 304. Backs off on errors and reports status transitions.
 *
 * handlers: { onPicks(picks), onMeta(draft), onStatus({state, error}) }
 */
export class DraftPoller {
  constructor(draftId, handlers = {}) {
    this.draftId = draftId;
    this.handlers = handlers;
    this.etag = null;
    this.failures = 0;
    this.timer = null;
    this.stopped = false;
    this.intervalMs = 2000;
  }

  async start(intervalMs = 2000) {
    this.intervalMs = intervalMs;
    this.stopped = false;
    await this.fetchMeta();
    const next = await this.tick();
    this.schedule(next);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  setInterval(ms) {
    this.intervalMs = ms;
  }

  schedule(delay = this.intervalMs) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      // tick() returns the delay to use for the *next* run, so an error backoff
      // survives instead of being overwritten by the normal interval.
      const next = await this.tick();
      this.schedule(next);
    }, delay);
  }

  async fetchMeta() {
    try {
      const res = await fetch(`${API}/draft/${this.draftId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const draft = await res.json();
      this.handlers.onMeta?.(draft);
    } catch (err) {
      // Non-fatal: picks still work without draft settings.
      console.warn('[SleeperRanks] draft meta unavailable:', err.message);
    }
  }

  /** Runs one poll. Returns the delay in ms before the next poll. */
  async tick() {
    if (this.stopped) return this.intervalMs;
    try {
      const headers = this.etag ? { 'If-None-Match': this.etag } : {};
      const res = await fetch(`${API}/draft/${this.draftId}/picks`, { headers });
      if (res.status === 304) {
        this.ok();
        return this.intervalMs;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.etag = res.headers.get('etag') || null;
      const picks = await res.json();
      this.ok();
      this.handlers.onPicks?.(Array.isArray(picks) ? picks : []);
      return this.intervalMs;
    } catch (err) {
      this.failures++;
      this.handlers.onStatus?.({
        state: this.failures >= 3 ? 'error' : 'stale',
        error: err.message,
      });
      return 10000; // back off while the API or the network is unhappy
    }
  }

  ok() {
    this.failures = 0;
    this.handlers.onStatus?.({ state: 'live' });
  }
}
