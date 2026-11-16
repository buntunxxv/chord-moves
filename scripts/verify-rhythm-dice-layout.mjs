#!/usr/bin/env node
// Rhythm Dice is one screen: nothing on it may scroll or be cut off.
// For each device size below, the page is checked on all three stage views
// (Play, Result, Keep) with the heaviest content it can show: a bar of four
// semiquaver dice (16 hits) scored with no taps, and a long kept list.
//   - the page and the shell's main area never scroll, in either direction
//   - the tray, stage panels, result and kept list hold all their content
//   - the dice stay big enough to read and tap
// Needs a build: npm run build && node scripts/verify-rhythm-dice-layout.mjs
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 4181
const BASE = `http://localhost:${PORT}`
const OUT = 'rhythm-dice-layout-output'
const executablePath = process.env.CHROMIUM_PATH || undefined

// Visible page areas, i.e. after the browser's own toolbars.
const VIEWPORTS = [
  ['iPad Pro 12.9 portrait', 1024, 1292],
  ['iPad Pro 12.9 landscape', 1366, 950],
  ['iPad 10.9 portrait', 820, 1106],
  ['iPad 10.9 landscape', 1180, 746],
  ['iPad mini portrait', 744, 1059],
  ['iPad mini landscape', 1133, 670],
  ['iPhone portrait (Safari)', 390, 664],
]

const BUSY_BAR = ['L2-1', 'L2-1', 'L2-1', 'L2-1'] // four semiquaver dice: 16 hits
const KEPT = Array.from({ length: 9 }, (_, i) => ({
  id: String(1700000000000 + i),
  keptAt: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
  faceIds: i === 0 ? BUSY_BAR : ['L1-1', 'L2-2', 'L1-4', 'L2-1'],
  bpm: 160,
  levelIds: ['L1', 'L2'],
  reason: i % 2 ? 'The rest on the and of three makes four land harder than I expected it to' : '',
}))

const failures = []
function check(label, pass, detail) {
  console.log(`${pass ? '✓' : '✗'}  ${label}`)
  if (!pass) {
    failures.push(label)
    if (detail) console.log(`    ${detail}`)
  }
}

async function measure(page) {
  // Paged lists size themselves from a ResizeObserver, a frame after layout.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  return page.evaluate(() => {
    const doc = document.documentElement
    const main = document.querySelector('.tool-shell__main')
    const clipped = []
    for (const sel of ['.rd-tray', '.rd-stage__panel', '.rd-results', '.rd-results__hits', '.rd-kept', '.rd-controls', '.rd-head']) {
      const el = document.querySelector(sel)
      if (!el) continue
      const style = getComputedStyle(el)
      if (style.display === 'none') continue
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
        clipped.push(`${sel} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`)
      }
    }
    const die = document.querySelector('.rd-die-button')?.getBoundingClientRect()
    return {
      pageScroll: doc.scrollHeight - window.innerHeight,
      pageScrollX: doc.scrollWidth - doc.clientWidth,
      mainScroll: main.scrollHeight - main.clientHeight,
      mainScrollX: main.scrollWidth - main.clientWidth,
      clipped,
      dieSize: die ? Math.round(Math.min(die.width, die.height)) : 0,
    }
  })
}

async function verify(page, label, slug) {
  const m = await measure(page)
  const problems = []
  if (m.pageScroll > 0 || m.pageScrollX > 0) problems.push(`page scrolls ${m.pageScrollX}x${m.pageScroll}px`)
  if (m.mainScroll > 1 || m.mainScrollX > 1) problems.push(`main area scrolls ${m.mainScrollX}x${m.mainScroll}px`)
  if (m.clipped.length) problems.push(`content cut off: ${m.clipped.join('; ')}`)
  if (m.dieSize < 56) problems.push(`dice only ${m.dieSize}px`)
  check(label, problems.length === 0, problems.join(' | '))
  if (problems.length) await page.screenshot({ path: `${OUT}/${slug}.png` })
}

async function isUp() {
  try { return (await fetch(BASE)).ok } catch { return false }
}

mkdirSync(OUT, { recursive: true })
if (await isUp()) throw new Error(`port ${PORT} is already serving something -- stop it and re-run`)
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] })
try {
  for (let i = 0; ; i++) {
    if (await isUp()) break
    if (i > 50) throw new Error('vite preview did not start -- run npm run build first')
    await new Promise(r => setTimeout(r, 200))
  }
  for (const [name, width, height] of VIEWPORTS) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, reducedMotion: 'reduce' })
    await ctx.addInitScript(kept => {
      localStorage.setItem('kyndaTools.rhythmDice.keptBars', JSON.stringify(kept))
      localStorage.setItem('kyndaTools.rhythmDice.levels', 'L2')
      localStorage.setItem('kyndaTools.rhythmDice.bpm', '160')
    }, KEPT)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/rhythm-dice`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.rd-die__notes svg')

    // Load the busiest bar from the kept list.
    await page.getByRole('tab', { name: /Keep/ }).click()
    await verify(page, `${name}: Keep view`, `${slug}-keep`)
    await page.locator('.rd-kept__item').first().getByRole('button', { name: 'Load' }).click()
    await verify(page, `${name}: Play view`, `${slug}-play`)

    // Perform with no taps: 16 missed hits is the longest result.
    await page.getByRole('button', { name: 'Perform' }).click()
    await page.waitForSelector('.rd-results', { timeout: 15000 })
    await verify(page, `${name}: Result view`, `${slug}-result`)
    const hitsSwitch = page.getByRole('radio', { name: 'Each hit' })
    if (await hitsSwitch.isVisible()) {
      await hitsSwitch.click()
      await verify(page, `${name}: Result view, each hit`, `${slug}-result-hits`)
    }

    await page.getByRole('radio', { name: 'Blocks' }).click()
    await verify(page, `${name}: blocks view`, `${slug}-blocks`)
    await ctx.close()
  }
} finally {
  await browser.close()
  server.kill()
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed; screenshots in ${OUT}/`)
  process.exit(1)
}
console.log('\nRhythm Dice fits one screen at every size checked')
