#!/usr/bin/env node
// Browser check that the app stays readable whatever the browser does to it.
//  1. Forced dark. Android browsers that darken every site (DuckDuckGo,
//     Samsung Internet, in-app WebViews, Chrome's auto-dark) used to repaint
//     our themes and left text unreadable (3 Oct 2026). The page now opts out
//     via color-scheme, so the browser's darkening must change nothing: each
//     route is rendered with and without it, and the pixels must match. No
//     stored baseline, so design changes never need a screenshot refresh.
//  2. Blocked storage. When the browser refuses localStorage, the getter
//     throws; every route must still render text with no page errors.
// Needs a build: npm run build && node scripts/verify-theme-rendering.mjs
// Failing screenshots land in theme-check-output/ (uploaded by CI).
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const PORT = 4179
const BASE = `http://localhost:${PORT}`
const ROUTES = ['/', '/tools', '/metronome', '/ear-trainer', '/chord-scales', '/upgrade']
// [label, in-app preference or null for "system"]. Forced dark always runs
// with the phone in dark mode: that is the only way real browsers apply it
// (Android WebView, Chrome and Samsung Internet darken pages only in dark
// theme, and report prefers-color-scheme: dark when they do). Chromium's
// test flag lets you pair forced dark with a light preference too, but then
// it ignores every page opt-out -- a harness artefact, not a device state.
const SCENARIOS = [
  ['phone dark, app follows system', null],
  ['phone dark, Light chosen in app', 'light'],
  ['phone dark, Dark chosen in app', 'dark'],
]
// Anti-aliasing can differ by a handful of pixels between two renders; a
// browser repaint changes far more than this.
const MAX_DIFF_RATIO = 0.002
const OUT = 'theme-check-output'
const executablePath = process.env.CHROMIUM_PATH || undefined

const failures = []
function check(label, pass, detail) {
  console.log(`${pass ? '✓' : '✗'}  ${label}`)
  if (!pass) {
    failures.push(label)
    if (detail) console.log(`    ${detail}`)
  }
}

const slug = s => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'home'

async function renderAll(forceDark, pref) {
  const browser = await chromium.launch({
    executablePath,
    args: forceDark ? ['--blink-settings=forceDarkModeEnabled=true'] : [],
  })
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  if (pref) await ctx.addInitScript(p => localStorage.setItem('chordMovesThemePreference', p), pref)
  const page = await ctx.newPage()
  const shots = {}
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500) // let the 0.2s theme transition settle
    shots[route] = await page.screenshot({ animations: 'disabled', caret: 'hide' })
  }
  await browser.close()
  return shots
}

async function checkForcedDark() {
  for (const [label, pref] of SCENARIOS) {
    const plain = await renderAll(false, pref)
    const forced = await renderAll(true, pref)
    for (const route of ROUTES) {
      const a = PNG.sync.read(plain[route])
      const b = PNG.sync.read(forced[route])
      const diff = new PNG({ width: a.width, height: a.height })
      const changed = a.width === b.width && a.height === b.height
        ? pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 })
        : Infinity
      const ratio = changed / (a.width * a.height)
      const pass = ratio <= MAX_DIFF_RATIO
      check(`forced dark leaves ${route} untouched (${label})`, pass,
        `${(ratio * 100).toFixed(2)}% of pixels repainted by the browser; see ${OUT}/`)
      if (!pass) {
        const name = `${slug(label)}--${slug(route)}`
        writeFileSync(`${OUT}/${name}--plain.png`, plain[route])
        writeFileSync(`${OUT}/${name}--forced.png`, forced[route])
        if (Number.isFinite(changed)) writeFileSync(`${OUT}/${name}--diff.png`, PNG.sync.write(diff))
      }
    }
  }
}

async function checkBlockedStorage() {
  const browser = await chromium.launch({ executablePath })
  const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 } })
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('The operation is insecure.', 'SecurityError') },
    })
  })
  for (const route of ROUTES) {
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(BASE + route, { waitUntil: 'networkidle' })
    const text = (await page.innerText('body')).trim()
    check(`${route} renders with storage blocked`, text.length > 0 && errors.length === 0,
      errors.length ? `page errors: ${errors.join('; ')}` : 'page rendered no text')
    await page.close()
  }
  await browser.close()
}

async function isUp() {
  try { return (await fetch(BASE)).ok } catch { return false }
}

mkdirSync(OUT, { recursive: true })
// Anything already on the port would be tested instead of this build.
if (await isUp()) throw new Error(`port ${PORT} is already serving something -- stop it and re-run`)
// Run vite's own entry point, not `npx vite`: killing npx leaves its vite
// child serving, and the next run would silently test that stale build.
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
try {
  for (let i = 0; ; i++) {
    if (await isUp()) break
    if (i > 50) throw new Error('vite preview did not start -- run npm run build first')
    await new Promise(r => setTimeout(r, 200))
  }
  await checkForcedDark()
  await checkBlockedStorage()
} finally {
  server.kill()
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nAll theme rendering checks passed')
