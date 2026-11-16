// What sounds when, for one pass through the bar. Pure: the audio engine
// pulls these events through the shared lookahead scheduler.
import { barEvents, barTicks, countInBars, dieStarts, secondsPerTick, soundingNotes } from './rhythm.js'

// A click on every die (the beats; in 7/8 the 2+2+3 groups), the downbeat
// accented. `subdivision` (ticks: 6 quavers, 4 triplets, 3 semiquavers, 0
// off) adds quieter clicks inside each die it divides evenly -- triplets
// don't divide a dotted-crotchet beat, so compound dice skip them.
export function clickEvents(metre, bpm, barStart, subdivision = 0) {
  const spt = secondsPerTick(metre, bpm)
  const events = []
  dieStarts(metre).forEach((start, die) => {
    const size = metre.dieTicks[die]
    const step = subdivision && size % subdivision === 0 ? subdivision : size
    for (let within = 0; within < size; within += step) {
      const tick = start + within
      events.push({
        time: barStart + tick * spt,
        kind: 'click',
        level: tick === 0 ? 'accent' : within === 0 ? 'beat' : 'sub',
        beat: within === 0 ? die : null,
      })
    }
  })
  return events
}

export function clapEvents(faces, metre, bpm, barStart) {
  const spt = secondsPerTick(metre, bpm)
  return soundingNotes(faces, metre).map(n => ({ time: barStart + n.start * spt, kind: 'clap' }))
}

// Expected onsets for scoring, in seconds from the bar's downbeat.
export function expectedOnsets(faces, metre, bpm, { bar = 0 } = {}) {
  const spt = secondsPerTick(metre, bpm)
  const offset = bar * barSeconds(metre, bpm)
  return barEvents(faces, metre)
    .filter(e => e.onset)
    .map(e => ({ time: offset + e.start * spt, offbeat: !e.beatStart, tick: e.start, bar }))
}

// A phrase is scored as one sequence: every bar's onsets, each shifted by its
// bar's start, so the matching window between the last note of one bar and
// the first of the next follows the same rule as within a bar.
export function phraseOnsets(bars, metre, bpm) {
  return bars.flatMap((faces, bar) => expectedOnsets(faces, metre, bpm, { bar }))
}

// Where one bar's taps stop and the next bar's begin, as seconds after the
// first bar's downbeat: halfway between this bar's last onset and the next
// bar's first. A bar with no onsets ends on its own barline. The last bar
// keeps a short tail after its barline. `bars` is a list of onset lists, each
// relative to its own downbeat.
export function barBoundaries(barOnsets, barSec, tail = 0.1) {
  return barOnsets.map((onsets, i) => {
    const barStart = i * barSec
    const next = barOnsets[i + 1]
    if (!next) return barStart + barSec + tail
    if (!onsets.length || !next.length) return barStart + barSec
    return barStart + (onsets.at(-1).time + barSec + next[0].time) / 2
  })
}

export function barSeconds(metre, bpm) {
  return barTicks(metre) * secondsPerTick(metre, bpm)
}

// An endless (or `passes`-long) source for the lookahead scheduler:
// one count-in bar, then the bar repeated. Count-in clicks every beat with an
// accented downbeat; bars click with the optional subdivision; claps are
// added when `claps` is true ("hear it first").
// `faces` is one bar's faces, or a function (pass) => faces for sources whose
// bars change: a phrase, or read-ahead, where the next bar is rolled while the
// current one plays. `countIn` is a number of bars (true = the metre's usual).
export function createPassSource({ faces, metre, bpm, startTime, countIn = true, subdivision = 0, claps = false, passes = Infinity, onBarStart }) {
  const bar = barSeconds(metre, bpm)
  const facesFor = typeof faces === 'function' ? faces : () => faces
  const countInCount = countIn === true ? countInBars(metre) : Number(countIn) || 0
  let queue = []
  let pass = 0
  let nextBarStart = startTime

  for (let c = 0; c < countInCount; c++) {
    queue.push(...clickEvents(metre, bpm, nextBarStart, 0).map(e => ({ ...e, countIn: true })))
    nextBarStart += bar
  }

  function refill() {
    if (pass >= passes) return
    const barStart = nextBarStart
    const events = [
      { time: barStart, kind: 'bar', pass, barStart },
      ...clickEvents(metre, bpm, barStart, subdivision),
      ...(claps ? clapEvents(facesFor(pass), metre, bpm, barStart) : []),
    ].sort((a, b) => a.time - b.time || order(a) - order(b))
    queue.push(...events)
    onBarStart?.(pass, barStart)
    pass += 1
    nextBarStart += bar
  }

  return {
    next() {
      if (!queue.length) refill()
      return queue.shift() ?? null
    },
    get endTime() { return passes === Infinity ? Infinity : startTime + (countInCount + passes) * bar },
    get firstBar() { return startTime + countInCount * bar },
  }
}

const order = e => (e.kind === 'bar' ? 0 : e.kind === 'click' ? 1 : 2)

// Latency calibration: the median gap between each tap and the click it
// answers. The median ignores the odd stray tap. Positive = taps register
// late (the usual case: output + touch latency).
export function calibrationOffset(tapTimes, clickTimes) {
  const offsets = tapTimes.map(t => {
    let best = Infinity
    for (const c of clickTimes) if (Math.abs(t - c) < Math.abs(best)) best = t - c
    return best
  }).filter(Number.isFinite)
  if (!offsets.length) return null
  return median(offsets)
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
