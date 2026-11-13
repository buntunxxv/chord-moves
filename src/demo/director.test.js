import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessibleName, chordPattern, createPlayer, matchesName } from './director.js'
import { DEMO_CHAPTERS } from './chapters.js'

// A clock that jumps instead of waiting, so a whole demo plays instantly.
function fakeClock() {
  let t = 0
  return {
    now: () => t,
    sleep: async ms => { t += ms; await Promise.resolve() },
  }
}

// A stand-in app: buttons are just names; tapping one is recorded.
function fakeFrame(names) {
  const taps = []
  let resets = 0
  return {
    taps,
    get resets() { return resets },
    async reset() { resets++ },
    find: matcher => names.find(n => matchesName(n, matcher)) || null,
    tap: el => taps.push(el),
    showTap() {},
  }
}

const chapters = [
  { id: 'a', run: async d => { await d.tap('One') } },
  { id: 'b', run: async d => { await d.tap('Ding', { sound: true }); await d.tap('Two') } },
  { id: 'c', run: async d => { await d.tap('Three') } },
]

test('plays every chapter in order and ends', async () => {
  const frame = fakeFrame(['One', 'Ding', 'Two', 'Three'])
  const seen = []
  const player = createPlayer({ chapters, frame, clock: fakeClock(), onChange: s => seen.push(`${s.chapter}:${s.status}`) })
  await player.play(0)
  assert.deepEqual(frame.taps, ['One', 'Ding', 'Two', 'Three'])
  assert.equal(player.state.status, 'ended')
  assert.ok(seen.includes('1:playing') && seen.includes('2:playing'))
})

test('a jump starts a fresh app and replays earlier chapters without their sound steps', async () => {
  const frame = fakeFrame(['One', 'Ding', 'Two', 'Three'])
  const player = createPlayer({ chapters, frame, clock: fakeClock() })
  await player.play(2)
  assert.equal(frame.resets, 1)
  assert.deepEqual(frame.taps, ['One', 'Two', 'Three'])
  assert.equal(player.state.chapter, 2)
})

test('a newer play cancels the one still running', async () => {
  const frame = fakeFrame(['One', 'Ding', 'Two', 'Three'])
  const player = createPlayer({ chapters, frame, clock: fakeClock() })
  const first = player.play(0)
  const second = player.play(2)
  await Promise.all([first, second])
  assert.equal(player.state.status, 'ended')
  assert.equal(frame.taps.filter(t => t === 'Three').length, 1)
})

test('pause holds the demo until resume', async () => {
  const frame = fakeFrame(['One', 'Ding', 'Two', 'Three'])
  const clock = fakeClock()
  const player = createPlayer({ chapters, frame, clock })
  const run = player.play(0)
  await Promise.resolve()
  player.pause()
  assert.equal(player.state.status, 'paused')
  for (let i = 0; i < 200; i++) await clock.sleep(50)
  const tapsWhilePaused = frame.taps.length
  for (let i = 0; i < 200; i++) await clock.sleep(50)
  assert.equal(frame.taps.length, tapsWhilePaused, 'nothing is tapped while paused')
  player.resume()
  await run
  assert.equal(player.state.status, 'ended')
})

test('a control that never appears stops the demo with a named error', async () => {
  const frame = fakeFrame(['One', 'Ding'])
  const player = createPlayer({ chapters, frame, clock: fakeClock() })
  await player.play(0)
  assert.equal(player.state.status, 'error')
  assert.equal(player.state.chapter, 1)
  assert.match(player.state.error, /Two/)
})

test('accessibleName prefers aria-label, else the text', () => {
  const el = (label, text) => ({ getAttribute: () => label, textContent: text })
  assert.equal(accessibleName(el('Add to progression Am7', '+ Add')), 'Add to progression Am7')
  assert.equal(accessibleName(el(null, '  Explore \n next  ')), 'Explore next')
})

test('chordPattern matches a chord name, not a longer one', () => {
  assert.ok(chordPattern('G').test('GMoves forward'))
  assert.ok(!chordPattern('G').test('G7Tension'))
  assert.ok(!chordPattern('G').test('GmDarker'))
  assert.ok(chordPattern('Am7').test('Am7Familiar'))
})

test('the real chapters are all named and captioned', () => {
  for (const chapter of DEMO_CHAPTERS) {
    assert.ok(chapter.id && chapter.title && chapter.caption && typeof chapter.run === 'function', chapter.id)
  }
  assert.equal(new Set(DEMO_CHAPTERS.map(c => c.id)).size, DEMO_CHAPTERS.length)
})
