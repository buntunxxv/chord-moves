import test from 'node:test'
import assert from 'node:assert/strict'
import { Midi } from '@tonejs/midi/dist/Midi.js'
import { LEVELS, validateLevels, faceTicks, levelById } from './faces.js'
import { METRES, rollBar, rollDie, slotPool, resolveTies, barEvents, soundingNotes, onsetTicks, blockUnit, faceBlocks, isAllRest } from './rhythm.js'
import { scoreBar, onsetWindows, reflect, formatOffsetMs } from './scoring.js'
import { buildRhythmMidiBytes, DRUM_CHANNEL } from './midi.js'
import { createPassSource, expectedOnsets, calibrationOffset, clickEvents } from './timeline.js'
import { createLookaheadScheduler, gridTimes } from '../../shared/audio/lookaheadScheduler.js'

const M44 = METRES['4/4']
const face = id => LEVELS.flatMap(l => l.faces).find(f => f.id === id)
const seq = values => { let i = 0; return () => values[i++ % values.length] }

// ---------- faces ----------

test('every face adds up to exactly its beat', () => {
  for (const lvl of LEVELS) {
    assert.equal(lvl.faces.length, 6, `${lvl.id} has 6 slots`)
    for (const f of lvl.faces) assert.equal(faceTicks(f), lvl.beat, f.id)
  }
})

test('validation rejects a face of the wrong length', () => {
  const bad = [{ ...levelById('L1'), faces: [...levelById('L1').faces.slice(0, 5), { id: 'X', name: 'x', events: [{ type: 'note', ticks: 11 }] }] }]
  assert.throws(() => validateLevels(bad), /adds up to 11/)
})

test('validation rejects a die without six slots and a rest that ties', () => {
  assert.throws(() => validateLevels([{ ...levelById('L1'), faces: levelById('L1').faces.slice(0, 5) }]), /exactly 6/)
  const restTie = { id: 'Y', name: 'y', events: [{ type: 'rest', ticks: 12, tieOut: true }] }
  assert.throws(() => validateLevels([{ ...levelById('L1'), faces: [...levelById('L1').faces.slice(0, 5), restTie] }]), /only a note/)
})

// ---------- bar assembly ----------

test('a 4/4 bar is four dice and 48 ticks', () => {
  const bar = rollBar(slotPool(['L1']), M44, { rng: seq([0]) })
  assert.equal(bar.length, 4)
  assert.equal(barEvents(bar, M44).reduce((s, e) => s + e.ticks, 0), 48)
})

test('rolls are uniform over slots, so a duplicate face keeps double weight', () => {
  const pool = slotPool(['L1'])
  const counts = {}
  for (let i = 0; i < 6; i++) {
    const f = rollDie(pool, { isLastDie: false, rng: () => i / 6 + 0.01 })
    counts[f.name] = (counts[f.name] || 0) + 1
  }
  assert.equal(counts['2 quavers'], 2)
  assert.equal(counts['Crotchet'], 1)
})

test('mix levels pools the slots of every chosen level', () => {
  assert.equal(slotPool(['L1', 'L2']).length, 12)
})

test('re-roll changes unlocked dice only', () => {
  const pool = slotPool(['L2'])
  const first = rollBar(pool, M44, { rng: seq([0]) })
  const next = rollBar(pool, M44, { current: first, locked: [true, false, true, false], rng: seq([0.99]) })
  assert.equal(next[0], first[0])
  assert.equal(next[2], first[2])
  assert.equal(next[1].id, 'L2-6')
  assert.equal(next[3].id, 'L2-6')
})

test('onsets, sustains and rests in a bar', () => {
  const bar = [face('L1-1'), face('L1-4'), face('L1-3'), face('L2-1')]
  assert.deepEqual(onsetTicks(bar, M44), [0, 18, 36, 39, 42, 45])
  assert.deepEqual(soundingNotes(bar, M44), [
    { start: 0, ticks: 12 }, { start: 18, ticks: 6 },
    { start: 36, ticks: 3 }, { start: 39, ticks: 3 }, { start: 42, ticks: 3 }, { start: 45, ticks: 3 },
  ])
  assert.equal(isAllRest(bar), false)
  assert.equal(isAllRest([face('L1-3'), face('L1-3'), face('L1-3'), face('L1-3')]), true)
})

// ---------- ties ----------

