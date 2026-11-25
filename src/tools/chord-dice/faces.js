// Chord Dice faces. Three dice: Root, Quality, Colour. A roll picks one
// allowed (quality, colour) pair and a root from the level's pool; Tonal
// turns the result into a spelled chord. The Bass die arrives with Level 5.
//
// Root spellings follow Chord Moves and the founder's Phase 0 approval
// (25 Nov 2026): C, C#, D, Eb, E, F, F#, G, G#, A, Bb, B. Enharmonic answers
// are still accepted, because answers are compared by pitch class.
import { Chord, Note } from 'tonal'

export const L1_ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
export const L2_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B']

// Two dice, two jobs (founder decision, 25 Nov, PR 2):
//   Quality = how the triad is built: its middle note and its fifth. A sus
//             chord replaces the third, so sus2 and sus4 are qualities.
//   Colour  = a note added on top (7, maj7, add9 …). It has no faces until
//             Level 4, so the tray leaves it out until then.
export const QUALITIES = {
  major: { id: 'major', label: 'major', word: 'major', suffix: '', middle: { interval: '3M', name: 'major third' }, fifth: { interval: '5P', name: 'perfect fifth' } },
  minor: { id: 'minor', label: 'minor', word: 'minor', suffix: 'm', middle: { interval: '3m', name: 'minor third' }, fifth: { interval: '5P', name: 'perfect fifth' } },
  dim: { id: 'dim', label: 'dim', word: 'diminished', suffix: 'dim', middle: { interval: '3m', name: 'minor third' }, fifth: { interval: '5d', name: 'diminished fifth' } },
  aug: { id: 'aug', label: 'aug', word: 'augmented', suffix: 'aug', middle: { interval: '3M', name: 'major third' }, fifth: { interval: '5A', name: 'augmented fifth' } },
  sus2: { id: 'sus2', label: 'sus2', word: 'sus2', suffix: 'sus2', middle: { interval: '2M', name: 'major second' }, fifth: { interval: '5P', name: 'perfect fifth' } },
  sus4: { id: 'sus4', label: 'sus4', word: 'sus4', suffix: 'sus4', middle: { interval: '4P', name: 'perfect fourth' }, fifth: { interval: '5P', name: 'perfect fifth' } },
}

// Colours arrive with Level 4. Until then every chord's colour is "none".
export const COLOURS = {
  none: { id: 'none', label: 'none', suffix: '' },
}

const TRIADS = [['major', 'none'], ['minor', 'none']]
export const LEVELS = {
  L1: { id: 'L1', name: 'Level 1', roots: L1_ROOTS, tuples: TRIADS },
  L2: { id: 'L2', name: 'Level 2', roots: L2_ROOTS, tuples: TRIADS },
  // Level 3: diminished, augmented, sus2 and sus4, on all 12 roots (48).
  L3: { id: 'L3', name: 'Level 3', roots: L2_ROOTS, tuples: [['dim', 'none'], ['aug', 'none'], ['sus2', 'none'], ['sus4', 'none']] },
}

// The level switch. Mix rolls one of Levels 1–3 with equal chance, then a
// chord from that level, as Mix pools levels in Rhythm Dice.
// Feedback: Levels 1–2 reflect on each note as it is placed; from Level 3
// (and in Mix, which includes it) the keyboard stays neutral until Submit,
// so the feedback style itself never hints at which level a chord is from.
export const LEVEL_CHOICES = [
  { key: 'L1', label: '1', name: 'Level 1', levelIds: ['L1'], feedback: 'note' },
  { key: 'L2', label: '2', name: 'Level 2', levelIds: ['L2'], feedback: 'note' },
  { key: 'L3', label: '3', name: 'Level 3', levelIds: ['L3'], feedback: 'submit' },
  { key: 'mix', label: 'Mix', name: 'Mix levels 1 to 3', levelIds: ['L1', 'L2', 'L3'], feedback: 'submit' },
]
export const LEVEL_KEYS = LEVEL_CHOICES.map(c => c.key)
export const levelChoice = key => LEVEL_CHOICES.find(c => c.key === key) ?? LEVEL_CHOICES[0]
export const feedbackStyle = key => levelChoice(key).feedback

