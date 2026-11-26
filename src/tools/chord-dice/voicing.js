// How Chord Dice voices a chord for playback, as MIDI note numbers. Pure, so
// the rule "the marked bass sounds lowest" is unit-tested without audio.
import { Note } from 'tonal'

// The reference voicing: root position, close, around middle C. Roots from
// G upwards start an octave lower so every chord sits in the same range.
// A slash chord (Level 5) puts its bass note below everything else.
export function targetVoicing(chord) {
  const octave = chord.chromas[0] >= 7 ? 3 : 4
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

// The student's notes, played upwards from C4 in keyboard order; a note they
// marked as the bass sounds an octave lower, under the rest.
export const selectionVoicing = (chromas, bassMark = null) => {
  const upper = [...new Set(chromas)].sort((a, b) => a - b).map(c => 60 + c)
  return bassMark === null ? upper : [48 + bassMark, ...upper]
}
