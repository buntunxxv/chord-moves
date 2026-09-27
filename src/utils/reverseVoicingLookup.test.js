import test from 'node:test'
import assert from 'node:assert/strict'
import { detectAddedToneChord, detectChordName, detectChordNameFromPitchClasses } from './reverseVoicingLookup.js'

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
  assert.deepEqual(detectAddedToneChord([0, 4, 7, 11, 1]), { name: 'Cmaj7b9', root: 'C' })
})

test('leaves tonal-detected chords alone', () => {
  assert.equal(detectChordNameFromPitchClasses([0, 4, 7]).name, 'CM')
})

test('two or more added tones stay unnamed', () => {
  assert.equal(detectAddedToneChord([0, 4, 7, 1, 6]), null)
})
