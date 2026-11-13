#!/usr/bin/env node
// Captures the "build a progression from one chord" demo flow at phone,
// tablet and desktop sizes, as source frames for the demo video (and later
// for in-app onboarding clips). Re-run after any UI change to refresh them.
// Needs a build: npm run build && node scripts/capture-demo-screenshots.mjs
// Options: THEME=dark for dark mode, PRO=1 to show the Pro tier.
// Frames land in demo-screenshots/<theme>[-pro]/<device>/NN-step.png.
import { mkdirSync, rmSync } from 'node:fs'
import { chromium } from 'playwright'
import {
  DEMO_CHAIN, startPreview, seedStorage, visible, settle, inChordPanel,
  suggestionTab, assertOffered, pickedSuggestionAdd,
} from './lib/demoFlow.mjs'

const PORT = 4181
let BASE
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

async function openSuggestions(page) {
  await (await inChordPanel(page, /Explore next chords/)).click()
  await settle(page)
}

async function pickSuggestion(page, chord) {
  await assertOffered(page, chord)
  await suggestionTab(page, chord).click()
  await settle(page, 300)
}

async function addPickedSuggestion(page) {
  await pickedSuggestionAdd(page).click()
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
  await ctx.addInitScript(seedStorage, { theme: THEME, pro: PRO })
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

  await openSuggestions(page)
  await shot('next-chord-options')
  for (const chord of DEMO_CHAIN) {
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

const preview = await startPreview(PORT)
BASE = preview.base
try {
  rmSync(OUT, { recursive: true, force: true })
  console.log(`${THEME} theme, ${PRO ? 'Pro' : 'free'} tier`)
  for (const device of DEVICES) {
    console.log(`${device.name} (${device.viewport.width}×${device.viewport.height} @${device.scale}x)`)
    await capture(device)
  }
} finally {
  preview.stop()
}
