// Value banding: how good a deal is this player at the pick currently on the clock?

// Ordered most-positive first; first band whose `min` is met wins.
export const BANDS = [
  { id: 'steal', label: 'Steal', min: 12 },
  { id: 'value', label: 'Value', min: 5 },
  { id: 'fair', label: 'Fair', min: -4 },
  { id: 'reach', label: 'Reach', min: -11 },
  { id: 'big-reach', label: 'Big reach', min: -Infinity },
];

/**
 * delta = currentPick - myRank.
 * Positive means the player is still on the board later than his rank says he
 * should be, i.e. value. Negative means taking him here is a reach.
 */
export function delta(myRank, currentPick) {
  if (myRank == null || !Number.isFinite(myRank)) return null;
  if (!Number.isFinite(currentPick)) return null;
  return currentPick - myRank;
}

export function bandFor(myRank, currentPick) {
  const d = delta(myRank, currentPick);
  if (d == null) return null;
  return BANDS.find((b) => d >= b.min) || BANDS[BANDS.length - 1];
}
