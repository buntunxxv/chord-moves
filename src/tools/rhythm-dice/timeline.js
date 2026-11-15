// What sounds when, for one pass through the bar. Pure: the audio engine
// pulls these events through the shared lookahead scheduler.
import { barEvents, barTicks, secondsPerTick, soundingNotes } from './rhythm.js'

// subdivision: 0 (off), 6 (quavers) or 3 (semiquavers), in ticks.
export function clickEvents(metre, bpm, barStart, subdivision = 0) {
  const spt = secondsPerTick(metre, bpm)
  const events = []
  const step = subdivision || metre.beatTicks
  for (let tick = 0; tick < barTicks(metre); tick += step) {
    const onBeat = tick % metre.beatTicks === 0
    events.push({
      time: barStart + tick * spt,
      kind: 'click',
      level: tick === 0 ? 'accent' : onBeat ? 'beat' : 'sub',
      beat: onBeat ? tick / metre.beatTicks : null,
    })
  }
  return events
}

export function clapEvents(faces, metre, bpm, barStart) {
  const spt = secondsPerTick(metre, bpm)
  return soundingNotes(faces, metre).map(n => ({ time: barStart + n.start * spt, kind: 'clap' }))
}

// Expected onsets for scoring, in seconds from the bar's downbeat.
export function expectedOnsets(faces, metre, bpm) {
  const spt = secondsPerTick(metre, bpm)
  return barEvents(faces, metre)
    .filter(e => e.onset)
    .map(e => ({ time: e.start * spt, offbeat: !e.beatStart, tick: e.start }))
}

export function barSeconds(metre, bpm) {
  return barTicks(metre) * secondsPerTick(metre, bpm)
}

// An endless (or `passes`-long) source for the lookahead scheduler:
// one count-in bar, then the bar repeated. Count-in clicks every beat with an
// accented downbeat; bars click with the optional subdivision; claps are
// added when `claps` is true ("hear it first").
export function createPassSource({ faces, metre, bpm, startTime, countIn = true, subdivision = 0, claps = false, passes = Infinity, onBarStart }) {
  const bar = barSeconds(metre, bpm)
  let queue = []
  let pass = 0
  let nextBarStart = startTime

  if (countIn) {
    queue.push(...clickEvents(metre, bpm, startTime, 0).map(e => ({ ...e, countIn: true })))
    nextBarStart += bar
  }

  function refill() {
    if (pass >= passes) return
    const barStart = nextBarStart
    const events = [
      { time: barStart, kind: 'bar', pass, barStart },
      ...clickEvents(metre, bpm, barStart, subdivision),
      ...(claps ? clapEvents(faces, metre, bpm, barStart) : []),
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
    get endTime() { return passes === Infinity ? Infinity : startTime + (countIn ? bar : 0) + passes * bar },
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
