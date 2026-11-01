#!/usr/bin/env node
// Records the in-app demo videos from the real, built app, so the demo can
// never drift from the UI: after a UI change, re-run and commit the result.
//   npm run build && npm run demo:record
// Writes, per demo and per variant (portrait = phone, landscape = desktop):
//   public/demo/<id>-<variant>.webm, .mp4 and .jpg (poster)
//   src/demo/recordings.json -- file paths, sizes, length and beat timings.
// Caption wording lives in src/demo/demoScripts.js and needs no re-record.
// Needs ffmpeg on PATH (macOS: brew install ffmpeg).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { DEMO_SCRIPTS } from '../src/demo/demoScripts.js'
import {
  ROOT, DEMO_CHAIN, startPreview, seedStorage, visible, settle, inChordPanel,
  suggestionTab, assertOffered, pickedSuggestionAdd,
} from './lib/demoFlow.mjs'

const PORT = 4182
const OUT_DIR = join(ROOT, 'public/demo')
const MANIFEST = join(ROOT, 'src/demo/recordings.json')
const executablePath = process.env.CHROMIUM_PATH || undefined

// `scale` is the recording's pixel density: the video is viewport × scale.
const VARIANTS = {
  portrait: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 1280, height: 720 }, scale: 1.5, isMobile: false, hasTouch: false },
}

// A visible ring where each tap lands, so viewers can follow what is pressed.
// Lives outside the React root and ignores the pointer.
function installTapMarker() {
  const style = document.createElement('style')
  style.textContent = `
    .demo-tap{position:fixed;z-index:2147483647;width:44px;height:44px;margin:-22px 0 0 -22px;
      border-radius:50%;background:rgba(18,148,144,.28);border:3px solid rgba(18,148,144,.9);
      pointer-events:none;animation:demo-tap .6s ease-out forwards}
    @keyframes demo-tap{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.25);opacity:0}}`
  document.head.appendChild(style)
  window.__demoTap = (x, y) => {
    const dot = document.createElement('div')
    dot.className = 'demo-tap'
    dot.style.left = `${x}px`
    dot.style.top = `${y}px`
    document.body.appendChild(dot)
    setTimeout(() => dot.remove(), 700)
  }
}

function makeDirector(page) {
  const t0 = Date.now()
  const beats = {}
  return {
    // When the flow began; the video is trimmed to start here.
    get startedAt() { return t0 },
    beat(name) { beats[name] = Math.round((Date.now() - t0) / 100) / 10 },
    beats,
    hold: ms => page.waitForTimeout(ms),
    // Ring first, then the real tap, so the viewer sees it coming.
    async tap(locator, after = 900) {
      await locator.scrollIntoViewIfNeeded()
      const box = await locator.boundingBox()
      if (box) await page.evaluate(([x, y]) => window.__demoTap?.(x, y), [box.x + box.width / 2, box.y + box.height / 2])
      await page.waitForTimeout(250)
      await locator.click()
      await page.waitForTimeout(after)
    },
  }
}

// One flow per demo id; each marks every beat its script lists.
const FLOWS = {
  async 'build-a-progression'(page, d) {
    d.beat('pick')
    await d.hold(1200)
    await d.tap(visible(page, 'button', /^Root:/), 900)
    await d.tap(page.getByRole('option', { name: 'C', exact: true }).locator('visible=true').first(), 800)
    const add = await inChordPanel(page, /Add to progression/, tab => d.tap(tab, 0))
    await d.hold(1000)
    await d.tap(add, 900)

    d.beat('explore')
    await d.tap(await inChordPanel(page, /Explore next chords/), 1300)
    for (const chord of DEMO_CHAIN) {
      await assertOffered(page, chord)
      await d.tap(suggestionTab(page, chord), 2000)
      await d.tap(pickedSuggestionAdd(page), 1000)
    }
    await page.keyboard.press('Escape')
    await d.hold(600)

    d.beat('build')
    await d.tap(visible(page, 'button', /^Progression/), 1200)
    await d.tap(visible(page, 'button', /Play progression/), 5500)
  },
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
}

// Chrome's own screencast, not Playwright's recordVideo: recordVideo captures
// in CSS pixels, so at a device scale above 1 it records only the top-left
// corner of the page. Screencast frames arrive at full device resolution,
// each stamped with when it was painted, and only when the page changes.
async function startScreencast(page, dir, size) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    frames.push({ file, t: metadata.timestamp * 1000 })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: size.width, maxHeight: size.height })
  return {
    frames,
    stop: () => cdp.send('Page.stopScreencast').catch(() => {}),
  }
}

