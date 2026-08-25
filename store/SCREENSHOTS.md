# Screenshots

**Status: 1 of 1 required screenshots done.** `1-overlay.png` is in place, so the
listing can be submitted. Two more are optional but recommended.

| File | Shows | Status |
|---|---|---|
| `1-overlay.png` | The panel over a partly-drafted board | ✅ done |
| `2-paste.png` | The ⚙ settings view with names in the textarea | optional |
| `3-filter.png` | The list with a position filter active | optional |

## Taking more

Two things decide whether a shot is usable:

**Get a few rounds in.** Around round 3–5 the board is full of colour, the
drafted count is meaningful, and the rank badges show a real green/amber/red
spread. In a *completed* draft every remaining player grades out as a steal and
the whole column goes green, so the value colouring doesn't read at all.

**Mind the aspect ratio.** The store wants 1280×800 (1.60). A Mac screenshot of
a wide window comes out around 1.9–2.4, so something has to be cropped away.
Narrowing the Chrome window to roughly 16:10 before capturing means the board
and the panel both land in frame. Otherwise the crop has to sacrifice one.

Capture with **⌘⇧4** and drag a region — it doesn't need to be exact.

## Cropping

```
npm run shot -- ~/Desktop/Shot.png 2-paste right
```

Arguments: input file, output name, and an anchor (`left` / `center` / `right`,
default `right`). It takes the largest 1.6 region at the source's full height,
anchors it, and resizes to exactly 1280×800.

**Anchor `right` is usually correct** — it keeps the Draft Buddy panel whole. A
panel clipped mid-column reads as a broken screenshot, whereas losing a couple
of board columns on the left reads as framing. Use `left` if the subject is
Sleeper's own player list instead.
