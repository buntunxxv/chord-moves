// Bar assembly: rolling dice, locking, tie rules, and the timeline that
// playback, scoring and MIDI export all read from. Pure functions only, so
// the rules are unit-tested without a browser.
import { LEVELS, SLOTS_PER_DIE, TICKS_PER_CROTCHET } from './faces.js'

// A metre is a list of dice and the length of each in ticks: 12 for a
// crotchet die, 18 for a dotted-crotchet (compound) die. 7/8 mixes them,
// grouped 2+2+3.
//
// BPM always counts the beat unit (`unitTicks`): the crotchet in simple
// metres, the dotted crotchet in compound, the quaver in 7/8. MIDI tempo is
// always written in crotchets per minute, so it is BPM x unitTicks / 12:
// simple x1, compound x1.5 (6/8 at 120 = 180), 7/8 /2 (quavers to crotchets).
//
// `pro`: compound and irregular metres need Pro (Decisions, 15 Nov).
function metre(id, dieTicks, timeSignature, unitTicks, extra = {}) {
  const uniform = dieTicks.every(t => t === dieTicks[0])
  return {
    id,
    dieTicks,
    dice: dieTicks.length,
    beatTicks: uniform ? dieTicks[0] : null,
    timeSignature,
    unitTicks,
    midiTempoFactor: unitTicks / TICKS_PER_CROTCHET,
    pro: false,
    ...extra,
  }
}
const simple = beats => metre(`${beats}/4`, Array(beats).fill(12), [beats, 4], 12)
const compound = beats => metre(`${beats * 3}/8`, Array(beats).fill(18), [beats * 3, 8], 18, { pro: true, compound: true })

export const METRES = {
  '2/4': simple(2),
  '3/4': simple(3),
  '4/4': simple(4),
  '5/4': simple(5),
  '6/8': compound(2),
  '9/8': compound(3),
  '12/8': compound(4),
  '7/8': metre('7/8', [12, 12, 18], [7, 8], 6, { pro: true, grouping: '2+2+3' }),
}
export const SIMPLE_METRE_IDS = ['2/4', '3/4', '4/4', '5/4']
export const COMPOUND_METRE_IDS = ['6/8', '9/8', '12/8']
export const METRE_IDS = [...SIMPLE_METRE_IDS, ...COMPOUND_METRE_IDS, '7/8']

// Where each die starts, in ticks from the downbeat.
export function dieStarts(m) {
  const starts = []
  let pos = 0
  for (const t of m.dieTicks) { starts.push(pos); pos += t }
  return starts
}

// Which die a tick falls in, and how far into it.
export function dieAt(m, tick) {
  const starts = dieStarts(m)
  let die = starts.length - 1
  while (die > 0 && starts[die] > tick) die -= 1
  return { die, within: tick - starts[die], size: m.dieTicks[die] }
}

// Count-in length: one bar, except that one bar of 2/4 is only two clicks,
// too short to settle a tempo -- 2/4 counts in two bars (four clicks).
export function countInBars(metre) {
  return metre.dice < 3 ? 2 : 1
}

export function midiTempo(metre, bpm) {
  return bpm * metre.midiTempoFactor
}

export function secondsPerTick(metre, bpm) {
  // One counted unit lasts 60/bpm seconds and holds metre.unitTicks ticks.
  return 60 / bpm / metre.unitTicks
}

// "Mix levels" pools every chosen level's slots into one bag, so a face that
// appears on two levels is that much more likely.
export function slotPool(levelIds, levels = LEVELS) {
  const slots = []
  for (const id of levelIds) {
    const lvl = levels.find(l => l.id === id)
    if (!lvl) throw new Error(`Unknown level ${id}`)
    if (lvl.faces.length !== SLOTS_PER_DIE) throw new Error(`${id} must have ${SLOTS_PER_DIE} slots`)
    slots.push(...lvl.faces)
  }
  return slots
}

const isTieOutFace = face => face.events.at(-1)?.tieOut === true

// Rolls one die. A tie-out face can't land on a bar's last die, so for that
// position the roll is uniform over the remaining slots instead.
export function rollDie(pool, { isLastDie, rng = Math.random }) {
  const eligible = isLastDie ? pool.filter(f => !isTieOutFace(f)) : pool
  if (!eligible.length) throw new Error('No face can be rolled here')
  return eligible[Math.min(eligible.length - 1, Math.floor(rng() * eligible.length))]
}

