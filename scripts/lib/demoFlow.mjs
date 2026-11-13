// Shared by capture-demo-screenshots.mjs and record-demo-videos.mjs: start the
// built app, and drive the "build a progression from one chord" flow the same
// way in both, so the stills and the in-app video never show different moves.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// C → Am7 → Dm7 → G7: each chord is one the chord before it offers, and four
// chords is the free tier's progression limit.
export const DEMO_CHAIN = ['Am7', 'Dm7', 'G7']

// Serves dist/ (needs `npm run build`) until stop() is called.
export async function startPreview(port) {
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
  const base = `http://localhost:${port}`
  for (let i = 0; i < 50; i++) {
    if (await fetch(base).then(r => r.ok, () => false)) break
    await new Promise(r => setTimeout(r, 200))
  }
  return { base, stop: () => server.kill() }
}

// Skips the first-run walkthrough so the flow shows the tool, not the tour.
export function seedStorage({ theme = 'light', pro = false } = {}) {
  localStorage.setItem('cm_seen_intro_v3', '1')
  localStorage.setItem('chordMovesThemePreference', theme)
  if (pro) localStorage.setItem('cm_tier', 'pro')
}

export const visible = (page, role, name) => page.getByRole(role, { name }).locator('visible=true').first()

export async function settle(page, ms = 500) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(ms)
}

// The chord panel (add, explore next) sits behind the "Explore" tab on a
// phone. `beforeTab` runs before that tab is tapped (the recorder uses it to
// show the tap).
export async function inChordPanel(page, name, beforeTab = async () => {}) {
  const btn = visible(page, 'button', name)
  if (!(await btn.isVisible().catch(() => false))) {
    const tab = visible(page, 'button', /^Explore$/)
    await beforeTab(tab)
    await tab.click()
    await settle(page, 300)
  }
  return btn
}

export function suggestionTab(page, chord) {
  return page.locator('.overlay-page--docked .next-chords__tab')
    .filter({ hasText: new RegExp(`^\\s*${chord}(?![a-z0-9♯♭#/])`) })
    .first()
}

export async function assertOffered(page, chord) {
  if (await suggestionTab(page, chord).count()) return
  const tabs = page.locator('.overlay-page--docked .next-chords__tab')
  const offered = (await tabs.allInnerTexts()).map(t => t.split('\n')[0]).join(', ')
  throw new Error(`${chord} is not offered here (offered: ${offered})`)
}

// The picked suggestion's own add button is the last visible one while the
// suggestions overlay is open.
export const pickedSuggestionAdd = page =>
  page.getByRole('button', { name: /Add to progression/ }).locator('visible=true').last()
