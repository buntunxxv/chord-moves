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
  ['iPhone 13 mini portrait (Safari)', 375, 616],
]

// The widest and busiest bar the free levels can make: five semiquaver dice
// in 5/4 (20 hits). The phrase is four of them (80 hits).
const BUSY_BAR = ['L2-1', 'L2-1', 'L2-1', 'L2-1', 'L2-1']
const KEPT = Array.from({ length: 9 }, (_, i) => ({
  id: String(1700000000000 + i),
  keptAt: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
  faceIds: i === 0 ? BUSY_BAR : i % 3 === 1 ? ['L3-5', 'L1-1', 'L3-4'] : ['L1-1', 'L2-2', 'L1-4', 'L2-1'],
  metre: i === 0 ? '5/4' : i % 3 === 1 ? '3/4' : '4/4',
  bpm: 160,
  levelIds: ['L1', 'L2', 'L3'],
  reason: i % 2 ? 'The rest on the and of three makes four land harder than I expected it to' : '',
}))
const PHRASE = { metre: '5/4', bars: [BUSY_BAR, BUSY_BAR, BUSY_BAR, BUSY_BAR] }

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

// Level buttons on tablets, a level picker on phones.
async function chooseLevel(page, n) {
  const radio = page.getByRole('radio', { name: new RegExp(`Level ${n}`) })
  if (await radio.isVisible()) await radio.click()
  else await page.selectOption('.rd-level-pick select', `L${n}`)
}

