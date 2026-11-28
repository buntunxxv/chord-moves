# M0 — actual-device capture list (founder)

DISPOSABLE PROTOTYPE. Never merged. Mirrors the list in the Notion Implementation Plan (M0 section).

Preview (Vercel Authentication; sign in with your Vercel account):
`https://chord-moves-f2nkt23r6-kyndaltd.vercel.app/m0-notation`
Commit `2ac319a`, bundle `index-Cv1GMrFy.js` (the exact build measured).

Use the device's own screenshot (side button + volume up). Do not zoom: the page locks pinch zoom, as the tools do, so what you see is what a student sees. Each screenshot is at actual device size.

| # | Device | Orientation | Theme | URL suffix | Look for |
|---|---|---|---|---|---|
| 1 | iPhone (note model) | Portrait | Light | `?fixture=F6&theme=light` | Ledger lines above E6 and below A3 countable at arm's length |
| 2 | iPhone | Portrait | Dark | `?fixture=F6&theme=dark` | Same, dark |
| 3 | iPhone | Portrait | Light | `?fixture=F10&theme=light` | Chord symbols readable, Am7 between the dotted minim and G |
| 4 | iPhone | Portrait | Dark | `?fixture=F10&theme=dark` | Same, dark |
| 5 | iPhone | Portrait | Light | `?fixture=F11&theme=light` | Bar 4 accidentals (G♭, G♮, B♭), semiquavers in bar 2, 2+ bars per line |
| 6 | iPhone | Portrait | Dark | `?fixture=F11&theme=dark` | Same, dark |
| 7 | iPad Air 2 | Portrait | Light | `?fixture=F11&theme=light` | Whole score legible; bars per line |
| 8 | iPad Air 2 | Landscape | Light | `?fixture=F11&theme=light` | Same, landscape |

For each, one word: **legible / borderline / not legible**, and the iPhone model.

Other device runs still open (not screenshots for legibility):

| # | Threshold | What to do |
|---|---|---|
| 9 | T2 (iPad Air 2, Safari 15) | Open `?fixture=F11`, tap **Time it** three times, screenshot the last result (limits: first render ≤ 150 ms, after edit ≤ 100 ms) |
| 10 | T5 (iPad Air 2, Safari 15) | Step through F1–F12 in the Fixture menu; compare with `m0-evidence/t1-visual-review/` |
| 11 | T5 (current iOS Safari, iPhone) | Same as 10 |
| 12 | T5 (Firefox, desktop) | Same as 10 |

Emulated reference images (Playwright device emulation in desktop Chromium, stamped EMULATED, **not device screenshots**): `m0-evidence/emulated/`.
