#!/usr/bin/env node
// Plays the live demo (/demo) end to end at phone, tablet and desktop sizes.
// Each chapter taps the real app by the names on its controls, so a UI change
// that breaks a step fails here, naming the step, before it reaches viewers.
// Also checks that jumping to a chapter works, and that the demo never
// touches the viewer's own saved progression.
// Needs a build: npm run build && npm run test:demo
import { chromium } from 'playwright'
import { startPreview } from './lib/demoFlow.mjs'

const PORT = 4184
const executablePath = process.env.CHROMIUM_PATH || undefined
const VIEWPORTS = [
  ['phone', { width: 390, height: 844 }, true],
  ['tablet', { width: 820, height: 1180 }, true],
  ['desktop', { width: 1440, height: 900 }, false],
]
const SAVED = JSON.stringify([{ name: 'Viewer’s own progression' }])

const failures = []
function check(label, pass, detail) {
  console.log(`${pass ? '✓' : '✗'}  ${label}`)
  if (!pass) {
    failures.push(label)
    if (detail) console.log(`    ${detail}`)
  }
}

async function status(page, wanted, timeout) {
  try {
    await page.waitForFunction(
      w => w.includes(document.querySelector('.demo-page')?.dataset.status),
      wanted,
      { timeout, polling: 200 }
    )
  } catch { /* reported by the caller */ }
  return page.evaluate(() => document.querySelector('.demo-page')?.dataset)
}

const preview = await startPreview(PORT)
const browser = await chromium.launch({ executablePath })
try {
  for (const [name, viewport, touch] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch })
    await ctx.addInitScript(saved => {
      if (!localStorage.getItem('chordMovesSavedProgressions')) localStorage.setItem('chordMovesSavedProgressions', saved)
    }, SAVED)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${preview.base}/demo`, { waitUntil: 'networkidle' })

    await page.getByRole('button', { name: 'Play the demo' }).click()
    let s = await status(page, ['ended', 'error'], 90000)
    check(`${name}: plays every chapter to the end`, s?.status === 'ended', s?.status === 'error'
      ? `stopped in "${s.chapter}": ${s.error}`
      : `status ${s?.status} in "${s?.chapter}"`)

    // Jump straight to the last chapter: earlier ones replay instantly first.
    await page.getByRole('button', { name: /Play it back/ }).click()
    s = await status(page, ['ended', 'error'], 60000)
    check(`${name}: a chapter jump plays from that chapter`, s?.status === 'ended', `status ${s?.status} in "${s?.chapter}"`)
    const chips = await page.frameLocator('iframe').getByRole('button', { name: /^Chord \d/ }).count().catch(() => 0)
    const progression = await page.frameLocator('iframe').locator('body').innerText()
    check(`${name}: the jump rebuilt the four-chord progression`, /4-chord progression/.test(progression), `chips ${chips}`)

    const saved = await page.evaluate(() => localStorage.getItem('chordMovesSavedProgressions'))
    const current = await page.evaluate(() => localStorage.getItem('chordMovesProgression'))
    check(`${name}: the viewer's own storage is untouched`, saved === SAVED && current === null, `saved=${saved} current=${current}`)
    check(`${name}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
  preview.stop()
}

if (failures.length) {
  console.log(`\n${failures.length} demo check(s) failed`)
  process.exit(1)
}
console.log('\nAll demo checks passed')
