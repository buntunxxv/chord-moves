import test from 'node:test'
import assert from 'node:assert/strict'
import { extensionLabel } from './extensionLabels.js'

test('with Major, the dominant extensions say so', () => {
  assert.equal(extensionLabel('7', '7', 'major'), '7 (dominant)')
  assert.equal(extensionLabel('9', '9', 'major'), '9 (dominant)')
  assert.equal(extensionLabel('11', '11', 'major'), '11 (dominant)')
  assert.equal(extensionLabel('13', '13', 'major'), '13 (dominant)')
})

test('maj7 and the others keep their names', () => {
  for (const e of ['none', 'maj7', 'add9', 'maj9', 'maj13', 'dim7', '7♯9']) assert.equal(extensionLabel(e, e, 'major'), e)
})

test('with other qualities, 7 stays 7 (Minor + 7 is Cm7, not a dominant)', () => {
  for (const q of ['minor', 'diminished', 'augmented', 'sus2', 'sus4']) {
    for (const e of ['7', '9', '11', '13']) assert.equal(extensionLabel(e, e, q), e)
  }
})
