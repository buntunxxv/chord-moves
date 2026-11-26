#!/usr/bin/env node
// Chord Dice is one screen, like Rhythm Dice: nothing on it may scroll or be
// cut off. For each device size below, the page is checked on the Build
// stage (before a roll, from the name with the longest feedback, and from
// the sound), the Result stage (a revealed chord, the longest meta) and the
// Keep stage with the reason field focused and nine long kept chords.
//   - the page and the shell's main area never scroll, in either direction
//   - the tray, stage panels and kept list hold all their content
//   - dice are at least 56 px
//   - every piano key can be reached: it is what a tap at its centre hits,
//     white keys at least 44 px each way, black keys 28 px wide, 44 px tall
//   - every other control is at least 44 px tall
// Needs a build: npm run build && node scripts/verify-chord-dice-layout.mjs
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 4183
const BASE = `http://localhost:${PORT}`
const OUT = 'chord-dice-layout-output'
const executablePath = process.env.CHROMIUM_PATH || undefined

// The same eight visible page areas as the Rhythm Dice check.
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

const LONG = 'The minor third sits so close to the root that the whole chord sounds like it is leaning back and'
const KEPT = Array.from({ length: 9 }, (_, i) => ({
  id: String(1700000000000 + i),
  keptAt: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
  root: ['G#', 'C#', 'Bb'][i % 3],
  quality: 'minor',
  colour: 'none',
  symbol: ['G#m', 'C#m', 'Bbm'][i % 3],
  start: i % 2 ? 'sound' : 'name',
  replays: i % 2 ? 12 : 0,
  revealed: i % 3 === 0,
  reason: LONG.slice(0, 60 + i * 6),
  levelKey: 'L2',
}))

// Roots as the dice show them -> pitch class.
const CHROMA = { C: 0, 'C♯': 1, D: 2, 'E♭': 3, E: 4, F: 5, 'F♯': 6, G: 7, 'G♯': 8, A: 9, 'B♭': 10, B: 11 }

const failures = []
function check(label, pass, detail) {
  console.log(`${pass ? '✓' : '✗'}  ${label}`)
  if (!pass) {
    failures.push(label)
    if (detail) console.log(`    ${detail}`)
  }
}

async function measure(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  return page.evaluate(() => {
    const doc = document.documentElement
    const main = document.querySelector('.tool-shell__main')
    const clipped = []
    for (const sel of ['.cd-head', '.cd-tray', '.cd-controls', '.cd-stage__tabs', '.cd-stage__panel', '.cd-feedback', '.cd-kept', '.cd-result', '.cd-build__actions']) {
      const el = document.querySelector(sel)
      if (!el || getComputedStyle(el).display === 'none') continue
      if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
        clipped.push(`${sel} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`)
      }
    }
    // Anything visible inside the tool must sit inside the page.
    const outside = []
    for (const el of document.querySelectorAll('.chord-dice button, .chord-dice input')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.bottom > window.innerHeight + 1 || r.right > window.innerWidth + 1 || r.left < -1) outside.push(el.textContent.trim() || el.id || el.className)
    }
    const small = []
    for (const el of document.querySelectorAll('.chord-dice button:not(.cd-key), .chord-dice input')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || getComputedStyle(el).visibility === 'hidden') continue
      if (r.height < 44 - 0.5) small.push(`${el.textContent.trim() || el.id} ${Math.round(r.height)}px`)
    }
    const keys = []
    for (const el of document.querySelectorAll('.cd-key')) {
      const r = el.getBoundingClientRect()
      const black = el.classList.contains('cd-key--black')
      // White keys are reached below the black keys.
      const x = r.left + r.width / 2
      const y = black ? r.top + r.height / 2 : r.bottom - Math.min(20, r.height / 5)
      const hit = document.elementFromPoint(x, y)?.closest('.cd-key')
      const minW = black ? 28 : 44
      if (hit !== el) keys.push(`${el.getAttribute('aria-label')} is covered`)
      if (r.width < minW - 0.5 || r.height < 44 - 0.5) keys.push(`${el.getAttribute('aria-label')} ${Math.round(r.width)}x${Math.round(r.height)}`)
      if (r.bottom > window.innerHeight + 1) keys.push(`${el.getAttribute('aria-label')} off screen`)
    }
    const dice = [...document.querySelectorAll('.cd-die')].map(d => d.getBoundingClientRect())
    return {
      pageScroll: doc.scrollHeight - window.innerHeight,
      pageScrollX: doc.scrollWidth - doc.clientWidth,
      mainScroll: main.scrollHeight - main.clientHeight,
      mainScrollX: main.scrollWidth - main.clientWidth,
      clipped,
      outside,
      small,
      keys,
      dieSize: dice.length ? Math.round(Math.min(...dice.map(d => Math.min(d.width, d.height)))) : 0,
    }
  })
}

