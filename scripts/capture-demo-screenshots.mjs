#!/usr/bin/env node
// Captures the "build a progression from one chord" demo flow at phone,
// tablet and desktop sizes, as source frames for the demo video (and later
// for in-app onboarding clips). Re-run after any UI change to refresh them.
// Needs a build: npm run build && node scripts/capture-demo-screenshots.mjs
// Options: THEME=dark for dark mode, PRO=1 to show the Pro tier.
// Frames land in demo-screenshots/<theme>[-pro]/<device>/NN-step.png.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 4181
const BASE = `http://localhost:${PORT}`
const THEME = process.env.THEME || 'light' // 'light' or 'dark'
const PRO = process.env.PRO === '1' // show the Pro tier instead of free
const OUT = `demo-screenshots/${THEME}${PRO ? '-pro' : ''}`
const executablePath = process.env.CHROMIUM_PATH || undefined

// High device scale factors so frames stay sharp when cropped or zoomed in an
// edit; the CSS viewport is what decides which layout the app shows.
const DEVICES = [
  { name: 'mobile', viewport: { width: 390, height: 844 }, scale: 3, isMobile: true, hasTouch: true },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, scale: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, scale: 2, isMobile: false, hasTouch: false },
]

const visible = (page, role, name) => page.getByRole(role, { name }).locator('visible=true').first()

async function settle(page, ms = 500) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(ms)
}

// The chord panel (add, explore next) sits behind the "Explore" tab on a phone.
async function inChordPanel(page, name) {
  const btn = visible(page, 'button', name)
  if (!(await btn.isVisible().catch(() => false))) {
    await visible(page, 'button', /^Explore$/).click()
    await settle(page, 300)
  }
  return btn
}

async function openSuggestions(page) {
  await (await inChordPanel(page, /Explore next chords/)).click()
  await settle(page)
}

async function pickSuggestion(page, chord) {
  const tabs = page.locator('.overlay-page--docked .next-chords__tab')
  const tab = tabs.filter({ hasText: new RegExp(`^\\s*${chord}(?![a-z0-9♯♭#/])`) }).first()
  if (!(await tab.count())) {
    const offered = (await tabs.allInnerTexts()).map(t => t.split('\n')[0]).join(', ')
    throw new Error(`${chord} is not offered here (offered: ${offered})`)
  }
  await tab.click()
  await settle(page, 300)
}

async function addPickedSuggestion(page) {
  // The suggestion's own add button is the last visible one while the overlay is open.
  await page.getByRole('button', { name: /Add to progression/ }).locator('visible=true').last().click()
  await settle(page)
}

async function capture(device) {
  const dir = `${OUT}/${device.name}`
  mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch({ executablePath })
  const ctx = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.scale,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    colorScheme: THEME,
    reducedMotion: 'reduce',
  })
  // Skip the first-run walkthrough so frames show the tool, not the tour.
  await ctx.addInitScript(({ theme, pro }) => {
    localStorage.setItem('cm_seen_intro_v3', '1')
    localStorage.setItem('chordMovesThemePreference', theme)
    if (pro) localStorage.setItem('cm_tier', 'pro')
  }, { theme: THEME, pro: PRO })
  const page = await ctx.newPage()
  let n = 0
  const shot = async (step, opts = {}) => {
    const file = `${dir}/${String(++n).padStart(2, '0')}-${step}.png`
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', ...opts })
    console.log(`  ${file}`)
  }

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await settle(page, 800)
  await shot('welcome')

  await visible(page, 'button', 'Start building').click()
  await settle(page)
  await shot('build-one-chord')

  await visible(page, 'button', /^Root:/).click()
  await settle(page, 300)
  await shot('choose-root')
  await page.keyboard.press('Escape')
  await settle(page, 300)

  const add = await inChordPanel(page, /Add to progression/)
  await shot('explore-chord')
  await add.click()
  await settle(page)
  await shot('first-chord-added')

  // C → Am7 → Dm7 → G7: each chord is one the chord before it offers, and four
  // chords is the free tier's progression limit., each chosen from the suggestions.
  await openSuggestions(page)
  await shot('next-chord-options')
  for (const chord of ['Am7', 'Dm7', 'G7']) {
    await pickSuggestion(page, chord)
    await shot(`why-${chord}`)
    await addPickedSuggestion(page)
    await shot(`added-${chord}`)
  }

  await page.keyboard.press('Escape')
  await settle(page)
  await shot('progression-bar')

  await visible(page, 'button', /^Progression/).click()
  await settle(page, 700)
  await shot('progression-workspace')
  await shot('progression-workspace-full', { fullPage: true })
  await visible(page, 'button', 'Close progression workspace').click()
  await settle(page)

  await visible(page, 'button', /^Templates$/).click()
  await settle(page)
  await shot('templates')

  await visible(page, 'button', /^Identify$/).click()
  await settle(page)
  await shot('identify')

  await browser.close()
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'ignore',
})
try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(BASE).then(r => r.ok, () => false)) break
    await new Promise(r => setTimeout(r, 200))
  }
  rmSync(OUT, { recursive: true, force: true })
  console.log(`${THEME} theme, ${PRO ? 'Pro' : 'free'} tier`)
  for (const device of DEVICES) {
    console.log(`${device.name} (${device.viewport.width}×${device.viewport.height} @${device.scale}x)`)
    await capture(device)
  }
} finally {
  server.kill()
}