test('a tie-out face is never rolled on the last die', () => {
  const pool = slotPool(['L3'])
  for (let k = 0; k < 6; k++) {
    const f = rollDie(pool, { isLastDie: true, rng: () => k / 6 + 0.01 })
    assert.notEqual(f.id, 'L3-5')
  }
  // The same rng value that picks the tie on another die picks something else on the last one.
  assert.equal(rollDie(pool, { isLastDie: false, rng: () => 4 / 6 + 0.01 }).id, 'L3-5')
})

test('a tie holds into the next note: no onset, one longer sounding note', () => {
  const bar = [face('L3-5'), face('L1-1'), face('L1-2'), face('L1-1')]
  assert.deepEqual(resolveTies(bar), [true, false, false, false])
  assert.deepEqual(onsetTicks(bar, M44), [0, 24, 30, 36])
  assert.deepEqual(soundingNotes(bar, M44)[0], { start: 0, ticks: 24 })
  const tiedIn = barEvents(bar, M44).find(e => e.die === 1)
  assert.equal(tiedIn.tiedIn, true)
  assert.equal(tiedIn.onset, false)
})

test('a tie into a rest is dropped', () => {
  const bar = [face('L3-5'), face('L1-3'), face('L1-1'), face('L1-1')]
  assert.deepEqual(resolveTies(bar), [false, false, false, false])
  assert.deepEqual(soundingNotes(bar, M44)[0], { start: 0, ticks: 12 })
})

test('a tie on the last die (e.g. a locked die after a level change) is dropped', () => {
  const bar = [face('L1-1'), face('L1-1'), face('L1-1'), face('L3-5')]
  assert.deepEqual(resolveTies(bar), [false, false, false, false])
  assert.deepEqual(soundingNotes(bar, M44).at(-1), { start: 36, ticks: 12 })
})

// ---------- blocks ----------

test('blocks: attack, sustain and rest per tick group', () => {
  const unit = blockUnit(slotPool(['L1', 'L2']))
  assert.equal(unit, 3)
  assert.deepEqual(faceBlocks(face('L1-4'), unit).map(c => c.state), ['rest', 'rest', 'attack', 'sustain'])
  assert.deepEqual(faceBlocks(face('L1-1'), 3, { tiedIn: true }).map(c => c.state), ['sustain', 'sustain', 'sustain', 'sustain'])
})

// ---------- scoring ----------

const at = (...times) => times.map(t => ({ time: t, offbeat: false }))

test('window is min(100 ms, 45% of the gap to the nearest onset)', () => {
  // 160 BPM semiquavers are 93.75 ms apart: 45% of that is 42.2 ms.
  const w = onsetWindows([0, 0.09375, 0.1875, 0.28125])
  assert.ok(Math.abs(w[0] - 0.0421875) < 1e-9)
  assert.deepEqual(onsetWindows([0, 1]), [0.1, 0.1])
  assert.deepEqual(onsetWindows([0.5]), [0.1])
})

test('perfect taps match every onset', () => {
  const r = scoreBar(at(0, 0.5, 1, 1.5), [0, 0.5, 1, 1.5])
  assert.equal(r.matched, 4)
  assert.equal(r.missed, 0)
  assert.equal(r.extras.length, 0)
  assert.equal(r.accuracy, 1)
  assert.equal(r.spread, 0)
})

test('one tap never counts for two onsets: nearest pair wins', () => {
  // Onsets 94 ms apart; a single tap between them goes to the nearer one.
  const r = scoreBar(at(0, 0.094), [0.03])
  assert.equal(r.matched, 1)
  assert.equal(r.hits[0].tap, 0.03)
  assert.equal(r.hits[1].tap, null)
  assert.equal(r.missed, 1)
})

test('two taps near one onset: one hit, one extra', () => {
  const r = scoreBar(at(0.5), [0.49, 0.53])
  assert.equal(r.matched, 1)
  assert.ok(Math.abs(r.hits[0].offset + 0.01) < 1e-9)
  assert.deepEqual(r.extras, [0.53])
  assert.equal(r.accuracy, 0.5)
})

test('taps outside the window are extras and the onset is missed', () => {
  const r = scoreBar(at(0, 0.5), [0.15, 0.5])
  assert.equal(r.missed, 1)
  assert.deepEqual(r.extras, [0.15])
})

test('an all-rest bar: every tap is extra, and the reflection asks about silence', () => {
  const r = scoreBar([], [0.2, 0.9])
  assert.equal(r.allRest, true)
  assert.equal(r.extras.length, 2)
  assert.equal(r.accuracy, 0)
  assert.equal(reflect(r), 'This bar was silence. Did you hold it?')
  assert.equal(scoreBar([], []).accuracy, 1)
})

