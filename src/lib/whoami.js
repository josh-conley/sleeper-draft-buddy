// Who is looking at this draft?
//
// Knowing the logged-in Sleeper account is what lets the panel find your team
// on the draft board without asking you to type anything.
//
// A content script shares the page's origin, so sleeper.com's own localStorage
// is readable from here. Sleeper keeps the signed-in id under a plain "user_id"
// key, JSON-encoded — so the stored value includes its quotes and has to be
// parsed, not used raw (an unparsed id 404s the user endpoint into a null).
// The shape of that storage is not a contract, so a miss falls back to scanning
// every stored value for something user-shaped. Finding nothing is normal —
// logged out, or Sleeper moved its session — and the panel says so rather than
// guessing at which team is yours.

const API = 'https://api.sleeper.app/v1';
const ID_KEYS = ['user_id', 'userId'];

/**
 * localStorage values are JSON, so "123" arrives with its quotes attached.
 *
 * Deliberately unquoted by hand rather than by JSON.parse: a Sleeper user id is
 * a 17-digit number, well past Number.MAX_SAFE_INTEGER, so parsing an unquoted
 * one would round it to a neighbouring id that belongs to somebody else.
 */
function decode(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v) return null;
  const quoted = v.match(/^"(.*)"$/);
  return quoted ? quoted[1] : v;
}

/** A Sleeper user id is a long digit string; anything else is not one. */
const looksLikeId = (v) => typeof v === 'string' && /^\d{6,}$/.test(v);

// Read out of the raw text rather than a parsed object, for the same reason
// decode() avoids JSON.parse: the id is too long to survive being a number.
const NESTED_ID_RE = /"user_?[Ii]d"\s*:\s*"?(\d{6,})"?/;

/** The signed-in Sleeper user id, or null. */
export function readSleeperUserId(win = globalThis) {
  for (const store of [win.localStorage, win.sessionStorage]) {
    if (!store) continue;
    let keys = [];
    try { keys = Object.keys(store); } catch { continue; } // storage can be blocked

    for (const k of ID_KEYS) {
      if (!keys.includes(k)) continue;
      let v;
      try { v = decode(store.getItem(k)); } catch { continue; }
      if (looksLikeId(v)) return v;
    }
    // Nothing under the expected key: search the rest before giving up.
    for (const k of keys) {
      let raw;
      try { raw = store.getItem(k); } catch { continue; }
      if (!raw || (raw[0] !== '{' && raw[0] !== '[')) continue;
      const m = raw.match(NESTED_ID_RE);
      if (m) return m[1];
    }
  }
  return null;
}

/**
 * Display names for that id — display_name and username, since the board's
 * header row may carry either. Matched case-insensitively against it.
 * @returns {Promise<string[]>}
 */
export async function fetchUserNames(userId, fetchFn = fetch) {
  if (!looksLikeId(String(userId ?? ''))) return [];
  try {
    const res = await fetchFn(`${API}/user/${userId}`);
    if (!res.ok) return [];
    const user = await res.json();
    if (!user) return [];
    return [...new Set([user.display_name, user.username].filter((n) => typeof n === 'string' && n.trim()))];
  } catch {
    return [];
  }
}
