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
//   Colour  = a note added on top (7, 9, add9). It has no faces until
//             Level 4, so the tray leaves it out until then.
// The dice read the way a chord is said (founder decision, 26 Nov): major·7
// is a major seventh, dom·7 a dominant seventh, minor·7 a minor seventh. So
// "dominant" is a quality (a major triad that takes a minor seventh), and
// it only ever comes with a colour.
export const QUALITIES = {
  major: { id: 'major', label: 'major', word: 'major', suffix: '', middle: { interval: '3M', name: 'major third' }, fifth: { interval: '5P', name: 'perfect fifth' } },
  minor: { id: 'minor', label: 'minor', word: 'minor', suffix: 'm', middle: { interval: '3m', name: 'minor third' }, fifth: { interval: '5P', name: 'perfect fifth' } },
  dim: { id: 'dim', label: 'dim', word: 'diminished', suffix: 'dim', middle: { interval: '3m', name: 'minor third' }, fifth: { interval: '5d', name: 'diminished fifth' } },
  aug: { id: 'aug', label: 'aug', word: 'augmented', suffix: 'aug', middle: { interval: '3M', name: 'major third' }, fifth: { interval: '5A', name: 'augmented fifth' } },
  sus2: { id: 'sus2', label: 'sus2', word: 'sus2', suffix: 'sus2', middle: { interval: '2M', name: 'major second' }, fifth: { interval: '5P', name: 'perfect fifth' } },
  sus4: { id: 'sus4', label: 'sus4', word: 'sus4', suffix: 'sus4', middle: { interval: '4P', name: 'perfect fourth' }, fifth: { interval: '5P', name: 'perfect fifth' } },
  dom: { id: 'dom', label: 'dom', word: 'dominant', suffix: '', middle: { interval: '3M', name: 'major third' }, fifth: { interval: '5P', name: 'perfect fifth' } },
}

// Colours arrive with Level 4: notes added on top of the triad (a seventh;
// at Level 5 a ninth, with or without the seventh). Until then every chord's
// colour is "none" and the Colour die stays off the tray.
const SEVENTH_m = { interval: '7m', name: 'minor seventh' }
const SEVENTH_M = { interval: '7M', name: 'major seventh' }
const NINTH = { interval: '9M', name: 'major ninth' }
export const COLOURS = {
  none: { id: 'none', label: 'none' },
  7: { id: '7', label: '7' },
  9: { id: '9', label: '9' },
  add9: { id: 'add9', label: 'add9' },
}

// Quality + Colour -> the chord. Only these pairs exist. The seventh a
// colour adds depends on the quality: major takes a major seventh, dominant
// and minor a minor seventh.
const COLOURED = {
  'major/7': { suffix: 'maj7', adds: [SEVENTH_M], name: 'major seventh' },
  'dom/7': { suffix: '7', adds: [SEVENTH_m], name: 'dominant seventh' },
  'minor/7': { suffix: 'm7', adds: [SEVENTH_m], name: 'minor seventh' },
  'major/9': { suffix: 'maj9', adds: [SEVENTH_M, NINTH], name: 'major ninth' },
  'dom/9': { suffix: '9', adds: [SEVENTH_m, NINTH], name: 'dominant ninth' },
  'minor/9': { suffix: 'm9', adds: [SEVENTH_m, NINTH], name: 'minor ninth' },
  'major/add9': { suffix: 'add9', adds: [NINTH], name: 'add9' },
  'minor/add9': { suffix: 'madd9', adds: [NINTH], name: 'minor add9' },
}

// The Bass die (Level 5): which note is lowest. A third or fifth bass is a
// chord tone already; the 2nd is a note from outside the chord, added below
// it (approved Phase 0). Unmarked means root position.
export const BASSES = {
  root: { id: 'root', label: 'root' },
  3: { id: '3', label: '3rd', role: 1 },
  5: { id: '5', label: '5th', role: 2 },
  2: { id: '2', label: '2nd', foreign: { interval: '2M', name: 'major second' } },
}

