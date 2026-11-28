// How Chord Dice voices a chord for playback, as MIDI note numbers. Pure, so
// the rule "the marked bass sounds lowest" is unit-tested without audio.
import { Note } from 'tonal'

// The octave a chord's root sits in: roots from G upwards start lower.
const rootOctave = rootChroma => (rootChroma >= 7 ? 3 : 4)

// The reference voicing: root position, close, around middle C. Roots from
// G upwards start an octave lower so every chord sits in the same range.
// A slash chord (Level 5) puts its bass note below everything else.
export function targetVoicing(chord) {
  const octave = rootOctave(chord.chromas[0])
  const foreign = chord.bass?.degree === '2'
  const tones = foreign ? chord.notes.slice(0, -1) : chord.notes
  let last = -Infinity
  const upper = tones.map(n => {
    let midi = Note.midi(`${n}${octave}`)
    while (midi <= last) midi += 12
    last = midi
    return midi
  })
  if (!chord.bass || chord.bass.degree === 'root') return upper
  let bass = upper[0] - 1
  while (((bass % 12) + 12) % 12 !== chord.bass.chroma) bass -= 1
  return [bass, ...upper]
}

// The student's notes, voiced by the rule Submit grades them by: the bass is
// the note they marked, or, with nothing marked, the chord's root.
// - A marked bass sounds an octave lower, under the rest (keyboard order
//   from C4).
// - Unmarked, with the root among their notes: the root sounds lowest and
//   the rest stack above it within the octave, in the same register as
//   targetVoicing. A right triad or seventh then sounds exactly like Hear it,
//   instead of the inversion that keyboard order made (Am as Am/C).
// - Unmarked, without the root: keyboard order from C4. There is no bass to
//   honour yet, and the notes alone give nothing away.
// `root` is the chord's root chroma; leave it out for plain keyboard order.
export const selectionVoicing = (chromas, bassMark = null, root = null) => {
  const keys = [...new Set(chromas)].sort((a, b) => a - b)
  if (bassMark !== null) return [48 + bassMark, ...keys.map(c => 60 + c)]
  if (root === null || !keys.includes(root)) return keys.map(c => 60 + c)
  const low = 12 * (rootOctave(root) + 1) + root
  return keys.map(c => low + ((c - root + 12) % 12)).sort((a, b) => a - b)
}