// ASCII spelling -> display spelling (♯ ♭ 𝄪 𝄫).
// Only the letter's own accidentals change, so a suffix is left alone.
// (No regex lookbehind: older iPad Safari cannot parse it.)
const ACCIDENTAL_GLYPHS = { '': '', '#': '♯', '##': '𝄪', b: '♭', bb: '𝄫' }
export function displayNote(name) {
  const m = /^([A-G])(##|#|bb|b)?(.*)$/.exec(String(name))
  if (!m) return String(name)
  return m[1] + ACCIDENTAL_GLYPHS[m[2] ?? ''] + m[3]
}

// Every outcome a level can roll, as { root, quality, colour, levelId }.
export function outcomes(levelId) {
  const level = LEVELS[levelId]
  return level.roots.flatMap(root => level.tuples.map(([quality, colour]) => ({ root, quality, colour, levelId })))
}

const sameChord = (a, b) => a && b && a.root === b.root && a.quality === b.quality && (a.colour ?? 'none') === (b.colour ?? 'none')

// Every distinct chord a level choice can give (Mix: Levels 1–3 together).
export function poolFor(levelKey) {
  const seen = []
  for (const levelId of levelChoice(levelKey).levelIds) {
    for (const o of outcomes(levelId)) if (!seen.some(s => sameChord(s, o))) seen.push(o)
  }
  return seen
}

export const isAllowed = (outcome, levelKey) => poolFor(levelKey).some(o => sameChord(o, outcome))

// A rolled outcome -> the chord the student builds.
//   symbol   'F#m'        (ASCII, as Tonal reads it)
//   name     'F♯m'        (display)
//   prose    'F♯ minor'   (how sentences say it)
//   notes    ['F#','A','C#']  spelled chord tones, root first
//   chromas  [6, 9, 1]    pitch classes, same order
//   roles    [{ interval:'1P', name:'root' }, ...]
export function resolveChord({ root, quality, colour = 'none' }) {
  const q = QUALITIES[quality]
  const c = COLOURS[colour]
  if (!q || !c) throw new Error(`Unknown face ${quality}/${colour}`)
  const middle = q.middle
  const symbol = root + q.suffix + c.suffix
  const chord = Chord.get(symbol)
  if (chord.empty) throw new Error(`Tonal has no chord ${symbol}`)
  const roles = [{ interval: '1P', name: 'root' }, middle, q.fifth]
  const notes = roles.map(r => Note.transpose(root, r.interval))
  return {
    root,
    quality,
    colour,
    symbol,
    name: displayNote(symbol),
    prose: `${displayNote(root)} ${q.word}`,
    notes,
    chromas: notes.map(n => Note.chroma(n)),
    roles,
    tonalNotes: chord.notes,
  }
}

// Roll one chord. Avoids repeating the chord already on the table.
export function rollChord(levelKey, { rng = Math.random, avoid = null } = {}) {
  const choice = levelChoice(levelKey)
  for (let tries = 0; ; tries++) {
    const levelId = choice.levelIds[Math.floor(rng() * choice.levelIds.length)]
    const pool = outcomes(levelId)
    const pick = pool[Math.floor(rng() * pool.length)]
    if (tries < 8 && sameChord(pick, avoid)) continue
    return { ...pick, levelKey: choice.key }
  }
}

// ---------- Change one die ----------

export const DICE = ['root', 'quality', 'colour']
export const DIE_NAMES = { root: 'Root', quality: 'Quality', colour: 'Colour' }

// The dice on the tray: the Colour die joins once a level gives it a face
// other than "none" (Level 4).
export const diceFor = levelKey =>
  poolFor(levelKey).some(o => o.colour !== 'none') ? DICE : DICE.filter(d => d !== 'colour')

// The faces this die could change to while the other two dice stay put,
// using only chords the level allows.
export function alternatives(outcome, die, levelKey) {
  return poolFor(levelKey).filter(o =>
    o[die] !== outcome[die] && DICE.every(d => d === die || o[d] === outcome[d]))
}

// Re-roll one die, keeping the others. When nothing else fits, say which
// other die to change first, rather than silently changing two.
export function changeOneDie(outcome, die, levelKey, { rng = Math.random } = {}) {
  const options = alternatives(outcome, die, levelKey)
  if (options.length) {
    const pick = options[Math.floor(rng() * options.length)]
    return { outcome: { ...pick, levelKey } }
  }
  const others = DICE.filter(d => d !== die && d !== 'root')
  const freedBy = others.find(other => poolFor(levelKey).some(o =>
    o.root === outcome.root && o[die] !== outcome[die] && o[other] !== outcome[other]))
  const face = die === 'colour' ? COLOURS[outcome.colour].label : QUALITIES[outcome.quality].label
  if (freedBy) {
    return { blocked: `Nothing else on the ${DIE_NAMES[die]} die fits with ${freedBy === 'colour' ? `the ${COLOURS[outcome.colour].label} colour` : `a ${QUALITIES[outcome.quality].word} chord`} here. Change the ${DIE_NAMES[freedBy]} first.` }
  }
  return { blocked: `The ${DIE_NAMES[die]} die has only “${face}” at this level. Change the Root or the ${DIE_NAMES[die === 'colour' ? 'quality' : 'colour']} instead, or move up a level.` }
}