const TRIADS = [['major', 'none'], ['minor', 'none']]
// Level 5: triads over a 3rd, 5th or 2nd bass, and the ninths (root bass).
const L5_TUPLES = [
  ...['major', 'minor'].flatMap(q => ['3', '5', '2'].map(b => [q, 'none', b])),
  ['major', 'add9'], ['minor', 'add9'], ['dom', '9'], ['major', '9'], ['minor', '9'],
]
export const LEVELS = {
  L1: { id: 'L1', name: 'Level 1', roots: L1_ROOTS, tuples: TRIADS },
  L2: { id: 'L2', name: 'Level 2', roots: L2_ROOTS, tuples: TRIADS },
  // Level 3: diminished, augmented, sus2 and sus4, on all 12 roots (48).
  L3: { id: 'L3', name: 'Level 3', roots: L2_ROOTS, tuples: [['dim', 'none'], ['aug', 'none'], ['sus2', 'none'], ['sus4', 'none']] },
  // Level 4 (Pro): C7, Cmaj7, Cm7 on all 12 roots (36). Minor/maj7 and the
  // dim/aug sevenths stay out, as approved in Phase 0.
  L4: { id: 'L4', name: 'Level 4', roots: L2_ROOTS, tuples: [['dom', '7'], ['major', '7'], ['minor', '7']], pro: true },
  // Level 5 (Pro): slash bass and ninths on all 12 roots (132).
  L5: { id: 'L5', name: 'Level 5', roots: L2_ROOTS, tuples: L5_TUPLES, pro: true },
}

// The level switch. Mix rolls one of its levels with equal chance, then a
// chord from that level, as Mix pools levels in Rhythm Dice: Levels 1–3, and
// Levels 4–5 too with Pro. Levels 4–5 are Pro (shared Tools Pro, decided 25 Nov).
// Feedback: Levels 1–2 reflect on each note as it is placed; from Level 3
// (and in Mix, which includes it) the keyboard stays neutral until Submit,
// so the feedback style itself never hints at which level a chord is from.
export const LEVEL_CHOICES = [
  { key: 'L1', label: '1', name: 'Level 1', levelIds: ['L1'], feedback: 'note' },
  { key: 'L2', label: '2', name: 'Level 2', levelIds: ['L2'], feedback: 'note' },
  { key: 'L3', label: '3', name: 'Level 3', levelIds: ['L3'], feedback: 'submit' },
  { key: 'L4', label: '4', name: 'Level 4 (sevenths)', levelIds: ['L4'], feedback: 'submit', pro: true },
  { key: 'L5', label: '5', name: 'Level 5 (bass and ninths)', levelIds: ['L5'], feedback: 'submit', pro: true },
  { key: 'mix', label: 'Mix', name: 'Mix levels', levelIds: ['L1', 'L2', 'L3'], proLevelIds: ['L4', 'L5'], feedback: 'submit' },
]
export const LEVEL_KEYS = LEVEL_CHOICES.map(c => c.key)
export const levelChoice = key => LEVEL_CHOICES.find(c => c.key === key) ?? LEVEL_CHOICES[0]
export const feedbackStyle = key => levelChoice(key).feedback
export const needsPro = key => Boolean(levelChoice(key).pro)
// The levels a choice rolls from: Mix adds the Pro levels when Pro is on.
export const levelIdsFor = (key, isPro = false) => {
  const c = levelChoice(key)
  return isPro && c.proLevelIds ? [...c.levelIds, ...c.proLevelIds] : c.levelIds
}
// A chord from a Pro level (kept chords use this to gate "Hear").
export const isProChord = o => (o.colour ?? 'none') !== 'none' || (o.bass ?? 'root') !== 'root'

