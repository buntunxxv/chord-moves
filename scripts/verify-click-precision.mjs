// Click precision: renders 64 bars of 4/4 at 160 BPM through the real
// lookahead scheduler into an OfflineAudioContext, finds every click onset
// in the rendered audio, and asserts each is within +/-2 ms of its grid time.
//
// The scheduler runs exactly as it does live: it is pumped every 25 ms of a
// simulated clock and books only what falls inside its 100 ms horizon, so
// this exercises the lookahead logic, the timeline and the click voice
// together. It tests the scheduler only -- touch and speaker latency are
// covered by the per-device calibration and the manual iPad test.
//
// The modules are plain ES modules with relative imports, so they are served
// straight from src/ to Chromium; no build is needed.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BPM = 160
const BARS = 64
const TOLERANCE_MS = 2

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '')
  if (path === '' || path === 'blank') {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end('<!doctype html><title>clicks</title>')
  }
  if (!path.startsWith('src') || extname(path) !== '.js') {
    res.writeHead(404)
    return res.end()
  }
  try {
    const body = await readFile(join(ROOT, path))
    res.writeHead(200, { 'content-type': 'text/javascript' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

// Same convention as the other browser checks: CHROMIUM_PATH points a local
// run at an installed Chromium; CI uses the one Playwright installs.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
let failed = false
try {
  const page = await browser.newPage()
  await page.goto(`${origin}/blank`)
  const report = await page.evaluate(async ({ bpm, bars }) => {
    const { createLookaheadScheduler } = await import('/src/shared/audio/lookaheadScheduler.js')
    const { scheduleClick } = await import('/src/shared/audio/clickVoices.js')
    const { createPassSource } = await import('/src/tools/rhythm-dice/timeline.js')
    const { METRES } = await import('/src/tools/rhythm-dice/rhythm.js')
    const { LEVELS } = await import('/src/tools/rhythm-dice/faces.js')

    const metre = METRES['4/4']
    const crotchet = LEVELS[0].faces[0]
    const startTime = 0.05
    const sampleRate = 48000
    const duration = startTime + (bars * metre.dice * 60) / bpm + 0.2
    const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate)

    const grid = []
    let now = 0
    let tick = null
    const source = createPassSource({ faces: [crotchet, crotchet, crotchet, crotchet], metre, bpm, startTime, countIn: false, passes: bars })
    const scheduler = createLookaheadScheduler({
      clock: () => now,
      source,
      schedule: e => {
        if (e.kind !== 'click') return
        grid.push(e.time)
        scheduleClick(ctx, e.time, e.level)
      },
      setIntervalFn: fn => { tick = fn; return 1 },
      clearIntervalFn: () => { tick = null },
    })
    scheduler.start()
    while (tick) { now += 0.025; tick() }

    const data = (await ctx.startRendering()).getChannelData(0)
    // An onset: the first sample above the threshold when nothing has been
    // above it for 20 ms. (Each click lasts 50 ms; clicks here are 375 ms apart.)
    const onsets = []
    const gap = Math.round(0.02 * sampleRate)
    let lastLoud = -Infinity
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) <= 0.002) continue
      if (i - lastLoud > gap) onsets.push(i / sampleRate)
      lastLoud = i
    }
    return { grid, onsets }
  }, { bpm: BPM, bars: BARS })

  const { grid, onsets } = report
  const expectedCount = BARS * 4
  if (grid.length !== expectedCount) throw new Error(`Scheduler booked ${grid.length} clicks, expected ${expectedCount}`)
  if (onsets.length !== grid.length) throw new Error(`Found ${onsets.length} onsets in the audio for ${grid.length} scheduled clicks`)
  // Grid times must be exact multiples of the beat (no drift from repeated addition).
  const beat = 60 / BPM
  grid.forEach((t, i) => {
    if (Math.abs(t - (0.05 + i * beat)) > 1e-9) throw new Error(`Click ${i} was booked at ${t}, not on the grid`)
  })
  const errors = grid.map((t, i) => (onsets[i] - t) * 1000)
  const worst = errors.reduce((m, e) => (Math.abs(e) > Math.abs(m) ? e : m), 0)
  const late = errors.filter(e => Math.abs(e) > TOLERANCE_MS)
  console.log(`${grid.length} clicks over ${BARS} bars at ${BPM} BPM. Worst onset error ${worst.toFixed(3)} ms; mean ${(errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(3)} ms.`)
  if (late.length) {
    failed = true
    console.error(`${late.length} click(s) outside +/-${TOLERANCE_MS} ms`)
  } else {
    console.log(`PASS: every click within +/-${TOLERANCE_MS} ms of its grid time.`)
  }
} catch (err) {
  failed = true
  console.error(err)
} finally {
  await browser.close()
  server.close()
}
process.exit(failed ? 1 : 0)