// Turns timestamped frames into an ffmpeg concat list covering [from, to]:
// each frame lasts until the next one was painted.
function concatList(frames, from, to) {
  const lines = []
  const inRange = frames.filter(f => f.t <= to)
  let firstIdx = 0
  for (let i = 0; i < inRange.length; i++) if (inRange[i].t <= from) firstIdx = i
  const used = inRange.slice(firstIdx)
  used.forEach((frame, i) => {
    const start = Math.max(frame.t, from)
    const end = i + 1 < used.length ? used[i + 1].t : to
    lines.push(`file '${frame.file}'`, `duration ${((end - start) / 1000).toFixed(3)}`)
  })
  // The concat demuxer ignores the last entry's duration unless it is repeated.
  lines.push(`file '${used[used.length - 1].file}'`)
  return lines.join('\n') + '\n'
}

async function record(browser, base, id, name, variant) {
  const work = mkdtempSync(join(tmpdir(), 'demo-video-'))
  const size = { width: Math.round(variant.viewport.width * variant.scale), height: Math.round(variant.viewport.height * variant.scale) }
  const ctx = await browser.newContext({
    viewport: variant.viewport,
    deviceScaleFactor: variant.scale,
    isMobile: variant.isMobile,
    hasTouch: variant.hasTouch,
    colorScheme: 'light',
  })
  await ctx.addInitScript(seedStorage, { theme: 'light' })
  const page = await ctx.newPage()
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  await page.evaluate(installTapMarker)
  await visible(page, 'button', 'Start building').click()
  await settle(page, 600)

  const cast = await startScreencast(page, work, size)
  await page.waitForTimeout(300) // first frame
  const d = makeDirector(page)
  await FLOWS[id](page, d)
  const endedAt = Date.now()
  await page.waitForTimeout(200)
  await cast.stop()
  await ctx.close()
  const duration = Math.round((endedAt - d.startedAt) / 100) / 10

  const list = join(work, 'frames.txt')
  writeFileSync(list, concatList(cast.frames, d.startedAt, endedAt))
  const base_ = `${id}-${name}`
  const mp4 = join(OUT_DIR, `${base_}.mp4`)
  const webm = join(OUT_DIR, `${base_}.webm`)
  const jpg = join(OUT_DIR, `${base_}.jpg`)
  const fit = `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2`
  // Two encodings at a constant 30fps: VP9 WebM, which every browser engine
  // decodes (open-source Chromium builds included), and H.264 MP4 with
  // faststart for older Safari. The player offers WebM first.
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-an', '-r', '30', '-vf', fit, '-c:v', 'libx264', '-preset', 'slow',
    '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4])
  ffmpeg(['-i', mp4, '-an', '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', webm])
  ffmpeg(['-ss', '0.5', '-i', mp4, '-frames:v', '1', '-q:v', '3', jpg])
  rmSync(work, { recursive: true, force: true })

  const kb = file => Math.round(statSync(file).size / 1024)
  console.log(`  ${name}: ${size.width}×${size.height}, ${duration}s, ${cast.frames.length} frames, mp4 ${kb(mp4)} KB, webm ${kb(webm)} KB`)
  return {
    sources: [
      { src: `/demo/${base_}.webm`, type: 'video/webm' },
      { src: `/demo/${base_}.mp4`, type: 'video/mp4' },
    ],
    poster: `/demo/${base_}.jpg`,
    width: size.width,
    height: size.height,
    duration,
    beats: d.beats,
  }
}

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
} catch {
  console.error('ffmpeg is needed to encode the videos (macOS: brew install ffmpeg).')
  process.exit(1)
}

const only = process.argv[2]
const ids = only ? [only] : Object.keys(DEMO_SCRIPTS)
mkdirSync(OUT_DIR, { recursive: true })
const preview = await startPreview(PORT)
const browser = await chromium.launch({ executablePath })
let manifest = {}
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
} catch {}
try {
  for (const id of ids) {
    if (!FLOWS[id]) throw new Error(`No recording flow for "${id}" in scripts/record-demo-videos.mjs`)
    console.log(id)
    const variants = {}
    for (const [name, variant] of Object.entries(VARIANTS)) {
      variants[name] = await record(browser, preview.base, id, name, variant)
      const missing = DEMO_SCRIPTS[id].beats.filter(b => !(b in variants[name].beats))
      if (missing.length) throw new Error(`${id}/${name} never reached beat(s): ${missing.join(', ')}`)
    }
    manifest[id] = { recordedAt: new Date().toISOString().slice(0, 10), variants }
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Wrote ${MANIFEST.replace(ROOT, '')}`)
} finally {
  await browser.close()
  preview.stop()
}
