// Shared note-matching + key-color-resolution logic for anything that
// renders piano keys highlighted by chord/preview/root/split-bass state --
// currently PianoDisplay (the full interactive keyboard) and MiniKeyboard
// (the compact, non-interactive strip in the collapsed bottom sheet). Kept
// here so both read the exact same rules for "what color is this key,"
// rather than one drifting out of sync with the other over time.

import { Note } from 'tonal'

// Resolve any spelling to one canonical sharp form, keeping the exact pitch:
// Eb4 -> D#4, Cb4 -> B3 (the B below the C it borrows its number from),
// E#4 -> F4, B#3 -> C4. Anything that is not a note with an octave passes
// through unchanged.
export function normalizeNote(note) {
  const midi = Note.midi(note.replace(/♯/g, '#').replace(/♭/g, 'b'))
  return midi == null ? note : Note.fromMidiSharps(midi)
}

export function noteMatches(keyNote, chordNotes) {
  const normalizedKey = normalizeNote(keyNote)
  return chordNotes.some(n => normalizeNote(n) === normalizedKey)
}

// Pitch-class only (octave-blind) match -- a note that carries over into the
// preview chord but lands at a different octave (very common: the Voicing
// Rule pushes an extension whose letter falls before the root's up an
// octave, so the SAME pitch class can sit at a different octave in two
// chords that share it) is still the same held tone, not a coincidence.
// Same principle App.jsx's intervalsForNotes already applies to interval
// labels, applied here to "does this note carry over" instead.
function pitchClassOf(note) {
  return normalizeNote(note).replace(/\d+$/, '')
}

export function pitchClassMatches(keyNote, otherNotes) {
  const pc = pitchClassOf(keyNote)
  return otherNotes.some(n => pitchClassOf(n) === pc)
}

export function isRoot(keyNote, rootNote) {
  return !!rootNote && normalizeNote(keyNote) === normalizeNote(rootNote)
}

// Find how a note is actually spelled (flat or sharp) within a chord's note
// list, e.g. for keyNote "D#4" this returns "E♭" if the chord spells it that
// way, so the piano matches how the chord is actually written, not a fixed
// sharp-only convention
export function findSpelling(keyNote, chordNotes) {
  const normalizedKey = normalizeNote(keyNote)
  const match = chordNotes.find(n => normalizeNote(n) === normalizedKey)
  if (!match) return null
  return match.replace(/\d+$/, '').replace(/#/g, '♯').replace(/b/g, '♭')
}

// Work out fill + whether the key gets a "shared" ring for a single key.
// The four highlight colors (root gold, chord-tone teal, suggested purple,
// split-bass rose) all come from noteColors -- see src/utils/noteColors.js
// and index.css's --note-color-* custom properties, the single source of
// truth every display reading this reads from.
export function resolveKeyStyle(note, notes, root, previewNotes, defaultFill, bassHighlightNote, noteColors) {
  const inCurrent = noteMatches(note, notes)
  const previewActive = !!previewNotes && previewNotes.length > 0
  const inPreview = previewActive && noteMatches(note, previewNotes)
  const isCurrentRoot = isRoot(note, root)
  const isBassSplit = !!bassHighlightNote && isRoot(note, bassHighlightNote)
  // Whether this note's pitch class survives into the preview chord --
  // drives both the "shared" ring and, below, whether a currently-sounding
  // note that DOESN'T survive visually recedes.
  const holds = previewActive && pitchClassMatches(note, previewNotes)

  if (inCurrent) {
    // Without this, every note of the current chord looks identical
    // whether it's about to move or stay, and a preview reads as "nothing
    // changed" even for a real chord-to-chord shift -- e.g. Dm7 -> Cmaj7's
    // D/F/A all leave and only C holds, but all four looked equally "lit"
    // (Field Test, 12 Aug 2026). A leaving note recedes so the shape
    // visibly changes, not just gains extra highlighted keys elsewhere.
    const leaving = previewActive && !holds
    return {
      fill: isBassSplit ? noteColors.splitBass : isCurrentRoot ? noteColors.root : noteColors.chordTone,
      active: true,
      shared: holds,
      leaving,
      textFill: isBassSplit ? '#ffffff' : isCurrentRoot ? '#7a5500' : '#ffffff',
      spelling: findSpelling(note, notes),
    }
  }
  if (inPreview) {
    return { fill: noteColors.suggested, active: true, shared: false, leaving: false, textFill: '#ffffff', spelling: findSpelling(note, previewNotes) }
  }
  return { fill: defaultFill, active: false, shared: false, leaving: false, textFill: '#aaaaaa', spelling: null }
}