// ASCII spelling -> display spelling (♯ ♭ 𝄪 𝄫).
// Only the letter's own accidentals change, so a suffix is left alone.
// (No regex lookbehind: older iPad Safari cannot parse it.)
const ACCIDENTAL_GLYPHS = { '': '', '#': '♯', '##': '𝄪', b: '♭', bb: '𝄫' }
export function displayNote(name) {
  const m = /^([A-G])(##|#|bb|b)?(.*)$/.exec(String(name))
  if (!m) return String(name)
  return m[1] + ACCIDENTAL_GLYPHS[m[2] ?? ''] + m[3]
}

// Every outcome a level can roll, as { root, quality, colour, bass, levelId }.
export function outcomes(levelId) {
  const level = LEVELS[levelId]
  return level.roots.flatMap(root => level.tuples.map(([quality, colour, bass = 'root']) => ({ root, quality, colour, bass, levelId })))
}

const face = (o, die) => o[die] ?? (die === 'colour' ? 'none' : die === 'bass' ? 'root' : undefined)
const sameChord = (a, b) => a && b && ['root', 'quality', 'colour', 'bass'].every(d => face(a, d) === face(b, d))

// Every distinct chord a level choice can give (Mix: its levels together).
export function poolFor(levelKey, isPro = false) {
  const seen = []
  for (const levelId of levelIdsFor(levelKey, isPro)) {
    for (const o of outcomes(levelId)) if (!seen.some(s => sameChord(s, o))) seen.push(o)
  }
  return seen
}

export const isAllowed = (outcome, levelKey, isPro = false) => poolFor(levelKey, isPro).some(o => sameChord(o, outcome))

// A rolled outcome -> the chord the student builds.
//   symbol   'F#m'        (ASCII, as Tonal reads it)
//   name     'F♯m'        (display)
//   prose    'F♯ minor'   (how sentences say it)
//   notes    ['F#','A','C#']  spelled chord tones, root first
//   chromas  [6, 9, 1]    pitch classes, same order
//   roles    [{ interval:'1P', name:'root' }, ...]
//   bass     { degree:'3', note:'E', chroma:4, name:'major third' }
// A foreign bass (the 2nd) is part of the answer too: its role comes last.
export function resolveChord({ root, quality, colour = 'none', bass = 'root' }) {
  const q = QUALITIES[quality]
  const c = COLOURS[colour]
  const b = BASSES[bass]
  if (!q || !c || !b) throw new Error(`Unknown face ${quality}/${colour}/${bass}`)
  const coloured = colour === 'none' ? null : COLOURED[`${quality}/${colour}`]
  if (colour !== 'none' && !coloured) throw new Error(`No chord for ${quality}/${colour}`)
  if (colour === 'none' && quality === 'dom') throw new Error('A dominant chord needs its colour')
  if (bass !== 'root' && (colour !== 'none' || !['major', 'minor'].includes(quality))) throw new Error(`No slash chord for ${quality}/${colour}/${bass}`)
  const roles = [{ interval: '1P', name: 'root' }, q.middle, q.fifth, ...(coloured?.adds ?? [])]
  if (b.foreign) roles.push(b.foreign)
  const notes = roles.map(r => Note.transpose(root, r.interval))
  const bassIndex = b.foreign ? roles.length - 1 : b.role ?? 0
  const bassNote = notes[bassIndex]
  const symbol = root + (coloured ? coloured.suffix : q.suffix) + (bass === 'root' ? '' : `/${bassNote}`)
  const chord = Chord.get(symbol)
  if (chord.empty) throw new Error(`Tonal has no chord ${symbol}`)
  return {
    root,
    quality,
    colour,
    bass: { degree: bass, note: bassNote, chroma: Note.chroma(bassNote), name: roles[bassIndex].name, index: bassIndex },
    symbol,
    name: symbol.split('/').map(displayNote).join('/'),
    prose: `${displayNote(root)} ${coloured?.name ?? q.word}`,
    notes,
    chromas: notes.map(n => Note.chroma(n)),
    roles,
    tonalNotes: chord.notes,
  }
}

// Roll one chord. Avoids repeating the chord already on the table.
export function rollChord(levelKey, { rng = Math.random, avoid = null, isPro = false } = {}) {
  const choice = levelChoice(levelKey)
  const levelIds = levelIdsFor(levelKey, isPro)
  for (let tries = 0; ; tries++) {
    const levelId = levelIds[Math.floor(rng() * levelIds.length)]
    const pool = outcomes(levelId)
    const pick = pool[Math.floor(rng() * pool.length)]
    if (tries < 8 && sameChord(pick, avoid)) continue
    return { ...pick, levelKey: choice.key }
  }
}

// ---------- Change one die ----------

export const DICE = ['root', 'quality', 'colour', 'bass']
export const DIE_NAMES = { root: 'Root', quality: 'Quality', colour: 'Colour', bass: 'Bass' }

// The dice on the tray: the Colour die joins once a level gives it a face
// other than "none" (Level 4), the Bass die once a bass other than the root
// is possible (Level 5).
export const diceFor = (levelKey, isPro = false) => {
  const pool = poolFor(levelKey, isPro)
  return DICE.filter(d => (d !== 'colour' || pool.some(o => o.colour !== 'none')) && (d !== 'bass' || pool.some(o => o.bass !== 'root')))
}

// How a die's face reads in a sentence.
const faceWords = (die, o) => ({
  quality: `a ${QUALITIES[o.quality].word} chord`,
  colour: `the ${COLOURS[face(o, 'colour')].label} colour`,
  bass: face(o, 'bass') === 'root' ? 'the root in the bass' : `the ${BASSES[face(o, 'bass')].label} in the bass`,
})[die]
const faceLabel = (die, o) => ({
  quality: QUALITIES[o.quality].label, colour: COLOURS[face(o, 'colour')].label, bass: BASSES[face(o, 'bass')].label,
})[die]

// The faces this die could change to while the other two dice stay put,
// using only chords the level allows.
export function alternatives(outcome, die, levelKey, isPro = false) {
  return poolFor(levelKey, isPro).filter(o =>
    face(o, die) !== face(outcome, die) && DICE.every(d => d === die || face(o, d) === face(outcome, d)))
}

// Re-roll one die, keeping the others. When nothing else fits, say which
// other die to change first, rather than silently changing two.
export function changeOneDie(outcome, die, levelKey, { rng = Math.random, isPro = false } = {}) {
  const options = alternatives(outcome, die, levelKey, isPro)
  if (options.length) {
    const pick = options[Math.floor(rng() * options.length)]
    return { outcome: { ...pick, levelKey } }
  }
  const onTray = diceFor(levelKey, isPro)
  const others = onTray.filter(d => d !== die && d !== 'root')
  // The other die that, changed first, would give this die a choice: every
  // die but these two stays as it is.
  const freedBy = others.find(other => poolFor(levelKey, isPro).some(o =>
    face(o, die) !== face(outcome, die) && DICE.every(d => d === die || d === other || face(o, d) === face(outcome, d))))
  if (freedBy) {
    return { blocked: `Nothing else on the ${DIE_NAMES[die]} die fits with ${faceWords(freedBy, outcome)} here. Change the ${DIE_NAMES[freedBy]} first.` }
  }
  const rest = (onTray.includes(die) ? onTray : [...onTray, die]).filter(d => d !== die).map(d => `the ${DIE_NAMES[d]}`)
  const list = rest.length > 1 ? `${rest.slice(0, -1).join(', ')} or ${rest.at(-1)}` : rest[0]
  return { blocked: `The ${DIE_NAMES[die]} die has only “${faceLabel(die, outcome)}” at this level. Change ${list} instead, or move up a level.` }
}

// ---------- Hear it and Name it: the faces a student can choose ----------

// The faces a die shows at a level, in pool order (no repeats). Hear it and
// Name it offer exactly these, so every choice is one the level can roll.
export function facesFor(levelKey, die, isPro = false) {
  const seen = []
  for (const o of poolFor(levelKey, isPro)) {
    const f = face(o, die)
    if (!seen.includes(f)) seen.push(f)
  }
  return seen
}

// A chosen set of faces -> the chord it makes, or null if the faces don't
// make a chord (dominant with no colour, a slash bass on a ninth …).
export function chordFromPicks({ root, quality, colour = 'none', bass = 'root' }) {
  try { return resolveChord({ root, quality, colour, bass }) } catch { return null }
}
