// Draft-clock proximity: how close are you to being on the clock?
// This drives the status dot at the top of the panel.

export const CLOCK_STATES = {
  onClock: { id: 'on-clock', label: 'You are on the clock' },
  soon: { id: 'soon', label: 'Coming up' },
  far: { id: 'far', label: 'Not close' },
  unknown: { id: 'unknown', label: 'Unknown' },
};

/** Picks away at which "soon" (yellow) stops and "far" (red) begins. */
export const SOON_MAX = 4;

/**
 * @param {number|null} picksAway  0 = on the clock now, null = unknown
 * @param {boolean} connected      false when no live pick data is arriving
 */
export function clockState(picksAway, connected = true) {
  if (!connected || picksAway === null || picksAway === undefined) return CLOCK_STATES.unknown;
  if (picksAway <= 0) return CLOCK_STATES.onClock;
  if (picksAway <= SOON_MAX) return CLOCK_STATES.soon;
  return CLOCK_STATES.far;
}

/**
 * Text for the dot's tooltip.
 * @param {boolean} known  whether the panel knows which picks are yours
 */
export function clockTooltip(picksAway, connected = true, known = true) {
  if (!connected) return 'No live draft data — the dot cannot tell you whose turn it is';
  if (!known) return 'Enter your Sleeper username so the board can tell you when it is your turn';
  if (picksAway === null || picksAway === undefined) return 'Waiting for the draft to start';
  if (picksAway <= 0) return 'You are on the clock';
  return `${picksAway} pick${picksAway === 1 ? '' : 's'} until your turn`;
}
