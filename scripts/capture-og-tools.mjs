// Builds public/og-tools.png: the link-preview image for the Kynda Learning
// Tools suite (tools.kyndalearning.co.uk/ and every page outside
// /chordmoves; see src/app/siteMeta.js). Same layout as Chord Moves'
// og-image.png. The phone screens are real app screens, captured from a
// fresh build, not mock-ups -- re-run this when the UI they show changes:
//
//   npm run build && node scripts/capture-og-tools.mjs
//
// Set CHROMIUM_PATH to use a specific Chromium build.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { ROOT, settle, startPreview } from './lib/demoFlow.mjs'

const PORT = 4183
const executablePath = process.env.CHROMIUM_PATH || undefined
const OUT = `${ROOT}/public/og-tools.png`

const preview = await startPreview(PORT)
const browser = await chromium.launch({ executablePath })
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(() => {
    try { localStorage.setItem('chordMovesThemePreference', 'light') } catch {}
  })
  const page = await ctx.newPage()
  const shot = async (path, before = async () => {}) => {
    await page.goto(preview.base + path, { waitUntil: 'networkidle' })
    await settle(page, 800)
    await before()
    return (await page.screenshot({ animations: 'disabled', caret: 'hide' })).toString('base64')
  }
  const directory = await shot('/')
  // A rolled chord, not blank dice.
  const dice = await shot('/chord-dice', async () => {
    await page.getByRole('button', { name: 'Roll', exact: true }).click()
    await settle(page, 2500)
  })
  await ctx.close()

  const logo = readFileSync(`${ROOT}/public/kynda-logo-white.png`).toString('base64')
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await card.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: Poppins, sans-serif; color: #fff;
    background: radial-gradient(120% 140% at 85% 10%, #137a77 0%, #0d4a49 45%, #0a2f30 100%); position: relative; }
  .lines { position: absolute; left: 0; right: 0; top: 470px; }
  .lines div { height: 1px; background: rgba(255,255,255,.08); margin-bottom: 22px; }
  .left { position: absolute; left: 72px; top: 62px; width: 520px; }
  .logo { height: 54px; }
  .eyebrow { margin-top: 64px; color: #7fd6d2; font-weight: 600; font-size: 17px; letter-spacing: .16em; }
  h1 { margin-top: 12px; font-size: 66px; line-height: 1.02; font-weight: 800; letter-spacing: -.02em; }
  h1 em { font-style: normal; color: #f5b82e; }
  p { margin-top: 26px; font-size: 21px; line-height: 1.5; color: rgba(255,255,255,.86); }
  .foot { position: absolute; left: 72px; bottom: 50px; font-size: 21px; font-weight: 600; }
  .foot span { color: rgba(255,255,255,.65); font-weight: 500; }
  .phone { position: absolute; width: 286px; height: 520px; border-radius: 30px; overflow: hidden; background: #fff;
    box-shadow: 0 30px 60px rgba(0,0,0,.35), 0 0 0 10px rgba(255,255,255,.06); }
  .phone img { width: 100%; display: block; }
  .a { left: 630px; top: 72px; transform: rotate(-4deg); }
  .b { left: 860px; top: 96px; transform: rotate(3deg); }
</style></head><body>
  <div class="lines"><div></div><div></div><div></div></div>
  <div class="left">
    <img class="logo" src="data:image/png;base64,${logo}" alt="">
    <div class="eyebrow">KYNDA LEARNING TOOLS</div>
    <h1>Make more <em>sense</em> of music.</h1>
    <p>Small tools for writing, practising and learning: Chord Moves, Rhythm Dice, Chord Dice and more.</p>
  </div>
  <div class="phone a"><img src="data:image/png;base64,${directory}" alt=""></div>
  <div class="phone b"><img src="data:image/png;base64,${dice}" alt=""></div>
  <div class="foot">tools.kyndalearning.co.uk <span>· free to try</span></div>
</body></html>`, { waitUntil: 'networkidle' })
  await card.evaluate(() => document.fonts.ready)
  await card.screenshot({ path: OUT })
  console.log(`Wrote ${OUT}`)
} finally {
  await browser.close()
  preview.stop()
}
