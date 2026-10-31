import test from 'node:test'
import assert from 'node:assert/strict'
import { CHORD_MOVES_ORIGIN, TOOLS_ORIGIN, resolveLink, siteForHost } from './sites.js'

test('hosts map to sites; anything else serves everything', () => {
  assert.equal(siteForHost('www.chordmoves.co.uk'), 'chordmoves')
  assert.equal(siteForHost('chordmoves.uk'), 'chordmoves')
  assert.equal(siteForHost('tools.kyndalearning.co.uk'), 'tools')
  assert.equal(siteForHost('localhost'), 'all')
  assert.equal(siteForHost('chord-moves-git-x-kyndaltd.vercel.app'), 'all')
})

test('on the library, its own tools are internal and the directory is the root', () => {
  assert.deepEqual(resolveLink('/tools', 'tools'), { internal: '/' })
  assert.deepEqual(resolveLink('/metronome', 'tools'), { internal: '/metronome' })
  assert.deepEqual(resolveLink('/', 'tools'), { external: `${CHORD_MOVES_ORIGIN}/`, site: 'chordmoves' })
})

test('on Chord Moves, library links leave for the tools domain', () => {
  assert.deepEqual(resolveLink('/', 'chordmoves'), { internal: '/' })
  assert.deepEqual(resolveLink('/upgrade', 'chordmoves'), { internal: '/upgrade' })
  assert.deepEqual(resolveLink('/tools', 'chordmoves'), { external: `${TOOLS_ORIGIN}/`, site: 'tools' })
  assert.deepEqual(resolveLink('/ear-trainer', 'chordmoves'), { external: `${TOOLS_ORIGIN}/ear-trainer`, site: 'tools' })
})

test('previews and localhost keep every link internal', () => {
  for (const p of ['/', '/tools', '/metronome', '/upgrade']) assert.deepEqual(resolveLink(p, 'all'), { internal: p })
})
