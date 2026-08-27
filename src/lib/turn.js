// Which picks are actually yours?
//
// A draft slot is not the same thing as a set of picks. Snake order says slot 2
// owns 1.02, 2.11, 3.02 … but a trade moves an individual pick to another
// roster, so "am I on the clock?" cannot be answered by slot arithmetic alone.
// This module turns a slot plus the draft's traded picks into the explicit set
// of overall pick numbers you own, and answers the two questions the panel
// asks of it: are you up, and how long until you are.

import { slotForPick } from './draft.js';
import { labelToPickNo } from './board.js';

/** Every overall pick number belonging to a column, ignoring trades. */
export function slotPickNos(slot, teams, rounds, type = 'snake') {
  if (!slot || !teams || !rounds) return [];
  const out = [];
  for (let p = 1; p <= teams * rounds; p++) {
    if (slotForPick(p, teams, type) === slot) out.push(p);
  }
  return out;
}

/** The column a roster drafts from — the inverse of slot_to_roster_id. */
export function slotOfRoster(slotToRoster, rosterId) {
  if (!slotToRoster || rosterId == null) return null;
  for (const [slot, rid] of Object.entries(slotToRoster)) {
    if (String(rid) === String(rosterId)) return Number(slot);
  }
  return null;
}

/**
 * The picks you own once trades are applied.
 *
 * A traded_picks entry names the pick by its ORIGINAL owner: `roster_id` is
 * whose column it sits in, `owner_id` is who drafts it now. So your set is your
 * column's picks, minus the ones you sold, plus the ones you bought — and a
 * bought pick sits in someone else's column, which is exactly why the board's
 * geometry cannot be trusted for this on its own.
 *
 * @returns {Set<number>} overall pick numbers
 */
export function ownedPickNos({ slot, teams, rounds, type = 'snake', traded = [], slotToRoster = null, rosterId = null }) {
  const mine = new Set(slotPickNos(slot, teams, rounds, type));
  if (!traded?.length || !teams) return mine;

  // Trades are expressed in roster ids. Without a roster identity for "me"
  // there is nothing to compare against, so the untraded set stands.
  const myRoster = rosterId ?? (slotToRoster ? slotToRoster[slot] ?? slotToRoster[String(slot)] : null);
  if (myRoster == null) return mine;

  for (const t of traded) {
    const round = Number(t?.round);
    if (!Number.isFinite(round) || round < 1 || round > rounds) continue;
    const fromSlot = slotOfRoster(slotToRoster, t.roster_id) ?? (String(t.roster_id) === String(myRoster) ? slot : null);
    if (!fromSlot) continue;

    // The overall pick number for that column in that round.
    const pickNo = slotPickNos(fromSlot, teams, rounds, type).find((p) => Math.ceil(p / teams) === round);
    if (!pickNo) continue;

    if (String(t.owner_id) === String(myRoster)) mine.add(pickNo);
    else if (String(t.roster_id) === String(myRoster)) mine.delete(pickNo);
  }
  return mine;
}

/**
 * Picks until your next turn, from an explicit set of owned picks.
 * 0 means you are on the clock right now; null means you have no picks left.
 */
export function picksUntilOwnedTurn(pickNo, ownedPicks) {
  if (!Number.isFinite(pickNo) || !ownedPicks?.size) return null;
  let best = null;
  for (const p of ownedPicks) {
    if (p < pickNo) continue;
    if (best === null || p < best) best = p;
  }
  return best === null ? null : best - pickNo;
}

/** Are you the one on the clock at this pick? */
export function isOnClock(pickNo, ownedPicks) {
  return !!(Number.isFinite(pickNo) && ownedPicks?.has(pickNo));
}

/**
 * Your picks, read off the board by username.
 *
 * This is the primary route, and the only one that needs nothing from Sleeper's
 * API: the board states who owns every pick, trades included, so a slot and a
 * traded-picks feed are not required to answer the question. Ownership is a
 * name match, never a column — a pick you bought sits in the seller's column
 * and still comes back as yours.
 *
 * @param {Map<string,string>} owners    pick label -> username
 * @param {string} username              yours
 * @returns {Set<number>} overall pick numbers
 */
export function ownedFromBoard(owners, username, teams) {
  const mine = new Set();
  const me = namesOf(username);
  if (!owners?.size || !me.size || !teams) return mine;
  for (const [label, owner] of owners) {
    if (!me.has(String(owner).trim().toLowerCase())) continue;
    const pickNo = labelToPickNo(label, teams);
    if (Number.isFinite(pickNo)) mine.add(pickNo);
  }
  return mine;
}

/**
 * An account answers to more than one name: Sleeper's header row shows the
 * display name, while the account also has a username, and they differ in case
 * if not entirely. Either is accepted.
 */
function namesOf(username) {
  const list = Array.isArray(username) ? username : [username];
  return new Set(list.filter(Boolean).map((n) => String(n).trim().toLowerCase()).filter(Boolean));
}

/** Is this account one of the teams on the board? */
export function usernameOnBoard(headers, username) {
  const me = namesOf(username);
  if (!headers?.size || !me.size) return false;
  return [...headers.values()].some((n) => me.has(String(n).trim().toLowerCase()));
}

/**
 * Fold what the board shows over a set of picks derived from elsewhere.
 *
 * The two sources answer different halves of the question. Sleeper's
 * traded_picks feed covers every round, drafted or not, which is what a
 * countdown needs — it looks forward, at cells that have not happened yet, and
 * a badge that only appears once a pick is made would be no help there. The
 * board, meanwhile, is the only source that works on a mock and is the truth
 * for anything actually rendered.
 *
 * So the feed lays the base and the board overrides it: a rendered cell badged
 * to you is yours whatever the feed said, and one badged to somebody else is
 * not yours even if it sits in your column.
 *
 * @param {Set<number>} base    picks from the traded-picks feed, or snake order
 * @param {Map<string,string>} owners  pick label -> username, from the board
 */
export function applyBoardOwnership(base, owners, username, teams) {
  const mine = new Set(base || []);
  const me = namesOf(username);
  if (!owners?.size || !me.size || !teams) return mine;
  for (const [label, owner] of owners) {
    const pickNo = labelToPickNo(label, teams);
    if (!Number.isFinite(pickNo)) continue;
    if (me.has(String(owner).trim().toLowerCase())) mine.add(pickNo);
    else mine.delete(pickNo);
  }
  return mine;
}

/** The column whose header names this account, if the board says so. */
export function slotOfUsername(headers, username) {
  const me = namesOf(username);
  if (!headers?.size || !me.size) return null;
  for (const [slot, name] of headers) {
    if (me.has(String(name).trim().toLowerCase())) return Number(slot);
  }
  return null;
}
