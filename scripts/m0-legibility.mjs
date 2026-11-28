// M0 notation feasibility check -- DISPOSABLE PROTOTYPE, never merged.
// Legibility evidence for the founder (M0 brief, reporting rule 1 and AP 96):
//  1. staff space actually drawn at phone and iPad widths, in CSS px and mm;
//  2. a scale sweep: the largest drawing scale that still keeps at least
//     2 bars per system (last system excepted) at each phone width;
//  3. EMULATED screenshots (Playwright device emulation in desktop Chromium),
//     stamped "EMULATED" on the image. These are never device screenshots;
//     the founder captures those on real devices from the preview link.
//
// Usage: npx vite build && M0_BASE=http://localhost:4179 node scripts/m0-legibility.mjs <out>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices } from 'playwright'

const OUT = process.argv[2] || 'm0-legibility'
mkdirSync(OUT, { recursive: true })
const BASE = process.env.M0_BASE || 'http://localhost:4179'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

// CSS px per inch for each target (Apple's published pixel density / scale).
const TARGETS = [
  { name: 'iPhone SE (2nd/3rd gen)', width: 375, cssPpi: 326 / 2 },
  { name: 'iPhone 13 mini', width: 375, cssPpi: 476 / 3 },
  { name: 'iPhone 12–14', width: 390, cssPpi: 460 / 3 },
  { name: 'iPhone 15–16', width: 393, cssPpi: 460 / 3 },
  { name: 'iPhone Pro Max / Plus', width: 430, cssPpi: 458 / 3 },
  { name: 'iPad Air 2 portrait', width: 768, cssPpi: 264 / 2 },
  { name: 'iPad Air 2 landscape', width: 1024, cssPpi: 264 / 2 },
]
const mm = (px, ppi) => +(px / ppi * 25.4).toFixed(2)

async function measure(width, fixture, scale) {
  const p = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
  await p.goto(`${BASE}/m0-notation?fixture=${fixture}&theme=light${scale ? `&scale=${scale}` : ''}`)
  await p.waitForFunction(() => window.__m0?.report)
  const d = await p.evaluate(() => {
    // Staff space from the drawn stave: five lines span four spaces.
    const svg = document.querySelector('[data-testid="score"] svg')
    const r = window.__m0.report
    const ys = [...svg.querySelectorAll('path, rect')]
      .map(e => e.getBoundingClientRect())
      .filter(b => b.height < 2 && b.width > 40)
      .map(b => Math.round(b.y * 10) / 10)
    const lines = [...new Set(ys)].sort((a, b) => a - b).slice(0, 5)
    const measured = lines.length === 5 ? (lines[4] - lines[0]) / 4 : null
    return { scale: r.scale, staffSpacePx: r.staffSpacePx, measured, barsPerSystem: r.barsPerSystem, scroll: document.documentElement.scrollWidth > window.innerWidth }
  })
  await p.close()
  return d
}

const twoBarsOk = s => (s.length === 1 ? s[0] >= 2 : s.slice(0, -1).every(n => n >= 2))

// 1. Staff space at the default scale.
const staff = []
for (const t of TARGETS) {
  const d = await measure(t.width, 'F11')
  staff.push({ ...t, scale: d.scale, staffSpacePx: d.staffSpacePx, measuredPx: d.measured, staffSpaceMm: mm(d.staffSpacePx, t.cssPpi), staffHeightMm: mm(4 * d.staffSpacePx, t.cssPpi), barsPerSystem: d.barsPerSystem })
}

// 2. Scale sweep on F11 at phone widths.
const sweep = []
for (const width of [375, 390, 430]) {
  for (const scale of [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1]) {
    const d = await measure(width, 'F11', scale)
    sweep.push({ width, scale, barsPerSystem: d.barsPerSystem, twoBars: twoBarsOk(d.barsPerSystem), scroll: d.scroll })
  }
}

// 3. EMULATED screenshots at device size (CSS px x device pixel ratio).
const shots = []
const emulate = [
  { label: 'iPhone 13 (emulated)', device: devices['iPhone 13'], fixtures: ['F6', 'F10', 'F11'], themes: ['light', 'dark'] },
  { label: 'iPad (emulated, iPad Air 2 size 768x1024)', device: { ...devices['iPad (gen 7)'], viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2 }, fixtures: ['F11'], themes: ['light'], landscape: true },
]
for (const e of emulate) {
  const orientations = e.landscape ? ['portrait', 'landscape'] : ['portrait']
  for (const o of orientations) {
    const vp = o === 'landscape' ? { width: e.device.viewport.height, height: e.device.viewport.width } : e.device.viewport
    const ctx = await browser.newContext({ ...e.device, viewport: vp })
    const p = await ctx.newPage()
    for (const id of e.fixtures) {
      for (const theme of e.themes) {
        await p.goto(`${BASE}/m0-notation?fixture=${id}&theme=${theme}`)
        await p.waitForFunction(() => window.__m0?.report)
        await p.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2000))]))
        await p.evaluate(label => {
          const s = document.createElement('div')
          s.textContent = `EMULATED — ${label} — not a device screenshot`
          Object.assign(s.style, { position: 'fixed', left: 0, right: 0, bottom: 0, padding: '6px', background: '#c62828', color: '#fff', font: 'bold 12px Arial', textAlign: 'center', zIndex: 99 })
          document.body.appendChild(s)
        }, e.label)
        const file = `EMULATED-${id}-${e.label.split(' ')[0]}-${o}-${theme}.png`
        await p.screenshot({ path: join(OUT, file) })
        shots.push(file)
      }
    }
    await ctx.close()
  }
}

const result = { staff, sweep, shots }
writeFileSync(join(OUT, 'legibility.json'), JSON.stringify(result, null, 2))
await browser.close()
console.table(staff.map(s => ({ target: s.name, width: s.width, scale: s.scale, spacePx: s.staffSpacePx, measuredPx: s.measuredPx, spaceMm: s.staffSpaceMm, staffMm: s.staffHeightMm, bars: s.barsPerSystem.join(',') })))
console.table(sweep.map(s => ({ ...s, barsPerSystem: s.barsPerSystem.join(',') })))
console.log(shots.join('\n'))
