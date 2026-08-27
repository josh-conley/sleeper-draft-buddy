# Sleeper Draft Buddy — Install

A Chrome extension that lets you rank players, then puts that ranking on top of
the Sleeper draft board and crosses players off automatically as they get
drafted.

> Installing from the Chrome Web Store? None of this applies — click Add to
> Chrome and skip to "Using it". These steps are for a zip sent to you directly.

Takes about two minutes. You only do this once.

---

## 1. Unzip

Unzip the file you were sent. You'll get a folder called something like
`sleeper-draft-buddy-v1.1.0`.

**Put it somewhere permanent** — Documents is fine. Chrome loads it from wherever
you leave it, so if you delete or move the folder later, the extension stops
working. Don't leave it in Downloads.

## 2. Load it into Chrome

1. Open Chrome and go to **`chrome://extensions`**
   (type it in the address bar — it won't come up in a search)
2. Turn on **Developer mode**, top-right corner
3. Click **Load unpacked**, top-left
4. Select the `sleeper-draft-buddy-v1.1.0` folder — the one with
   `manifest.json` inside it — and click Select

You should see "Sleeper Draft Buddy" appear in the list.

> **"Manifest file is missing or unreadable"** means you picked the wrong folder.
> Go one level in (or out) until you're pointing at the folder that directly
> contains `manifest.json`.

Chrome will warn you about developer-mode extensions each time you restart. That
is normal for an extension installed this way rather than from the Web Store —
you can dismiss it.

## 3. Open your draft

Go to your draft on **sleeper.com**. Either board works:

- `sleeper.com/draft/nfl/…`
- `sleeper.com/beta/draft/nfl/…`

A dark panel appears on top of the board. Drag it by its header, resize it from
the bottom-right corner, collapse it with the little arrow.

## 4. Paste your players

Click the **⚙** on the panel, then paste your list. **One name per line is all
you need:**

```
Ja'Marr Chase
Bijan Robinson
Jahmyr Gibbs
```

**The order you list them in is your ranking.** Position, team, bye week and
positional rank are all filled in for you.

Click **Load list**. That's it — you don't need a spreadsheet.

<details>
<summary>Other formats it accepts</summary>

- `1. Ja'Marr Chase` — the number is used as the rank
- A CSV with a `Player` header, plus any of `Rank`, `Pos`, `Team`, `Bye`
- Anything you supply yourself overrides what would have been filled in

Defenses and kickers are ignored on purpose.
</details>

## 5. Set your draft slot

In the panel's toolbar there's a **Slot** dropdown, highlighted in orange until
you set it. Pick the position you're drafting from (1 = first pick).

This turns on the dot at the top-left of the panel:

| | |
|---|---|
| 🟢 **green, pulsing** | you're on the clock |
| 🟡 **yellow** | 1–4 picks away |
| 🔴 **red** | 5+ picks away |
| ⚪ **grey** | slot not set, or no draft data |

---

## Using it

Players disappear from your list the moment they're drafted. Nothing to click.

- **Filter** by QB / RB / WR / TE / FLEX
- **Sort** any column — click once for ascending, again for descending, a third
  time to go back to your rank order
- **Rank colours** show value at the current pick: green means he's lasted longer
  than your ranking says he should, red means taking him now is a reach
- **`show drafted`** brings the crossed-off players back into view

### If a name looks wrong

A name shown in **orange** wasn't found in Sleeper's player list — usually a
typo or a nickname. Fix it in your list and paste again.

A **⚠ unmatched picks** badge means someone was drafted who couldn't be matched
to your list. Click it to see who. Usually that just means they weren't in your
list at all, which is fine.

## Privacy

Everything stays in your browser. Your list is saved locally via Chrome's
extension storage and is never uploaded anywhere. The only network requests the
extension makes are to Sleeper's own public API, for the player list, bye weeks,
and draft picks.

## Updating

To install a newer version: unzip it over the old folder (or replace it), then
go to `chrome://extensions` and click the **↻ reload** icon on the Draft Buddy
card. Your saved player list is kept.
