// Which picks are actually yours?
//
// A draft slot is not the same thing as a set of picks. Snake order says slot 2
// owns 1.02, 2.11, 3.02 … but a trade moves an individual pick to another
// roster, so "am I on the clock?" cannot be answered by slot arithmetic alone.
// This module turns a slot plus the draft's traded picks into the explicit set
// of overall pick numbers you own, and answers the two questions the panel
// asks of it: are you up, and how long until you are.

import { slotForPick } from './draft.js';

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
