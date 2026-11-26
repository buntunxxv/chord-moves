// Scoring a performed bar against the rolled rhythm.
//
// Times are seconds on the audio clock, measured from the bar's downbeat,
// with the device's latency calibration already applied to the taps.
//
// Rules (Phase 0, 15 Nov 2026):
// - One-to-one matching: each expected onset takes at most one tap, nearest
//   pair first. Unmatched taps are extras; unmatched onsets are missed.
// - Each onset's window = min(100 ms, 45% of the gap to its nearest
//   neighbouring onset), so fast figures never let one tap count twice.
// - Tied sustains are not onsets (barEvents already excludes them).
// - An all-rest bar: every tap is an extra.
//
// Accuracy and consistency are reported separately: accuracy is how many of
// the bar's hits you caught, consistency is how tightly your hits clustered.

export const MAX_WINDOW_S = 0.1
export const NEIGHBOUR_FRACTION = 0.45
// Offsets inside this are "on the grid" for the reflection sentence.
export const ON_GRID_S = 0.02

export function onsetWindows(onsetTimes) {
  return onsetTimes.map((t, i) => {
    const gaps = []
    if (i > 0) gaps.push(t - onsetTimes[i - 1])
    if (i < onsetTimes.length - 1) gaps.push(onsetTimes[i + 1] - t)
    const nearest = gaps.length ? Math.min(...gaps) : Infinity
    return Math.min(MAX_WINDOW_S, NEIGHBOUR_FRACTION * nearest)
  })
}

// expected: [{ time, offbeat }] sorted by time. taps: [seconds].
export function scoreBar(expected, taps) {
  const windows = onsetWindows(expected.map(e => e.time))
  const pairs = []
  expected.forEach((e, oi) => {
    taps.forEach((t, ti) => {
      const offset = t - e.time
      if (Math.abs(offset) <= windows[oi] + 1e-9) pairs.push({ oi, ti, offset })
    })
  })
  pairs.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) || a.oi - b.oi)

  const onsetTaken = new Map()
  const tapTaken = new Set()
  for (const p of pairs) {
    if (onsetTaken.has(p.oi) || tapTaken.has(p.ti)) continue
    onsetTaken.set(p.oi, p)
    tapTaken.add(p.ti)
  }

  const hits = expected.map((e, oi) => {
    const p = onsetTaken.get(oi)
    return {
      time: e.time,
      offbeat: !!e.offbeat,
      window: windows[oi],
      tap: p ? taps[p.ti] : null,
      offset: p ? p.offset : null,
    }
  })
  const extras = taps.filter((_, ti) => !tapTaken.has(ti))
  const matched = hits.filter(h => h.offset !== null)
  const missed = hits.length - matched.length
  const offsets = matched.map(h => h.offset)

  const denominator = expected.length + extras.length
  const accuracy = denominator === 0 ? 1 : matched.length / denominator

  return {
    hits,
    extras,
    matched: matched.length,
    missed,
    expectedCount: expected.length,
    accuracy,
    meanOffset: offsets.length ? mean(offsets) : null,
    // Spread: standard deviation of your offsets. Needs two hits to mean anything.
    spread: offsets.length >= 2 ? stdDev(offsets) : null,
    allRest: expected.length === 0,
  }
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdDev(xs) {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length)
}

function leaning(hits) {
  const early = hits.filter(h => h.offset < -ON_GRID_S).length
  const late = hits.filter(h => h.offset > ON_GRID_S).length
  if (hits.length >= 2 && early / hits.length > 0.5) return 'early'
  if (hits.length >= 2 && late / hits.length > 0.5) return 'late'
  return null
}

// One reflection sentence, picked from the dominant pattern. Framed as
// something to listen for next time, never as a grade.
export function reflect(result) {
  if (result.allRest) return 'This bar was silence. Did you hold it?'
  if (result.matched === 0 && result.extras.length === 0) return 'No taps reached the bar this time. Listen through the count-in and come in on one.'
  if (result.missed * 2 >= result.expectedCount) return 'More than half the notes slipped past. Try it slower and say the rhythm before you tap it.'
  if (result.extras.length >= 2 && result.extras.length > result.missed) return 'You tapped more notes than the bar holds. Where did the extra ones come from?'

  const matched = result.hits.filter(h => h.offset !== null)
  const offbeats = matched.filter(h => h.offbeat)
  const beats = matched.filter(h => !h.offbeat)
  const offLean = leaning(offbeats)
  const beatLean = leaning(beats)
  if (offLean && offLean !== beatLean) return `Most of your offbeats landed ${offLean}.`
  if (beatLean && beatLean !== offLean) return `Most of your on-beat hits landed ${beatLean}.`
  if (offLean) return `Most of your hits landed ${offLean}.`

  if (result.spread !== null && result.spread > 0.03) return 'Your average was close to the grid, but the hits spread out. Which notes felt unsure?'
  if (result.missed > 0) return `You caught most of it. Which ${result.missed === 1 ? 'note' : `${result.missed} notes`} got away?`
  return 'That sat on the grid. What did you listen for?'
}

export function formatOffsetMs(offset) {
  const ms = Math.round(offset * 1000)
  if (ms === 0) return 'on time'
  return ms < 0 ? `${-ms} ms early` : `${ms} ms late`
}

// A device's own delay (touchscreen, speaker, Bluetooth) shifts every tap by
// the same amount, often past the 100 ms window, so a bar played well scores
// as all misses and extras. detectLag spots that: the taps sit a steady
// distance from the onsets, and allowing for it catches clearly more notes.
// Returns the shift in seconds (positive = taps land late), or null.
// A person's own lean is small and uneven; a device's is large and steady.
export const LAG_MIN_S = 0.06
export const LAG_MAX_S = 0.5
const LAG_STEADY_S = 0.05

export function detectLag(expected, taps) {
  if (expected.length < 2 || taps.length < 3) return null
  const times = expected.map(e => e.time)
  const offsets = taps.map(t => {
    let best = Infinity
    for (const o of times) if (Math.abs(t - o) < Math.abs(best)) best = t - o
    return best
  }).filter(d => Math.abs(d) <= LAG_MAX_S)
  if (offsets.length < 3) return null
  const sorted = [...offsets].sort((a, b) => a - b)
  const lag = sorted[Math.floor(sorted.length / 2)]
  if (Math.abs(lag) < LAG_MIN_S) return null
  const spread = [...offsets.map(d => Math.abs(d - lag))].sort((a, b) => a - b)[Math.floor(offsets.length / 2)]
  if (spread > LAG_STEADY_S) return null
  const before = scoreBar(expected, taps).matched
  const after = scoreBar(expected, taps.map(t => t - lag)).matched
  return after >= before + 2 && after >= Math.ceil(expected.length * 0.6) ? lag : null
}
