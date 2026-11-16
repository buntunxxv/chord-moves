// Bar assembly: rolling dice, locking, tie rules, and the timeline that
// playback, scoring and MIDI export all read from. Pure functions only, so
// the rules are unit-tested without a browser.
import { LEVELS, SLOTS_PER_DIE, TICKS_PER_CROTCHET } from './faces.js'

// A metre names how many dice make a bar and how long each beat is.
// BPM always counts the beat unit; MIDI tempo is always written in
// crotchets per minute (compound: BPM x 1.5; 7/8: BPM / 2 -- later PRs).
const simple = beats => ({ id: `${beats}/4`, dice: beats, beatTicks: 12, timeSignature: [beats, 4], midiTempoFactor: 1 })
export const METRES = {
  '2/4': simple(2),
  '3/4': simple(3),
  '4/4': simple(4),
  '5/4': simple(5),
}
export const SIMPLE_METRE_IDS = ['2/4', '3/4', '4/4', '5/4']

// Count-in length: one bar, except that one bar of 2/4 is only two clicks,
// too short to settle a tempo -- 2/4 counts in two bars (four clicks).
export function countInBars(metre) {
  return metre.dice < 3 ? 2 : 1
}

export function midiTempo(metre, bpm) {
  return bpm * metre.midiTempoFactor
}

export function secondsPerTick(metre, bpm) {
  // One beat lasts 60/bpm seconds and holds metre.beatTicks ticks.
  return 60 / bpm / metre.beatTicks
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
// `current` may be null for the first roll.
export function rollBar(pool, metre, { current = null, locked = [], rng = Math.random } = {}) {
  return Array.from({ length: metre.dice }, (_, i) => {
    if (current && locked[i]) return current[i]
    return rollDie(pool, { isLastDie: i === metre.dice - 1, rng })
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
  faces.forEach((face, die) => {
    let pos = die * metre.beatTicks
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
        beatStart: pos % metre.beatTicks === 0,
      })
      pos += e.ticks
    })
  })
  return events
}

export function barTicks(metre) {
  return metre.dice * metre.beatTicks
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
