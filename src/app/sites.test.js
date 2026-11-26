import test from 'node:test'
import assert from 'node:assert/strict'
import { CHORD_MOVES_PATH, DEMO_PATH, UPGRADE_PATH, currentPathFor } from './sites.js'

test('old Chord Moves paths move under /chordmoves; Pro is suite-wide at /upgrade', () => {
  assert.equal(currentPathFor('/'), CHORD_MOVES_PATH)
  assert.equal(currentPathFor('/chordmoves/upgrade'), UPGRADE_PATH)
  assert.equal(currentPathFor('/demo'), DEMO_PATH)
})

test('the old /tools directory is now the root', () => {
  assert.equal(currentPathFor('/tools'), '/')
  assert.equal(UPGRADE_PATH, '/upgrade')
})

test('library tools and new paths keep their path', () => {
  for (const p of ['/metronome', '/chord-dice', '/chordmoves', '/upgrade']) assert.equal(currentPathFor(p), p)
  assert.equal(currentPathFor('/upgrade/'), '/upgrade')
})