async function verify(page, label, slug, { piano = false } = {}) {
  const m = await measure(page)
  const problems = []
  if (m.pageScroll > 0 || m.pageScrollX > 0) problems.push(`page scrolls ${m.pageScrollX}x${m.pageScroll}px`)
  if (m.mainScroll > 1 || m.mainScrollX > 1) problems.push(`main area scrolls ${m.mainScrollX}x${m.mainScroll}px`)
  if (m.clipped.length) problems.push(`content cut off: ${m.clipped.join('; ')}`)
  if (m.outside.length) problems.push(`off screen: ${m.outside.join(', ')}`)
  if (m.small.length) problems.push(`under 44px: ${m.small.join(', ')}`)
  if (m.dieSize < 56) problems.push(`dice only ${m.dieSize}px`)
  if (piano && m.keys.length) problems.push(`keys: ${m.keys.join(', ')}`)
  check(label, problems.length === 0, problems.join(' | '))
  if (problems.length) await page.screenshot({ path: `${OUT}/${slug}.png` })
}

// The Pro sheet sits over the page: it must fit the screen, its buttons
// reachable, and the page under it must not scroll.
async function verifySheet(page, label, slug) {
  await page.locator('[role="dialog"]').waitFor()
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const m = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]').getBoundingClientRect()
    const off = [...document.querySelectorAll('[role="dialog"] button, [role="dialog"] input')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.bottom > window.innerHeight + 1 || r.right > window.innerWidth + 1) })
      .map(el => el.textContent.trim() || el.id)
    const small = [...document.querySelectorAll('[role="dialog"] .cd-btn, [role="dialog"] input')]
      .filter(el => el.getBoundingClientRect().height < 43.5).map(el => el.textContent.trim() || el.id)
    return { off, small, fits: d.top >= -1 && d.bottom <= window.innerHeight + 1, pageScroll: document.documentElement.scrollHeight - window.innerHeight }
  })
  const problems = []
  if (!m.fits) problems.push('sheet taller than the screen')
  if (m.off.length) problems.push(`off screen: ${m.off.join(', ')}`)
  if (m.small.length) problems.push(`under 44px: ${m.small.join(', ')}`)
  if (m.pageScroll > 0) problems.push(`page scrolls ${m.pageScroll}px`)
  check(label, problems.length === 0, problems.join(' | '))
  if (problems.length) await page.screenshot({ path: `${OUT}/${slug}.png` })
}