test('tied sustains are not expected as taps', () => {
  const bar = [face('L3-5'), face('L1-1'), face('L1-1'), face('L1-1')]
  const expected = expectedOnsets(bar, M44, 120)
  assert.deepEqual(expected.map(e => e.time), [0, 1, 1.5])
  const r = scoreBar(expected, [0, 0.5, 1, 1.5])
  assert.equal(r.matched, 3)
  assert.deepEqual(r.extras, [0.5])
})

test('consistency (spread) is reported separately from accuracy', () => {
  const r = scoreBar(at(0, 0.5, 1, 1.5), [0.02, 0.48, 1.02, 1.48])
  assert.equal(r.accuracy, 1)
  assert.ok(Math.abs(r.spread - 0.02) < 1e-9)
  assert.ok(Math.abs(r.meanOffset) < 1e-9)
})

test('reflection names the dominant pattern', () => {
  const expected = [
    { time: 0, offbeat: false }, { time: 0.25, offbeat: true },
    { time: 0.5, offbeat: false }, { time: 0.75, offbeat: true },
  ]
  const r = scoreBar(expected, [0, 0.21, 0.5, 0.71])
  assert.equal(reflect(r), 'Most of your offbeats landed early.')
  assert.equal(reflect(scoreBar(expected, [0.04, 0.25, 0.54, 0.75])), 'Most of your on-beat hits landed late.')
  assert.equal(reflect(scoreBar(expected, [0, 0.25, 0.5, 0.75])), 'That sat on the grid. What did you listen for?')
  assert.match(reflect(scoreBar(expected, [])), /No taps/)
  assert.equal(formatOffsetMs(-0.012), '12 ms early')
  assert.equal(formatOffsetMs(0.0304), '30 ms late')
})

// ---------- timeline ----------

test('count-in bar, then the bar with accented downbeat and subdivisions', () => {
  const bar = [face('L1-1'), face('L1-1'), face('L1-1'), face('L1-1')]
  const src = createPassSource({ faces: bar, metre: M44, bpm: 120, startTime: 10, subdivision: 6, passes: 1 })
  const events = []
  for (let e = src.next(); e; e = src.next()) events.push(e)
  const countIn = events.filter(e => e.countIn)
  assert.deepEqual(countIn.map(e => e.time), [10, 10.5, 11, 11.5])
  assert.equal(countIn[0].level, 'accent')
  const barClicks = events.filter(e => e.kind === 'click' && !e.countIn)
  assert.equal(barClicks.length, 8)
  assert.equal(barClicks[0].time, 12)
  assert.equal(barClicks[0].level, 'accent')
  assert.equal(barClicks[1].level, 'sub')
  assert.equal(src.endTime, 14)
})

test('clicks are on the grid by multiplication, with no drift', () => {
  const clicks = clickEvents(M44, 160, 0, 3)
  clicks.forEach((c, i) => assert.equal(c.time, i * (60 / 160 / 4)))
  const times = gridTimes(0, 60 / 160, 256)
  assert.equal(times[255], 255 * (60 / 160))
})

test('latency calibration takes the median tap-to-click offset', () => {
  const clicks = gridTimes(0, 0.6, 8)
  const taps = clicks.map((c, i) => c + [0.04, 0.05, 0.045, 0.3, 0.05, 0.048, 0.052, 0.046][i])
  assert.ok(Math.abs(calibrationOffset(taps, clicks) - 0.049) < 1e-9)
})

// ---------- lookahead scheduler ----------

test('lookahead scheduler books each event once, in order, only inside the horizon', () => {
  let now = 0
  let tick = null
  const booked = []
  const events = gridTimes(0.05, 0.25, 12).map(time => ({ time }))
  let i = 0
  let done = false
  const s = createLookaheadScheduler({
    clock: () => now,
    source: { next: () => events[i++] ?? null },
    schedule: e => { assert.ok(e.time < now + 0.1 + 1e-9, 'never booked beyond the horizon'); booked.push(e.time) },
    onDone: () => { done = true },
    setIntervalFn: fn => { tick = fn; return 1 },
    clearIntervalFn: () => { tick = null },
  })
  s.start()
  assert.deepEqual(booked, [0.05])
  while (tick) { now += 0.025; tick() }
  assert.deepEqual(booked, events.map(e => e.time))
  assert.equal(done, true)
})

// ---------- MIDI round trip ----------