// The classroom view is its own full-screen layer: it must fit too.
async function verifyClassroom(page, label, slug) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const m = await page.evaluate(() => {
    const el = document.querySelector('.rd-class')
    const die = document.querySelector('.rd-class__die .rd-die')?.getBoundingClientRect()
    const actions = document.querySelector('.rd-class__actions')?.getBoundingClientRect()
    return {
      scroll: el.scrollHeight - el.clientHeight,
      scrollX: el.scrollWidth - el.clientWidth,
      die: die ? Math.round(Math.min(die.width, die.height)) : 0,
      actionsVisible: actions ? actions.bottom <= window.innerHeight + 1 : false,
    }
  })
  const problems = []
  if (m.scroll > 1 || m.scrollX > 1) problems.push(`classroom scrolls ${m.scrollX}x${m.scroll}px`)
  if (m.die < 120) problems.push(`classroom dice only ${m.die}px`)
  if (!m.actionsVisible) problems.push('classroom buttons off screen')
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
    await ctx.addInitScript(({ kept, phrase }) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('kyndaTools.rhythmDice.keptBars', JSON.stringify(kept))
      localStorage.setItem('kyndaTools.rhythmDice.phrase', JSON.stringify(phrase))
      localStorage.setItem('kyndaTools.rhythmDice.levels', 'mix')
      localStorage.setItem('kyndaTools.rhythmDice.bpm', '160')
      localStorage.setItem('kyndaTools.rhythmDice.mode', 'once')
    }, { kept: KEPT, phrase: PHRASE })
    // Counts sounds started from a noise buffer (the clap voice), so a tap's
    // own sound can be checked.
    await ctx.addInitScript(() => {
      window.__claps = 0
      const make = AudioContext.prototype.createBufferSource
      AudioContext.prototype.createBufferSource = function () {
        const src = make.call(this)
        const start = src.start.bind(src)
        src.start = (...args) => { window.__claps++; return start(...args) }
        return src
      }
    })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/rhythm-dice`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.rd-die__notes svg')

    // Pro: tapping the locked Level 4 opens the unlock sheet over the page.
    await chooseLevel(page, 4)
    await page.waitForSelector('.bottom-sheet')
    await verify(page, `${name}: Pro unlock sheet`, `${slug}-pro-sheet`)
    await page.keyboard.press('Escape')

    // Load the busiest bar from the kept list.
    await page.getByRole('tab', { name: /Keep/ }).click()
    await verify(page, `${name}: Keep view`, `${slug}-keep`)
    await page.locator('.rd-kept__item').first().getByRole('button', { name: 'Load' }).click()
    await verify(page, `${name}: Play view`, `${slug}-play`)

    // Before Perform the pad still sounds (try a rhythm out); nothing is scored.
    const idleBefore = await page.evaluate(() => window.__claps)
    await page.locator('.rd-pad').tap()
    await page.locator('.rd-pad').press('Space')
    await page.waitForFunction(n => window.__claps >= n + 2, idleBefore, { timeout: 3000 }).catch(() => {})
    const idleAfter = await page.evaluate(() => window.__claps)
    const scored = await page.locator('.rd-results').count()
    check(`${name}: taps sound before Perform`, idleAfter - idleBefore === 2 && scored === 0, `${idleAfter - idleBefore} sounds for 2 taps, ${scored} results`)

    // Settings: the sheet fits; tap sound off silences taps; volumes persist.
    await page.locator('.rd-settings-btn').click()
    await page.waitForSelector('.rd-settings')
    await verify(page, `${name}: Settings sheet`, `${slug}-settings`)
    await page.getByRole('radio', { name: 'Off' }).click()
    await page.getByRole('button', { name: 'Metronome volume down' }).click()
    await page.keyboard.press('Escape')
    const offBefore = await page.evaluate(() => window.__claps)
    await page.locator('.rd-pad').tap()
    await page.waitForTimeout(150)
    const offAfter = await page.evaluate(() => window.__claps)
    const saved = await page.evaluate(() => [localStorage.getItem('kyndaTools.rhythmDice.tapSound'), localStorage.getItem('kyndaTools.rhythmDice.clickVolume')])
    check(`${name}: tap sound off is silent, and saved`, offAfter === offBefore && saved[0] === 'off' && saved[1] === '65', `${offAfter - offBefore} sounds; saved ${JSON.stringify(saved)}`)
    await page.locator('.rd-settings-btn').click()
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await page.keyboard.press('Escape')

    // Perform with no taps: 16 missed hits is the longest result.
    await page.getByRole('button', { name: 'Perform' }).click()
    await page.waitForSelector('.rd-results', { timeout: 15000 })
    await verify(page, `${name}: Result view`, `${slug}-result`)
    const hitsSwitch = page.getByRole('radio', { name: 'Each hit' })
    if (await hitsSwitch.isVisible()) {
      await hitsSwitch.click()
      await verify(page, `${name}: Result view, each hit`, `${slug}-result-hits`)
    }

    // Read ahead: the Next row joins the Play panel while a bar plays.
    await page.getByRole('tab', { name: 'Play' }).click()
    await page.getByRole('radio', { name: 'Read ahead' }).click()
    await page.getByRole('button', { name: 'Perform' }).click()
    await page.waitForSelector('.rd-next', { timeout: 5000 })
    await verify(page, `${name}: read ahead, playing`, `${slug}-readahead`)
    // Students hear what they tap: each tap sounds a clap there and then.
    const clapsBefore = await page.evaluate(() => window.__claps)
    await page.keyboard.press('Space')
    await page.locator('.rd-pad').tap()
    const clapsAfter = await page.evaluate(() => window.__claps)
    check(`${name}: each tap sounds`, clapsAfter - clapsBefore === 2, `${clapsAfter - clapsBefore} sounds for 2 taps`)
    await page.getByRole('button', { name: 'Stop' }).click()
    await page.getByRole('radio', { name: 'Once' }).click()

    // Phrase: four 5/4 bars, then played with no taps (80 missed hits).
    await page.getByRole('tab', { name: /Phrase/ }).click()
    await verify(page, `${name}: Phrase view`, `${slug}-phrase`)
    await page.getByRole('button', { name: 'Play phrase' }).click()
    await page.waitForSelector('.rd-results', { timeout: 20000 })
    await verify(page, `${name}: phrase result`, `${slug}-phrase-result`)
    if (await hitsSwitch.isVisible()) {
      await hitsSwitch.click()
      await verify(page, `${name}: phrase result, each hit`, `${slug}-phrase-hits`)
    }

    // With Pro on: five level buttons and the Pro chip share the header.
    await page.evaluate(() => {
      localStorage.setItem('kyndaTools.pro', 'pro')
      localStorage.setItem('kyndaTools.proEmail', 'layout-check@example.com')
    })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.rd-pro-chip')
    await chooseLevel(page, 4)
    await page.getByRole('button', { name: /^(Roll|Re-roll)$/ }).click()
    await verify(page, `${name}: Pro on, Level 4`, `${slug}-pro-on`)

    // Compound time: four dotted-crotchet dice in 12/8; then 7/8's 2+2+3.
    await page.selectOption('#rd-metre', '12/8')
    await verify(page, `${name}: 12/8, Level 5`, `${slug}-12-8`)
    await page.selectOption('#rd-metre', '7/8')
    await verify(page, `${name}: 7/8`, `${slug}-7-8`)

    // Classroom (tablets): one big die per group, playing.
    const classroomBtn = page.getByRole('button', { name: 'Classroom' })
    if (await classroomBtn.isVisible()) {
      await page.selectOption('#rd-metre', '4/4')
      await classroomBtn.click()
      await page.waitForSelector('.rd-class')
      await page.getByRole('button', { name: 'Play', exact: true }).click()
      await page.waitForTimeout(400)
      await verifyClassroom(page, `${name}: classroom, playing`, `${slug}-classroom`)
      await page.keyboard.press('Escape')
      await page.waitForSelector('.rd-class', { state: 'detached' })
    }

    const blocksControl = page.getByRole('radio', { name: 'Blocks' })
    if (await blocksControl.isVisible()) await blocksControl.click()
    else await page.locator('.rd-view-toggle').click()
    await verify(page, `${name}: blocks view`, `${slug}-blocks`)
    // Switching views must replace the face, never draw blocks over notes.
    const mixed = await page.locator('.rd-tray .rd-die svg').count()
    check(`${name}: blocks view shows no notes`, mixed === 0, `${mixed} note drawings left under the blocks`)
    const notesControl = page.getByRole('radio', { name: 'Notes' })
    if (await notesControl.isVisible()) await notesControl.click()
    else await page.locator('.rd-view-toggle').click()
    const dice = await page.locator('.rd-tray .rd-die').count()
    const notes = await page.locator('.rd-tray .rd-die__notes svg').count()
    const blocks = await page.locator('.rd-tray .rd-block').count()
    check(`${name}: back to notes`, notes === dice && dice > 0 && blocks === 0, `${notes} note drawings for ${dice} dice, ${blocks} blocks`)
    // Safari can give a face's SVG (a viewBox, no width or height) its default
    // 300x150 size. Force that here: no die, nor the tray, may change size.
    const sizes = () => page.evaluate(() => ({
      tray: Math.round(document.querySelector('.rd-tray').getBoundingClientRect().height),
      dice: [...document.querySelectorAll('.rd-tray .rd-die')].map(d => { const r = d.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.width)}x${Math.round(r.height)}` }).join(' '),
    }))
    const before = await sizes()
    await page.evaluate(() => document.querySelectorAll('.rd-tray .rd-die__notes svg').forEach(svg => { svg.style.width = '300px'; svg.style.height = '150px' }))
    const after = await sizes()
    check(`${name}: a face's drawing never resizes its die`, JSON.stringify(before) === JSON.stringify(after), `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`)
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
