import test from 'node:test'
import assert from 'node:assert/strict'
import { detectAddedToneChord, detectChordName, detectChordNameFromPitchClasses, respellNotes, soundingNotes, spellChordName } from './reverseVoicingLookup.js'
import { nearestSelectionForName } from './chordSelectionLookup.js'
import { normalizeNote } from './pianoKeyStyle.js'

// B D# F F# -- the shape from the Identify screenshot (F is E#, the #11).
test('names a major triad plus #11 instead of listing notes', () => {
  const detected = detectChordNameFromPitchClasses([11, 3, 5, 6])
  assert.equal(detected.name, 'Badd#11')
  assert.equal(detected.root, 'B')
  assert.equal(detected.isDetected, true)
})

test('uses the guitar shape bass note to break ties', () => {
  // F# on the low string, as in the screenshot's best-match shape.
  const detected = detectChordName(['2', '2', '3', '4', '4', '2'])
  assert.equal(detected.name, 'Badd#11')
})

test('seventh bases take the tension without "add"', () => {
  // C E G Bb + F# is already C7#11 in tonal; C E G B + Db is not.
  assert.equal(detectAddedToneChord([0, 4, 7, 11, 1]).name, 'Cmaj7b9')
})

test('leaves tonal-detected chords alone', () => {
  assert.equal(detectChordNameFromPitchClasses([0, 4, 7]).name, 'CM')
})

test('two or more added tones stay unnamed', () => {
  assert.equal(detectAddedToneChord([0, 4, 7, 1, 6]), null)
})

test('spells the added tone by its interval: the #11 of B is E#', () => {
  assert.deepEqual(detectChordNameFromPitchClasses([11, 3, 5, 6]).spelledNotes, ['B', 'D#', 'F#', 'E#'])
})

test('respelled sounding notes keep their exact pitch', () => {
  const frets = ['2', '2', '3', '4', '4', '2']
  const spelled = respellNotes(soundingNotes(frets), detectChordName(frets).spelledNotes)
  assert.deepEqual(spelled, ['F#2', 'B2', 'E#3', 'B3', 'D#4', 'F#4'])
  assert.deepEqual(spelled.map(normalizeNote), soundingNotes(frets).map(normalizeNote))
})

test('picks the plainer enharmonic root', () => {
  assert.equal(spellChordName('A#M').name, 'BbM')
  assert.deepEqual(spellChordName('A#M').spelledNotes, ['Bb', 'D', 'F'])
  assert.equal(detectAddedToneChord([10, 2, 5, 0]).name, 'Bbadd9')
})

test('a chip the builder cannot make maps to its nearest builder chord', () => {
  assert.deepEqual(nearestSelectionForName('Badd#11'), { root: 'B', quality: 'major', extension: 'none' })
  assert.deepEqual(nearestSelectionForName('Gm7/D'), { root: 'G', quality: 'minor', extension: '7' })
  assert.deepEqual(nearestSelectionForName('E#m'), { root: 'F', quality: 'minor', extension: 'none' })
  assert.equal(nearestSelectionForName('F# · B · F · D#'), null)
})

test('piano matching understands any spelling of a pitch', () => {
  assert.equal(normalizeNote('E#4'), 'F4')
  assert.equal(normalizeNote('B#3'), 'C4')
  assert.equal(normalizeNote('Cb4'), 'B3')
  assert.equal(normalizeNote('F##4'), 'G4')
})
