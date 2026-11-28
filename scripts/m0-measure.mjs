// M0 notation feasibility check -- DISPOSABLE PROTOTYPE, never merged.
// Measures T1 (correctness), T2 (speed, desktop Chromium), T4 (layout),
// T6 (themes) and T7 (contract) against the built app. T3 (size) is read
// from the build output; T5 (Safari, iPad Air 2) is a founder device run.
//
// Usage: npx vite build && node scripts/m0-measure.mjs <output-dir>
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { FIXTURES } from '../src/prototypes/m0-notation/fixtures.js'

const OUT = process.argv[2] || 'm0-output'
mkdirSync(OUT, { recursive: true })
const PORT = 4179
const BASE = process.env.M0_BASE || `http://localhost:${PORT}`
const WIDTHS = [375, 768, 1024, 1920]

// Reuse a running preview server when M0_BASE is set; otherwise start one.
let server = null
if (!process.env.M0_BASE) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('preview did not start')), 20000)
    server.stdout.on('data', d => { if (String(d).replace(/\x1b\[[0-9;]*m/g, '').includes(`:${PORT}`)) { clearTimeout(timer); resolve() } })
  })
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const results = { T1: [], T2: null, T4: [], T6: [], T7: null }

// Everything we count is read from the SVG VexFlow drew, except accidentals,
// which VexFlow draws without their own group: those come from VexFlow's own
// note model (the report), and are checked by eye in the screenshots.
async function inspect(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="score"] svg')
    const ids = [...svg.querySelectorAll('g.vf-stavenote')].map(g => g.id)
    const tieIds = new Set([...svg.querySelectorAll('g.vf-stavetie')].map(g => g.id.replace(/-\d$/, '')))
    const keySig = svg.querySelector('g.vf-keysignature')
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
    const heads = [...svg.querySelectorAll('g.vf-stavenote')].flatMap(g => [...g.querySelectorAll('g.vf-notehead')].map(h => ({ owner: g.id, ...rect(h) })))
    const chords = [...svg.querySelectorAll('g.vf-m0chord text')].map(t => ({ text: t.textContent, ...rect(t) }))
    const swing = [...svg.querySelectorAll('g.vf-m0swing text')].map(t => ({ text: t.textContent, ...rect(t) }))
    const headPath = svg.querySelector('g.vf-notehead path')
    const headFill = headPath ? getComputedStyle(headPath).fill : null
    const toRgb = c => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v }
    const tokenRgb = toRgb(getComputedStyle(document.documentElement).getPropertyValue('--text').trim())
    const svgRight = svg.getBoundingClientRect().right
    return {
      notes: ids.filter(i => i.startsWith('vf-m0-note')).length,
      rests: ids.filter(i => i.startsWith('vf-m0-rest')).length,
      ties: tieIds.size,
      keyGlyphs: keySig ? keySig.querySelectorAll('path').length : 0,
      chords, swing, heads, headFill, tokenRgb, svgRight,
      svgWidth: svg.getBoundingClientRect().width,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      report: window.__m0.report,
    }
  })
}

const overlap = (a, b) => {
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return x > 0.5 && y > 0.5
}
function collisions(d) {
  const found = []
  const boxes = [
    ...d.heads.map(h => ({ ...h, kind: 'notehead' })),
    ...d.chords.map(c => ({ ...c, kind: `chord ${c.text}` })),
    ...d.swing.map(s => ({ ...s, kind: 'swing' })),
  ]
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.kind === 'notehead' && b.kind === 'notehead' && a.owner === b.owner) continue
      if (overlap(a, b)) found.push(`${a.kind} / ${b.kind}`)
    }
  }
  return found
}

const page = await browser.newPage({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 })