test('MIDI round trip: drum channel, note starts and lengths, tempo, metre', () => {
  const bar = [face('L1-1'), face('L1-4'), face('L2-2'), face('L3-5')] // tie on last die is dropped
  const bytes = buildRhythmMidiBytes({ faces: bar, metre: M44, bpm: 96, drum: 38 })
  const back = new Midi(bytes)
  assert.equal(back.header.ppq, 480)
  assert.equal(Math.round(back.header.tempos[0].bpm * 1000) / 1000, 96)
  assert.deepEqual(back.header.timeSignatures[0].timeSignature, [4, 4])
  const track = back.tracks[0]
  assert.equal(track.channel, DRUM_CHANNEL)
  assert.deepEqual(track.notes.map(n => [n.midi, n.ticks, n.durationTicks]), [
    [38, 0, 480], [38, 720, 240], [38, 960, 240], [38, 1200, 120], [38, 1320, 120], [38, 1440, 480],
  ])
  // Seconds line up with the set tempo: the last note starts on beat 4.
  assert.ok(Math.abs(track.notes.at(-1).time - 3 * 60 / 96) < 1e-3)
})

test('MIDI keeps a tied note as one longer note', () => {
  const bar = [face('L3-5'), face('L1-1'), face('L1-1'), face('L1-1')]
  const back = new Midi(buildRhythmMidiBytes({ faces: bar, metre: M44, bpm: 120 }))
  assert.deepEqual(back.tracks[0].notes.map(n => [n.midi, n.ticks, n.durationTicks]), [[39, 0, 960], [39, 960, 480], [39, 1440, 480]])
})

// ---------- PR 2: metres, L3, phrases ----------

import { countInBars, SIMPLE_METRE_IDS, barTicks } from './rhythm.js'
import { barBoundaries, phraseOnsets } from './timeline.js'
import { phraseFilename } from './midi.js'

test('2/4, 3/4, 4/4 and 5/4 are 2–5 crotchet dice', () => {
  assert.deepEqual(SIMPLE_METRE_IDS.map(id => [METRES[id].dice, barTicks(METRES[id]), METRES[id].timeSignature.join('/')]),
    [[2, 24, '2/4'], [3, 36, '3/4'], [4, 48, '4/4'], [5, 60, '5/4']])
  for (const id of SIMPLE_METRE_IDS) {
    const bar = rollBar(slotPool(['L1', 'L2', 'L3']), METRES[id], { rng: seq([0.3, 0.7, 0.1, 0.9, 0.5]) })
    assert.equal(bar.length, METRES[id].dice)
    assert.equal(barEvents(bar, METRES[id]).reduce((s, e) => s + e.ticks, 0), barTicks(METRES[id]))
  }
})

test('count-in: one bar, but two bars of 2/4 so there are at least four clicks', () => {
  assert.equal(countInBars(METRES['2/4']), 2)
  assert.equal(countInBars(METRES['3/4']), 1)
  assert.equal(countInBars(METRES['5/4']), 1)
  const src = createPassSource({ faces: [face('L1-1'), face('L1-1')], metre: METRES['2/4'], bpm: 120, startTime: 0, passes: 1 })
  const ev = []
  for (let e = src.next(); e; e = src.next()) ev.push(e)
  assert.equal(ev.filter(e => e.countIn).length, 4)
  assert.equal(src.firstBar, 2)
})

test('L3 in 3/4: the tie-out face never lands on beat 3, at any roll', () => {
  const pool = slotPool(['L3'])
  for (let k = 0; k < 60; k++) {
    const bar = rollBar(pool, METRES['3/4'], { rng: () => (k % 6) / 6 + 0.01 })
    assert.notEqual(bar[2].id, 'L3-5')
  }
})

test('a tie across dice inside a 5/4 bar sounds as one note and drops one onset', () => {
  const bar = [face('L1-1'), face('L3-5'), face('L1-2'), face('L1-3'), face('L3-1')]
  const m = METRES['5/4']
  assert.deepEqual(resolveTies(bar), [false, true, false, false, false])
  assert.deepEqual(soundingNotes(bar, m).slice(0, 2), [{ start: 0, ticks: 12 }, { start: 12, ticks: 18 }])
  assert.deepEqual(onsetTicks(bar, m), [0, 12, 30, 48, 57])
})

test('a phrase is scored as one sequence, each bar shifted by its start', () => {
  const m = METRES['2/4']
  const bars = [[face('L1-1'), face('L1-2')], [face('L1-3'), face('L1-1')]]
  assert.deepEqual(phraseOnsets(bars, m, 120).map(o => [o.bar, o.time]), [[0, 0], [0, 0.5], [0, 0.75], [1, 1.5]])
})

