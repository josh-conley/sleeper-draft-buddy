# Sleeper Draft Buddy

Build your player rankings, seeded from live Sleeper ADP and dragged into the
order you actually believe. Then get a live, sortable, position-filterable draft
overlay that checks players off automatically as they're drafted — on **either**
Sleeper draft board.

Rank on the **My Rankings** page, or paste a plain list of names into the panel.
Both end up in the same place.

You don't need a spreadsheet. Draft Buddy infers position, team, bye week and
positional rank from the names alone.

## Install

**Sharing it with someone?** Run `npm run build` and send them
`dist/sleeper-draft-buddy-v<version>.zip`. It contains [`INSTALL.md`](INSTALL.md),
a step-by-step guide written for someone who has never side-loaded an extension.

**Running it from source:**

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → this folder
2. Open any Sleeper draft:
   - classic — `https://sleeper.com/draft/nfl/<id>`
   - beta — `https://sleeper.com/beta/draft/nfl/<id>`
3. Click ⚙, paste your names, **Load list**, and set **Your slot**

## Input: just names is enough

```
Ja'Marr Chase
Bijan Robinson
Jahmyr Gibbs
```

That's a complete input. **The order you list them in is your ranking.** Also accepted:

| You paste | What happens |
|---|---|
| `1. Ja'Marr Chase` | leading rank stripped and used as the rank |
| `12) Josh Allen` | same |
| a CSV with a `Player` header | mapped by header; a confirmation step appears |
| a CSV with no header | name column guessed by shape |

### What gets inferred

| Field | Source |
|---|---|
| Rank | row order in your list (or an inline/explicit rank) |
| Position | Sleeper's player database |
| Team | Sleeper's player database |
| Bye | derived from the NFL schedule — the one week a team has no game |
| Positional rank | computed: Nth player of that position, in your rank order |

**Any column you supply wins over the inferred value.** Reference data is fetched
once and cached for 24h (`Refresh player data` in settings forces it).

A name that can't be found stays in your list, coloured amber with a tooltip, so
a typo is visible rather than silently never matching a pick.

## The status dot

The dot at the top-left answers one question: **how close are you to picking?**

| Colour | Meaning |
|---|---|
| 🟢 green (pulsing) | you are on the clock |
| 🟡 yellow | 1–4 picks away |
| 🔴 red | 5+ picks away |
| ⚪ grey | no slot set, or no live draft data |

It needs **Your slot** set — there is a picker in the toolbar that highlights
itself in amber until you choose one. It deliberately goes grey when the feed
is down rather than showing a confident colour that would be a lie.

## Both draft boards

Sleeper runs two boards with no markup in common. Each has an **adapter** in
`src/lib/board.js`, and `detectAdapter()` picks whichever actually finds board
markup — the URL shape is never load-bearing.

| | classic | beta |
|---|---|---|
| Picked cell | `.cell.drafted` | `[class*="bg-dls-picked-"]` |
| Fields | `.pick` / `.player-name` / `.position` | text tokens in the cell |
| On the clock | `.cell.current-pick` | `[class*="bg-dls-alert-warning"]` |
| Name format | `J. Gibbs` (abbreviated) | `Jahmyr Gibbs` (full) |

The classic board's abbreviated first names can't match on full name, so
`names.js` falls through to surname + position + team. Both surname forms are
indexed, because `A. St. Brown` parses its surname as `St. Brown` while the
ranking row's final token is just `Brown`.

Text inside `<svg>` is ignored — badge icons carry an SVG `<title>` (`Rookie`)
that is invisible on screen but present in `textContent`.

### Ambiguous abbreviated names

The classic board abbreviates first names, and a surname + position + team is
not always unique. Two real collisions from a 443-player list:

| Board shows | Candidates |
|---|---|
| `J. Allen` QB BUF | Josh Allen, Kyle Allen |
| `B. Robinson` RB ATL | Bijan Robinson, Brian Robinson |

These resolve in three steps, in `buildIndex().match()`:

1. **First initial** — settles `J. Allen` (Josh) vs `K. Allen` (Kyle).
2. **Already claimed** — picks are matched in draft order carrying the set of
   rows already taken, so once Bijan is gone the next `B. Robinson` is Brian.
