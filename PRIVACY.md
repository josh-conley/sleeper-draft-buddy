# Privacy Policy — Sleeper Draft Buddy

**Last updated: 26 August 2026**

## Summary

Sleeper Draft Buddy does not collect, transmit, sell, or share any personal
information. There is no account, no analytics, no tracking, and no server
operated by this extension. Everything it stores stays in your own browser.

## What the extension stores

Stored locally on your device using Chrome's extension storage
(`chrome.storage.local`):

- **Your player rankings** — whether you built them on the My Rankings page,
  pasted them into the panel, or imported them from a file — along with the
  position, team, bye week and positional rank looked up for each name.
- **A copy of the most recent Sleeper ADP board**, cached so the page has
  something to show before it next refreshes.
- **Your preferences** — panel position and size, whether it's collapsed, the
  active position filter, the current sort column, your search text, the polling
  interval, and your draft slot.
- **Any players you manually crossed off**, stored per draft.

This data never leaves your browser. It is not uploaded anywhere, and the
developer has no access to it. Uninstalling the extension removes it. You can
also clear the saved list at any time with **Clear saved list** in the
extension's settings.

## Network requests

The extension makes read-only requests to one place, and sends nothing about
you to it.

**Sleeper's own public API** at `api.sleeper.app`:

| Endpoint | Why |
|---|---|
| `/v1/players/nfl` | Look up position and team for the names in your list. Cached locally for 24 hours. |
| `/schedule/nfl/regular/{season}` | Derive each team's bye week. |
| `/v1/draft/{id}` | Read the draft's team count and type, for the pick countdown. |
| `/v1/draft/{id}/picks` | A fallback source for which players have been drafted. |
| `/v1/draft/{id}/traded_picks` | Which picks changed hands, so the countdown knows which are yours. |
| `/v1/user/{id}` | Your own display name, used to find your column on the board. |
| `/projections/nfl/{season}` | Public half-PPR ADP figures for the My Rankings page. |

These are public, unauthenticated endpoints. The requests contain only the draft
ID already visible in your address bar.

The ADP request is made when you open My Rankings with a cached board more than
twelve hours old, or when you press **Update ADP**. It asks only for public
football data — **your rankings are never uploaded, and nothing identifying you
is sent**.

Your Sleeper user id is read from sleeper.com's own storage in your browser, so
that the panel can work out which draft slot is yours without asking. It is used
to look up your display name and to match you against the draft's published
draft order; it is never stored by this extension and never sent anywhere except
back to Sleeper's own API.

## Page access

The extension runs only on `sleeper.com`, plus its own My Rankings page. On a
draft page it reads the draft board to see which players have been picked, and
it draws its panel on top of the page. It does not read, collect, or transmit anything else from the page,
and it runs on no other website.

## Permissions

| Permission | Used for |
|---|---|
| `storage` | Saving your list and preferences locally, as described above. |
| `sleeper.com` | Drawing the panel and reading drafted players from the board. Also lets the toolbar popup tell whether you're on a draft page. |
| `api.sleeper.app` | The public API requests listed above. |

## What the extension does not do

- No analytics, telemetry, crash reporting, or usage tracking
- No advertising, and no data sold or shared with anyone
- No remote code — all code is contained in the published package
- No access to your browsing history, other tabs, cookies, or downloads
- No use of your data for creditworthiness or lending purposes

## Children's privacy

The extension collects no data from anyone, including children under 13.

## Changes

Any change to this policy will be published at this URL with an updated date.

## Contact

Questions about this policy: open an issue on this repository, or contact the
developer at the address shown on the Chrome Web Store listing.