// Re-roll: locked positions keep their face, everything else rolls fresh.
// `current` may be null for the first roll. `pool` is one bag of faces for
// every die, or a function (dieIndex) => bag when dice differ, as in 7/8
// (crotchet dice draw simple faces; the dotted-crotchet die compound ones).
export function rollBar(pool, metre, { current = null, locked = [], rng = Math.random } = {}) {
  const poolFor = typeof pool === 'function' ? pool : () => pool
  return Array.from({ length: metre.dice }, (_, i) => {
    if (current && locked[i]) return current[i]
    return rollDie(poolFor(i), { isLastDie: i === metre.dice - 1, rng })
  })
}

// Which ties actually sound. A tie-out holds into the next die's first note,
// so it is dropped when it is on the last die (no ties across bars or loop
// repeats) or when the next die opens with a rest. Returns one boolean per
// die: does this die's tie-out apply?
export function resolveTies(faces) {
  return faces.map((face, i) => {
    if (!isTieOutFace(face)) return false
    const next = faces[i + 1]
    if (!next) return false
    return next.events[0].type === 'note'
  })
}

// Flattens a bar into absolute events. Each event:
//   { die, index, type, start, ticks, onset, tiedIn, tiedOut, beatStart }
// `onset` is false for rests and for a note that is the sustained end of a
// tie -- tied sustains are not onsets, so scoring never expects a tap there.
export function barEvents(faces, metre) {
  const ties = resolveTies(faces)
  const events = []
  const starts = dieStarts(metre)
  faces.forEach((face, die) => {
    let pos = starts[die]
    face.events.forEach((e, index) => {
      const tiedIn = index === 0 && die > 0 && ties[die - 1] === true
      const tiedOut = index === face.events.length - 1 && ties[die] === true
      events.push({
        die,
        index,
        type: e.type,
        start: pos,
        ticks: e.ticks,
        onset: e.type === 'note' && !tiedIn,
        tiedIn,
        tiedOut,
        beatStart: pos === starts[die],
      })
      pos += e.ticks
    })
  })
  return events
}

export function barTicks(metre) {
  return metre.dieTicks.reduce((a, b) => a + b, 0)
}

// Sounding notes with ties merged: one { start, ticks } per onset, lasting
// through every tied continuation. This is what playback and MIDI use.
export function soundingNotes(faces, metre) {
  const notes = []
  for (const e of barEvents(faces, metre)) {
    if (e.type !== 'note') continue
    if (e.tiedIn && notes.length) notes.at(-1).ticks += e.ticks
    else notes.push({ start: e.start, ticks: e.ticks })
  }
  return notes
}

export function onsetTicks(faces, metre) {
  return barEvents(faces, metre).filter(e => e.onset).map(e => e.start)
}

export function isAllRest(faces) {
  return faces.every(f => f.events.every(e => e.type === 'rest'))
}

// Smallest tick group that every event boundary in these faces falls on --
// the cell size of the blocks view (3 for semiquaver levels, 6 for L1).
export function blockUnit(faces) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a)
  return faces.flatMap(f => f.events.map(e => e.ticks)).reduce(gcd)
}

// One die's cell size in the blocks view. Faces on the semiquaver grid keep
// 3-tick cells (so a crotchet still reads as one attack and three sustains);
// triplet faces use 4-tick cells (three per beat) and sextuplets 2-tick cells
// (six per beat), so the blocks show how the beat is divided.
export function faceUnit(face) {
  if (face.events.every(e => e.ticks % 3 === 0)) return 3
  return blockUnit([face])
}

// Blocks view: one cell per tick group, each attack / sustain / rest.
export function faceBlocks(face, unit, { tiedIn = false, tiedOut = false } = {}) {
  const cells = []
  face.events.forEach((e, index) => {
    const count = e.ticks / unit
    for (let k = 0; k < count; k++) {
      const continuesTie = index === 0 && tiedIn
      cells.push({
        state: e.type === 'rest' ? 'rest' : k === 0 && !continuesTie ? 'attack' : 'sustain',
        tieOut: tiedOut && index === face.events.length - 1 && k === count - 1,
      })
    }
  })
  return cells
}

export { TICKS_PER_CROTCHET }