// Level buttons on tablets, a level picker on phones.
const LEVEL_ORDER = ['L1', 'L2', 'L3', 'L4', 'L5', 'mix']
async function pickLevel(page, key) {
  const radio = page.locator('.cd-head__levels [role="radio"]').nth(LEVEL_ORDER.indexOf(key))
  if (await radio.isVisible()) await radio.click()
  else await page.selectOption('.cd-level-pick select', key)
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
    await ctx.addInitScript(({ kept }) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('kyndaTools.chordDice.keptChords', JSON.stringify(kept))
      localStorage.setItem('kyndaTools.chordDice.level', 'L2')
      localStorage.setItem('kyndaTools.chordDice.start', 'name')
    }, { kept: KEPT })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${BASE}/chord-dice`, { waitUntil: 'networkidle' })

    await verify(page, `${name}: Build, before a roll`, `${slug}-build-empty`, { piano: true })

    // From the name, the longest feedback there is: a tritone above the root
    // with the spelling note on a black key needs a sharp root, so force G♯m.
    await page.evaluate(() => { const v = [0, 17 / 24 + 0.001]; Math.random = () => (v.length ? v.shift() : 0.5) })
    await page.getByRole('button', { name: /^Roll/ }).click()
    const root = (await page.locator('.cd-slot').first().locator('.cd-die__face').textContent()).trim()
    check(`${name}: forced roll is G♯ minor`, root === 'G♯', `rolled ${root}`)
    // Root, a wrong third, then a tritone: the last is the longest line.
    for (const up of [0, 4, 6]) await page.locator(`.cd-key[data-chroma="${(CHROMA[root] + up) % 12}"]`).click()
    await verify(page, `${name}: Build from the name, long feedback`, `${slug}-build-name`, { piano: true })

    // Result: revealed, so every meta chip shows.
    await page.getByRole('button', { name: 'Reveal' }).click()
    await verify(page, `${name}: Result (revealed)`, `${slug}-result`)

    // Keep, with the reason field focused and a long reason typed.
    await page.getByRole('tab', { name: 'Keep' }).click()
    await page.locator('#cd-reason').focus()
    await page.locator('#cd-reason').fill(LONG)
    await verify(page, `${name}: Keep, reason focused, 9 kept`, `${slug}-keep`)
    const pager = await page.locator('.cd-pager').count()
    const rows = await page.locator('.cd-kept__item').count()
    check(`${name}: kept chords page instead of scrolling`, pager === 1 || rows === 9, `${rows} rows, no pager`)

    // From the sound, after replays and a tap.
    await page.getByRole('radio', { name: 'From sound' }).click()
    await page.getByRole('button', { name: /^Roll/ }).click()
    for (let i = 0; i < 12; i++) await page.locator('.cd-replay').click()
    await page.locator('.cd-key[data-chroma="6"]').click()
    await verify(page, `${name}: Build from the sound, 12 replays`, `${slug}-build-sound`, { piano: true })

    // Level 3, from the name: C♯sus4 with four stray notes and the fourth
    // missing gives the longest Submit feedback there is.
    await pickLevel(page, 'L3')
    await page.getByRole('radio', { name: 'From name' }).click()
    await page.evaluate(() => { const v = [0, 7 / 48 + 0.001]; Math.random = () => (v.length ? v.shift() : 0.5) })
    await page.getByRole('button', { name: /^Roll/ }).click()
    for (const c of [1, 2, 4, 10, 11]) await page.locator(`.cd-key[data-chroma="${c}"]`).click()
    await page.getByRole('button', { name: 'Submit' }).click()
    const said = await page.locator('.cd-feedback').innerText()
    check(`${name}: Level 3 Submit feedback shows`, /doesn’t use them/.test(said) && /perfect fourth above C♯/.test(said), said)
    await verify(page, `${name}: Build at Level 3 after Submit, longest feedback`, `${slug}-build-submit`, { piano: true })

    // Change one die: Levels 1–3 show two dice. The Quality of C♯sus4
    // becomes C♯aug (the longest change: two notes move, one to G𝄪);
    // build that and Submit.
    await page.getByRole('button', { name: 'Reveal' }).click()
    check(`${name}: two dice until Level 4`, (await page.locator('.cd-die').count()) === 2)
    await verify(page, `${name}: Result (revealed, two dice)`, `${slug}-result-two`)
    await page.evaluate(() => { const v = [0.5]; Math.random = () => (v.length ? v.shift() : 0.5) })
    await page.getByRole('button', { name: /^Change the Quality die/ }).click()
    for (const c of [1, 5, 9]) await page.locator(`.cd-key[data-chroma="${c}"]`).click()
    await page.getByRole('button', { name: 'Submit' }).click()
    const changed = await page.locator('.cd-result').innerText()
    check(`${name}: the change reflection shows`, changed.includes('You changed the Quality: C♯sus4 became C♯aug'), changed)
    await verify(page, `${name}: Result after Change one die`, `${slug}-result-change`)

    // Level 4 without Pro: the sheet must fit.
    await pickLevel(page, 'L4')
    await verifySheet(page, `${name}: Pro unlock sheet`, `${slug}-pro-sheet`)
    await page.keyboard.press('Escape')

    // With Pro: five level buttons and the Pro chip share the header; three
    // dice; G♯maj7 (with F𝄪) after a Submit with stray notes.
    await page.evaluate(() => { localStorage.setItem('kyndaTools.pro', 'pro'); localStorage.setItem('kyndaTools.proEmail', 'a@b.co') })
    await page.reload({ waitUntil: 'networkidle' })
    await pickLevel(page, 'L4')
    await page.evaluate(() => { const v = [0, 25 / 36 + 0.001]; Math.random = () => (v.length ? v.shift() : 0.5) })
    await page.getByRole('button', { name: /^Roll/ }).click()
    check(`${name}: Level 4 rolls G♯maj7 on three dice`, (await page.locator('.cd-die__face').allTextContents()).join(' ') === 'G♯ major 7')
    for (const c of [8, 0, 3, 6, 10, 1]) await page.locator(`.cd-key[data-chroma="${c}"]`).click()
    await page.getByRole('button', { name: 'Submit' }).click()
    await verify(page, `${name}: Level 4 with Pro, after Submit`, `${slug}-build-l4`, { piano: true })
    await page.getByRole('button', { name: 'Reveal' }).click()
    await verify(page, `${name}: Level 4 Result`, `${slug}-result-l4`)

    // Level 5: four dice. B♭madd9 (the longest name) with its ninth missing
    // and the bass marked, then E♭m/G♭ with the wrong bass: the two longest
    // Level 5 lines.
    await pickLevel(page, 'L5')
    await page.evaluate(() => { const v = [0, 117 / 132 + 0.0001]; Math.random = () => (v.length ? v.shift() : 0.5) })
    await page.getByRole('button', { name: /^Roll/ }).click()
    check(`${name}: Level 5 rolls B♭madd9 on four dice`, (await page.locator('.cd-die__face').allTextContents()).join(' ') === 'B♭ minor add9 root')
    for (const c of [10, 1, 5]) await page.locator(`.cd-key[data-chroma="${c}"]`).click()
    await page.getByRole('button', { name: 'Mark the bass' }).click()
    await page.locator('.cd-key[data-chroma="1"]').click()
    await page.getByRole('button', { name: 'Submit' }).click()
    await verify(page, `${name}: Level 5 after Submit, bass marked`, `${slug}-build-l5`, { piano: true })
    await page.evaluate(() => { const v = [0, 36 / 132 + 0.0001]; Math.random = () => (v.length ? v.shift() : 0.5) })
    await page.getByRole('button', { name: /^Roll/ }).click()
    for (const c of [3, 6, 10]) await page.locator(`.cd-key[data-chroma="${c}"]`).click()
    await page.getByRole('button', { name: 'Mark the bass' }).click()
    await page.locator('.cd-key[data-chroma="10"]').click()
    await page.getByRole('button', { name: 'Submit' }).click()
    const bassLine = await page.locator('.cd-feedback').innerText()
    check(`${name}: the bass line shows`, bassLine.includes('You chose the perfect fifth as bass. Which note is the minor third?'), bassLine)
    await verify(page, `${name}: Level 5 bass feedback`, `${slug}-build-l5-bass`, { piano: true })
    await page.getByRole('button', { name: 'Reveal' }).click()
    await verify(page, `${name}: Level 5 Result (slash)`, `${slug}-result-l5`)

    check(`${name}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
  server.kill()
}

if (failures.length) {
  console.error(`\n${failures.length} Chord Dice layout check(s) failed. Screenshots in ${OUT}/`)
  process.exit(1)
}
console.log('\nChord Dice fits one screen at every size, in every stage.')