// T1: every fixture at 1024 px, light theme.
for (const f of FIXTURES) {
  await page.goto(`${BASE}/m0-notation?fixture=${f.id}&theme=light`)
  await page.waitForFunction(() => window.__m0?.report)
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2000))]))
  const d = await inspect(page)
  const e = f.expect
  const acc = d.report.accidentals
  const checks = {
    notes: [d.notes, e.notes],
    rests: [d.rests, e.rests],
    ties: [d.ties, e.ties],
    accidentals: [acc['#'] + acc.b + acc.n + acc.other, e.accidentals],
    chords: [d.chords.length, e.chords],
    chordText: [d.chords.map(c => c.text).join(' '), f.chords.map(c => c.symbol.replace(/#/g, '♯').replace(/b(?=\d|$|\/)/g, '♭')).join(' ')],
    keyFlats: [d.keyGlyphs, e.keyFlats],
    swing: [d.swing.length > 0, e.swing],
  }
  if ('sharps' in e) checks.sharps = [acc['#'], e.sharps]
  if ('flats' in e) checks.flats = [acc.b, e.flats]
  if ('naturals' in e) checks.naturals = [acc.n, e.naturals]
  const failed = Object.entries(checks).filter(([, [a, b]]) => a !== b).map(([k, [a, b]]) => `${k}: drew ${a}, expected ${b}`)
  results.T1.push({ id: f.id, pass: failed.length === 0, failed })
  await page.screenshot({ path: join(OUT, `T1-${f.id}-1024-light.png`), fullPage: true })
}

// T2: desktop Chromium timing (the iPad Air 2 run is the founder's).
await page.goto(`${BASE}/m0-notation?fixture=F11&theme=light`)
await page.waitForFunction(() => window.__m0?.report)
await page.click('[data-testid="time"]')
const timingText = await page.textContent('[data-testid="timing"]')
const nums = [...timingText.matchAll(/([\d.]+) ms/g)].map(m => Number(m[1]))
results.T2 = { chromiumFirstMedianMs: nums[0], chromiumEditMedianMs: nums[1], pass: nums[0] <= 50 }

// T4 and T6: F11 and F12 at every width, both themes.
for (const w of WIDTHS) {
  for (const theme of ['light', 'dark']) {
    for (const id of ['F11', 'F12', 'F6', 'F10']) {
      const p = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })
      await p.goto(`${BASE}/m0-notation?fixture=${id}&theme=${theme}`)
      await p.waitForFunction(() => window.__m0?.report)
      await p.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2000))]))
      const d = await inspect(p)
      const sys = d.report.barsPerSystem
      const fewest = Math.min(...sys.slice(0, -1).concat(sys.length === 1 ? sys : []), ...(sys.at(-1) >= 2 ? [sys.at(-1)] : []))
      const clashes = collisions(d)
      const noScroll = d.scrollWidth <= d.innerWidth && d.svgRight <= d.innerWidth
      const barsOk = w !== 375 || fewest >= 2
      results.T4.push({ id, width: w, theme, barsPerSystem: sys, noScroll, barsOk, clashes, pass: noScroll && barsOk && clashes.length === 0 })
      const token = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text').trim())
      results.T6.push({ id, width: w, theme, inkMatchesToken: d.headFill === d.tokenRgb, headFill: d.headFill, token })
      if (id === 'F11' || id === 'F12') await p.screenshot({ path: join(OUT, `T4-${id}-${w}-${theme}.png`), fullPage: true })
      await p.close()
    }
  }
}

// T7: the renderer imports nothing but VexFlow.
const src = readFileSync('src/prototypes/m0-notation/renderer.js', 'utf8')
const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])
results.T7 = { imports, pass: imports.every(i => i === 'vexflow/bravura') }

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
await browser.close()
server?.kill()

const summary = {
  T1: results.T1.every(r => r.pass) ? 'pass' : results.T1.filter(r => !r.pass),
  T2: results.T2,
  T4: results.T4.every(r => r.pass) ? 'pass' : results.T4.filter(r => !r.pass),
  T6: results.T6.every(r => r.inkMatchesToken) ? 'pass' : results.T6.filter(r => !r.inkMatchesToken),
  T7: results.T7,
}
console.log(JSON.stringify(summary, null, 2))