test('bar boundaries sit halfway between one bar\'s last onset and the next bar\'s first', () => {
  const barSec = 2
  const a = [{ time: 0 }, { time: 1.5 }]
  const b = [{ time: 0.5 }]
  // Bar 1 ends halfway between 1.5 and 2.5 (bar 2's first onset); bar 2 ends
  // halfway between 2.5 and 4.0; the last bar keeps a 0.1 s tail.
  assert.deepEqual(barBoundaries([a, b, a], barSec), [2, 3.25, 6.1])
  // An all-rest bar ends on its own barline.
  assert.deepEqual(barBoundaries([[], a], barSec), [2, 4.1])
})

test('read-ahead source: claps follow whichever bar each pass is given', () => {
  const m = METRES['2/4']
  const barsByPass = [[face('L1-1'), face('L1-3')], [face('L1-2'), face('L1-2')]]
  const src = createPassSource({ faces: p => barsByPass[p], metre: m, bpm: 120, startTime: 0, countIn: 0, claps: true, passes: 2 })
  const claps = []
  for (let e = src.next(); e; e = src.next()) if (e.kind === 'clap') claps.push(e.time)
  assert.deepEqual(claps, [0, 1, 1.25, 1.5, 1.75])
})

test('phrase MIDI: bars laid end to end, metre and tempo written once', () => {
  const m = METRES['3/4']
  const bars = [[face('L1-1'), face('L1-2'), face('L1-3')], [face('L3-5'), face('L1-1'), face('L1-4')]]
  const back = new Midi(buildRhythmMidiBytes({ bars, metre: m, bpm: 90 }))
  assert.deepEqual(back.header.timeSignatures[0].timeSignature, [3, 4])
  assert.equal(Math.round(back.header.tempos[0].bpm), 90)
  assert.deepEqual(back.tracks[0].notes.map(n => [n.ticks, n.durationTicks]), [
    [0, 480], [480, 240], [720, 240],
    [1440, 960], [2640, 240],
  ])
  assert.equal(phraseFilename(bars, m), 'rhythm-dice-phrase-3-4-2-bars.mid')
})

// ---------- PR 3: Level 4 (Pro) ----------

import { needsPro, PRO_LEVEL_IDS } from './faces.js'
import { faceUnit } from './rhythm.js'
import { countName } from './counting.js'

test('Level 4 is Pro: its faces mark a bar as needing Pro', () => {
  assert.deepEqual(PRO_LEVEL_IDS, ['L4'])
  assert.equal(levelById('L4').tier, 'pro')
  assert.equal(needsPro([face('L1-1'), face('L4-1')]), true)
  assert.equal(needsPro([face('L1-1'), face('L3-5')]), false)
})

test('blocks: semiquaver faces keep 4 cells a beat; triplets 3; sextuplets 6', () => {
  assert.equal(faceUnit(face('L1-1')), 3)
  assert.equal(faceUnit(face('L4-1')), 4)
  assert.equal(faceUnit(face('L4-2')), 4)
  assert.equal(faceUnit(face('L4-5')), 2)
  assert.deepEqual(faceBlocks(face('L4-2'), 4).map(c => c.state), ['attack', 'sustain', 'attack'])
  assert.deepEqual(faceBlocks(face('L4-4'), 4).map(c => c.state), ['rest', 'attack', 'attack'])
})

test('triplets: onsets on ticks 0, 4, 8; windows shrink to fit; MIDI exact', () => {
  const bar = [face('L4-1'), face('L4-5'), face('L4-2'), face('L1-1')]
  assert.deepEqual(onsetTicks(bar, M44), [0, 4, 8, 12, 14, 16, 18, 20, 22, 24, 32, 36])
  const exp = expectedOnsets(bar, M44, 160)
  // Sextuplets at 160 BPM are 62.5 ms apart: 45% of that is ~28 ms.
  assert.ok(Math.abs(onsetWindows(exp.map(e => e.time))[4] - 0.028125) < 1e-9)
  const back = new Midi(buildRhythmMidiBytes({ faces: bar, metre: M44, bpm: 100 }))
  assert.deepEqual(back.tracks[0].notes.map(n => n.ticks), [0, 160, 320, 480, 560, 640, 720, 800, 880, 960, 1280, 1440])
})

test('triplet counting names', () => {
  assert.equal(countName(4, 12), '1-trip')
  assert.equal(countName(20, 12), '2-let')
  assert.equal(countName(14, 12), '2·2')
  assert.equal(countName(6, 12), '1&')
})
