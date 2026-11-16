// Rhythm Dice MIDI export. Built on the same @tonejs/midi library as Chord
// Moves' exporter (src/utils/midiExport.js), but rhythm-specific: that one
// writes one chord per bar, this writes every note of a rolled bar on the
// General MIDI drum channel with exact starts and lengths.
//
// Timing is written in ticks, not seconds, so it is exact: the default PPQ
// of 480 divided by our 12 ticks per crotchet is 40 MIDI ticks per grid tick.
import { Midi } from '@tonejs/midi/dist/Midi.js'
import { TICKS_PER_CROTCHET } from './faces.js'
import { barTicks, midiTempo, soundingNotes } from './rhythm.js'

export const DRUM_CHANNEL = 9 // MIDI channel 10, zero-indexed
export const DRUM_SOUNDS = [
  { midi: 39, label: 'Hand clap' },
  { midi: 36, label: 'Kick' },
  { midi: 38, label: 'Snare' },
  { midi: 42, label: 'Closed hi-hat' },
]
export const DEFAULT_DRUM = 39
const VELOCITY = 0.8

// One bar (`faces`) or a phrase (`bars`, a list of bars in order). Ties never
// cross a barline, so bars are laid end to end.
export function buildRhythmMidiBytes({ faces, bars, metre, bpm, drum = DEFAULT_DRUM, name = 'Rhythm Dice' }) {
  const allBars = bars ?? [faces]
  const midi = new Midi()
  const ppq = midi.header.ppq
  const scale = ppq / TICKS_PER_CROTCHET
  if (!Number.isInteger(scale)) throw new Error(`PPQ ${ppq} is not a multiple of ${TICKS_PER_CROTCHET}`)

  midi.header.setTempo(midiTempo(metre, bpm))
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [...metre.timeSignature] })
  midi.header.name = name
  midi.header.update()

  const track = midi.addTrack()
  track.name = name
  track.channel = DRUM_CHANNEL
  const barLength = barTicks(metre)
  allBars.forEach((barFaces, b) => {
    for (const note of soundingNotes(barFaces, metre)) {
      track.addNote({ midi: drum, ticks: (b * barLength + note.start) * scale, durationTicks: note.ticks * scale, velocity: VELOCITY })
    }
  })
  return midi.toArray()
}

export function rhythmFilename(faces, metre) {
  const sig = metre ? `${metre.timeSignature[0]}-${metre.timeSignature[1]}-` : ''
  return `rhythm-dice-${sig}${faces.map(f => f.id).join('_')}.mid`
}

export function phraseFilename(bars, metre) {
  return `rhythm-dice-phrase-${metre.timeSignature[0]}-${metre.timeSignature[1]}-${bars.length}-bars.mid`
}