3. **Best rank still available** — the first of a tied group to be drafted is
   the better-ranked one. (Deliberately *not* "rank closest to this pick
   number", which would misread a Bijan who fell to the third round as Brian.)

Only a pick with zero candidates is reported as unmatched.

## Why the DOM and not just the API

Sleeper's public REST API **reports no picks for mock drafts**:
`/v1/draft/{id}/picks` stays `[]` and `status` stays `pre_draft` while the board
fills up, because live state travels over a WebSocket. So the board DOM is the
primary source and the REST API is the fallback. Whichever knows about more
picks drives the panel; the header shows which (`· board` / `· api`).

## Filters, sorting, value

Chips: `ALL / QB / RB / WR / TE / FLEX` (FLEX = RB+WR+TE). Defenses and kickers
are excluded — dropped at ingest, no chips, and a DEF/K coming off the board is
*not* counted as an unmatched pick. See `EXCLUDED_POSITIONS` in `src/lib/parse.js`.

Every column header sorts: click for ascending, again descending, a third time
to reset. Blanks always sort last.

Rank badges are coloured by `pick on the clock − your rank`: ≥+12 steal, +5…+11
value, −4…+4 fair, −5…−11 reach, ≤−12 big reach (`BANDS` in `src/lib/value.js`).

## Development

```
npm install          # jsdom, for the tests only — the extension has no deps
npm test             # board adapters + ambiguity + inference + render
npm run test:live    # hits the real Sleeper API and inference end to end
npm run icons        # regenerate icons/ (no image libraries needed)
npm run build        # clean, shareable dist/*.zip
npm run test:package # build, then validate what is actually in the zip
```

### Packaging

`npm run build` stages only `manifest.json`, `src/`, `icons/`, `INSTALL.md` and
`LICENSE` — tests, tooling and fixtures never ship — then zips it with a single
top-level folder so unzipping is tidy. `npm run test:package` then checks that
every file the manifest references is present, that relative imports resolve
inside the package, and that nothing developer-only leaked in.

`src/lib/` — `parse` (ingest), `enrich` (inference), `names` (matching),
`board` (both boards), `draft` (API + snake math), `clock` (the dot),
`value` (bands), `store`.

`src/sw.js` — the service worker, and the only part that talks to the desktop
app. It holds the WebSocket rather than the panel doing it: a content script's
network calls answer to sleeper.com's CSP, and socket activity is what keeps an
MV3 worker alive through a draft.

## Firefox

One codebase, two packages.

```sh
npm run build          # side-load zip
npm run build:store    # Chrome Web Store
npm run build:firefox  # AMO
```

`src/lib/ext.js` is the whole port. Chrome exposes `chrome`; Firefox exposes
both, but only `browser` returns promises — reach for `chrome` there and every
`await` resolves to `undefined`, so a list comes back empty rather than
erroring. Everything goes through `api` from that module, and
`test/ext.test.mjs` fails the build if any file reaches past it.

The two classic scripts (`content.js`, `popup.js`) cannot import, so they repeat
the one line inline.

The Firefox package gets `browser_specific_settings` stamped in at build time
rather than committed — Chrome warns about the key, and neither store's package
should carry the other's metadata. It declares
`data_collection_permissions: { required: ['none'] }`, which AMO requires and
which is simply true here.

`npx web-ext lint` on the built folder reports **0 errors**. The one remaining
warning is `UNSAFE_VAR_ASSIGNMENT` on `content.js` — the dynamic
`import(runtime.getURL('src/main.js'))` that loads real ES modules out of a
classic content script. Neither browser supports module content scripts in MV3,
the argument is an extension URL and not user input, and there is no way to
write this loader without it. Worth mentioning in the AMO review notes.

**Untested in a real Firefox.** The jsdom suite proves the namespace swap; the
things it cannot see are how Firefox's optional-by-default host permissions
behave on first run, and the panel inside its shadow root.

## My Rankings

`src/rankings/` is a full-tab extension page — the board where your order gets
made, outside of any draft. Open it from the popup, or from the panel's ⚙.

- **Seeded from live Sleeper ADP — Sleeper's own.** `/projections/nfl/{season}`
  carries the ADP fields Sleeper's draft board itself displays, `adp_half_ppr`
  among them, keyed by the same player ids used everywhere else here. So the
  ADP column matches what you see on the board by construction rather than by
  resemblance, and it arrives in one request with no id translation step.
  Read the header of `src/lib/adp.js` before touching it: the endpoint is
  undocumented, and the client is written so that a failure costs freshness and
  nothing else.
- **Drag to reorder.** Array order is the ranking; a drop rewrites
  `chrome.storage` immediately and renumbers `myRank`.
- **Sort by ADP** to see the market's order. That is a view: your saved order is
  untouched, and dragging turns off while it is on so you cannot reorder a list
  you are not really looking at.
- **Update ADP** on the button, and automatically when the page opens with a
  cached board more than 12 hours old.
- **Import** a .txt or .csv, **Export** your order as newline-separated names.

An update never disturbs what you ranked: a player already on the board keeps his
slot and takes the new ADP, one who has left the feed stays put, and a newcomer
lands at the bottom. Appended rows get fresh ids — reusing one would quietly move
a mid-draft "drafted" mark onto another player.

**Everything writes rows through `buildRows`**, never around it. That is what
assigns the `id` every lookup in `names.js` is keyed by; rows made by hand index
to `undefined` and silently match no picks at all. `test/rows.test.mjs` holds
that line.

