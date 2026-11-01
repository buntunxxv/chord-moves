import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { activeCue, buildCues, getDemo, pickVariant } from './demoVideos.js'
import { DEMO_SCRIPTS } from './demoScripts.js'
import recordings from './recordings.json' with { type: 'json' }

const script = {
  title: 'Demo',
  lengthLabel: '30s',
  beats: ['a', 'b', 'c'],
  captions: { a: 'First', b: 'Second', c: 'Third' },
}

test('each caption runs from its beat to the next, the last to the end', () => {
  assert.deepEqual(buildCues(script, { a: 0, b: 5, c: 12 }, 20), [
    { start: 0, end: 5, text: 'First' },
    { start: 5, end: 12, text: 'Second' },
    { start: 12, end: 20, text: 'Third' },
  ])
})

test('a beat the recording never reached, or with no caption, is skipped', () => {
  const noCaption = { ...script, captions: { a: 'First', c: 'Third' } }
  assert.deepEqual(buildCues(noCaption, { a: 0, b: 5, c: 12 }, 20).map(c => c.text), ['First', 'Third'])
  assert.deepEqual(buildCues(script, { a: 0, c: 12 }, 20).map(c => [c.start, c.end]), [[0, 12], [12, 20]])
})

test('activeCue finds the caption showing at a moment, or none', () => {
  const cues = buildCues(script, { a: 1, b: 5 }, 10)
  assert.equal(activeCue(cues, 0.5), null)
  assert.equal(activeCue(cues, 1).text, 'First')
  assert.equal(activeCue(cues, 4.99).text, 'First')
  assert.equal(activeCue(cues, 5).text, 'Second')
  assert.equal(activeCue(cues, 10), null)
})

test('a demo with no recording yet offers no video', () => {
  assert.equal(getDemo('build-a-progression', {}), null)
  assert.equal(getDemo('not-a-demo'), null)
})

test('pickVariant prefers the shape that fits the screen, else what exists', () => {
  const both = { variants: { portrait: { poster: 'p' }, landscape: { poster: 'l' } } }
  assert.equal(pickVariant(both, true).poster, 'p')
  assert.equal(pickVariant(both, false).poster, 'l')
  assert.equal(pickVariant({ variants: { landscape: { poster: 'l' } } }, true).poster, 'l')
})

// Guards the committed recordings: every demo is recorded, reaches all of its
// beats, and its files are really in public/.
test('every scripted demo has a complete recording on disk', () => {
  for (const id of Object.keys(DEMO_SCRIPTS)) {
    const demo = getDemo(id)
    assert.ok(demo, `${id} has no recording: run npm run demo:record`)
    for (const [name, variant] of Object.entries(recordings[id].variants)) {
      for (const beat of DEMO_SCRIPTS[id].beats) {
        assert.ok(beat in variant.beats, `${id}/${name} is missing beat "${beat}": re-record`)
      }
      for (const file of [...variant.sources.map(s => s.src), variant.poster]) {
        assert.ok(existsSync(fileURLToPath(new URL(`../../public${file}`, import.meta.url))), `${file} is missing`)
      }
    }
  }
})
