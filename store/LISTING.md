# Chrome Web Store submission — copy/paste sheet

Everything below is written to be pasted straight into the Developer Dashboard.
Fields are in the order the dashboard asks for them.

---

## Store listing tab

**Item name** (45 char max)
```
Sleeper Draft Buddy
```

**Summary / short description** (132 char max — currently 122)
```
Paste a list of player names and get a live draft overlay that hides players as they are drafted, on either Sleeper board.
```

**Category**
```
Productivity  →  Workflow & Planning
```
(Sports isn't a Chrome Web Store category. Productivity is the honest fit — it's
a tool layered on an existing web app.)

**Language**
```
English (United States)
```

**Detailed description**
```
Draft Buddy puts your own player rankings on top of the Sleeper draft board and
crosses players off automatically as they get drafted — so you're never scrolling
a spreadsheet while the clock runs.

JUST PASTE NAMES

One player per line is a complete input:

    Ja'Marr Chase
    Bijan Robinson
    Jahmyr Gibbs

The order you list them in is your ranking. Position, NFL team, bye week and
positional rank are all filled in for you from Sleeper's public player data and
the NFL schedule. If you'd rather paste a full CSV with your own columns, you
can — anything you supply overrides what would have been looked up.

AUTOMATIC, NOT MANUAL

Players disappear from your list the moment they're picked. There is nothing to
click and nothing to keep in sync. It reads the draft board itself, so it works
in mock drafts too — not just live league drafts.

WORKS ON BOTH DRAFT BOARDS

Sleeper's classic board and the newer beta board have nothing in common under
the hood. Draft Buddy handles both and switches automatically.

KNOW WHEN YOU'RE UP

Set your draft slot and the dot at the top of the panel tells you at a glance:
green and pulsing when you're on the clock, yellow when you're 1-4 picks away,
red beyond that. The header shows the exact countdown.

SEE VALUE AT A GLANCE

Each player's rank is colour-coded against the pick currently on the clock.
Green means he's lasted longer than your ranking says he should — a value. Red
means taking him now is a reach.

ALSO

• Filter by QB, RB, WR, TE or FLEX
• Sort any column — click for ascending, again for descending, again to reset
• Drag, resize and collapse the panel; it remembers where you put it
• Names it can't find are flagged in orange so typos are visible
• Defenses and kickers are left out on purpose

PRIVATE BY DESIGN

No account, no analytics, no tracking, no server. Your list is saved locally in
your own browser and is never uploaded. The only network requests go to
Sleeper's own public API, for the player list, bye weeks and draft picks.

Not affiliated with or endorsed by Sleeper.
```

---

## Graphics

| Asset | Size | File |
|---|---|---|
| Store icon | 128×128 | `icons/icon128.png` ✅ done |
| Screenshot 1 | 1280×800 | `store/screenshots/1-overlay.png` ✅ done |
| Screenshot 2 | 1280×800 | `store/screenshots/2-paste.png` (optional) |
| Screenshot 3 | 1280×800 | `store/screenshots/3-filter.png` (optional) |

Only screenshot 1 is mandatory, and it is done — **every required asset is now
in place**. See [SCREENSHOTS.md](SCREENSHOTS.md) to add the optional two.
| Small promo tile | 440×280 | `store/promo/small-440x280.png` ✅ done |

Marquee tile (1400×560) and a YouTube video are optional — skip both.

---

## Privacy tab

**Single purpose**
```
Draft Buddy displays a fantasy football player list supplied by the user as an
overlay on the Sleeper draft board, and removes players from that list as they
are drafted.
```

**Permission justifications**

`storage`
```
Saves the player list the user pastes in, along with their panel preferences
(position, size, active filter, sort column, draft slot) and any players they
manually crossed off, so these persist across page loads and browser restarts.
All of it stays on the user's device; none of it is transmitted.
```

Host permission — `https://sleeper.com/*`
```
The extension's entire function is an overlay on the Sleeper draft board. The
content script runs on sleeper.com draft pages to render the panel and to read
which players have already been drafted directly from the board, which is the
only source that works for mock drafts. This host permission also lets the
toolbar popup tell the user whether the current tab is a draft page. The
extension runs on no other site and reads nothing else from the page.
```

Host permission — `https://api.sleeper.app/*`
```
Reads four public, unauthenticated, read-only endpoints on Sleeper's own API:
the NFL player list (to infer position and team from a pasted name), the NFL
schedule (to derive bye weeks), draft metadata (team count and draft type), and
draft picks (a fallback source for which players are gone). No credentials and
no user data are sent; requests contain only the draft ID already present in the
page URL.
```

**Are you using remote code?**
```
No, I am not using remote code
```
(All code ships inside the package. The extension fetches JSON data only — never
scripts — and evaluates nothing it downloads.)

**Data usage — check NOTHING.** The extension collects none of the listed
categories: no personally identifiable information, health, financial,
authentication, personal communications, location, web history, or user
activity. The player list is user-authored content held locally on the device
and never transmitted, so no collection occurs.

**Certifications — tick all three:**
- I do not sell or transfer user data to third parties, outside of approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**
```
<paste the hosted URL of PRIVACY.md here — see store/HOSTING.md>
```
This is required even though the extension stores everything locally: Google
requires disclosure "even when data is processed or stored locally on a user's
device and is not transmitted to external servers."

---

## Distribution tab

**Visibility**
```
Unlisted
```
No listing is created and it won't appear in search or category browsing, but
anyone with the Chrome Web Store URL can install it. That URL is what you send
to friends.

**Regions:** all. **Pricing:** free.

---

## What to upload

`dist/sleeper-draft-buddy-v1.0.0.zip` from `npm run build`.

Note: the zip contains a single top-level folder, which is right for humans
loading it unpacked but the dashboard may want `manifest.json` at the archive
root. If upload is rejected for that reason, run:

```
npm run build:store
```

which produces `dist/sleeper-draft-buddy-v1.0.0-store.zip` with the files at the
root and the human-facing INSTALL.md left out.

---

## Before you submit

- [ ] Host `PRIVACY.md` and paste its URL into the Privacy tab
- [ ] Load `dist/sleeper-draft-buddy-v1.0.0/` unpacked once and confirm the
      popup and icons look right — they're the newest parts
- [ ] Set an email on the account and verify it
- [ ] Set visibility to **Unlisted** before publishing, not after
