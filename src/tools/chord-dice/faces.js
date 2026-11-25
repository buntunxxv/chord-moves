// Chord Dice faces, PR 1 (Levels 1–2). Three dice: Root, Quality, Colour.
// A roll picks one face per die from the level's pool; Tonal turns the
// result into a spelled chord. The Bass die arrives with Level 5.
//
// Root spellings follow Chord Moves and the founder's Phase 0 approval
// (25 Nov 2026): C, C#, D, Eb, E, F, F#, G, G#, A, Bb, B. Enharmonic answers
// are still accepted, because answers are compared by pitch class.
import { Chord, Note } from 'tonal'

export const L1_ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
export const L2_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B']

export const QUALITIES = {
  major: { id: 'major', label: 'major', suffix: '', third: { interval: '3M', name: 'major third' } },
  minor: { id: 'minor', label: 'minor', suffix: 'm', third: { interval: '3m', name: 'minor third' } },
}

// Levels 1–2 have no colour; the die shows "none" so all three dice are
// always on the table and the Colour die reads the same at every level.
export const COLOURS = { none: { id: 'none', label: 'none', suffix: '' } }

export const LEVELS = {
  L1: { id: 'L1', name: 'Level 1', roots: L1_ROOTS, qualities: ['major', 'minor'], colours: ['none'] },
  L2: { id: 'L2', name: 'Level 2', roots: L2_ROOTS, qualities: ['major', 'minor'], colours: ['none'] },
}

// The level switch. Mix rolls Level 1 or Level 2 with equal chance, then a
// chord from that level, so natural roots stay common (as Mix pools levels
// in Rhythm Dice).
export const LEVEL_CHOICES = [
  { key: 'L1', label: '1', name: 'Level 1', levelIds: ['L1'] },
  { key: 'L2', label: '2', name: 'Level 2', levelIds: ['L2'] },
  { key: 'mix', label: 'Mix', name: 'Mix levels 1 and 2', levelIds: ['L1', 'L2'] },
]
export const LEVEL_KEYS = LEVEL_CHOICES.map(c => c.key)

// ASCII spelling -> display spelling (♯ ♭ 𝄪 𝄫).
// Only the letter's own accidentals change, so a suffix is left alone.
// (No regex lookbehind: older iPad Safari cannot parse it.)
const ACCIDENTAL_GLYPHS = { '': '', '#': '♯', '##': '𝄪', b: '♭', bb: '𝄫' }
export function displayNote(name) {
  const m = /^([A-G])(##|#|bb|b)?(.*)$/.exec(String(name))
  if (!m) return String(name)
  return m[1] + ACCIDENTAL_GLYPHS[m[2] ?? ''] + m[3]
}

// Every outcome a level can roll, as { root, quality, colour }.
export function outcomes(levelId) {
  const level = LEVELS[levelId]
  return level.roots.flatMap(root =>
    level.qualities.flatMap(quality => level.colours.map(colour => ({ root, quality, colour, levelId }))))
}

// A rolled outcome -> the chord the student builds.
//   symbol   'F#m'        (ASCII, as Tonal reads it)
//   name     'F♯m'        (display)
//   notes    ['F#','A','C#']  spelled chord tones, root first
//   chromas  [6, 9, 1]    pitch classes, same order
//   roles    [{ interval:'1P', name:'root' }, ...]
export function resolveChord({ root, quality, colour = 'none' }) {
  const q = QUALITIES[quality]
  if (!q || !COLOURS[colour]) throw new Error(`Unknown face ${quality}/${colour}`)
  const symbol = root + q.suffix + COLOURS[colour].suffix
  const chord = Chord.get(symbol)
  if (chord.empty) throw new Error(`Tonal has no chord ${symbol}`)
  const roles = [
    { interval: '1P', name: 'root' },
    { interval: q.third.interval, name: q.third.name },
    { interval: '5P', name: 'perfect fifth' },
  ]
  const notes = roles.map(r => Note.transpose(root, r.interval))
  return {
    root,
    quality,
    colour,
    symbol,
    name: displayNote(symbol),
    // How sentences say it: "G♯ major", "B♭ minor".
    prose: `${displayNote(root)} ${q.label}`,
    notes,
    chromas: notes.map(n => Note.chroma(n)),
    roles,
    tonalNotes: chord.notes,
  }
}

// Roll one chord. Avoids repeating the chord already on the table.
export function rollChord(levelKey, { rng = Math.random, avoid = null } = {}) {
  const choice = LEVEL_CHOICES.find(c => c.key === levelKey) ?? LEVEL_CHOICES[0]
  for (let tries = 0; ; tries++) {
    const levelId = choice.levelIds[Math.floor(rng() * choice.levelIds.length)]
    const pool = outcomes(levelId)
    const pick = pool[Math.floor(rng() * pool.length)]
    if (tries < 8 && avoid && pick.root === avoid.root && pick.quality === avoid.quality) continue
    return { ...pick, levelKey: choice.key }
  }
}
