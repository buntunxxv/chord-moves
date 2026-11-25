import test from 'node:test'
import assert from 'node:assert/strict'
import { Chord, Note } from 'tonal'
import { L1_ROOTS, L2_ROOTS, LEVEL_CHOICES, displayNote, outcomes, resolveChord, rollChord } from './faces.js'
import {
  INTERVAL_NAMES, KEY_NAMES, chromaOf, compare, finishReflection, keyLabel, matches, nextPrompt,
  pitchClassSet, placementFeedback, semitonesUp,
} from './answer.js'
import { KEYS, REASON_MAX, makeKept, parseKept, readKept, serialiseKept, writeKept } from './storage.js'

const ALL = [...outcomes('L1'), ...outcomes('L2')]
const GRADE_WORDS = /\b(correct|incorrect|wrong|right|well done|good job|great|score|mistake|error|fail)/i

// ---------- face table and Tonal resolution ----------

test('face table: 14 outcomes at Level 1, 24 at Level 2, 38 in all', () => {
  assert.equal(outcomes('L1').length, 14)
  assert.equal(outcomes('L2').length, 24)
  assert.equal(ALL.length, 38)
  assert.deepEqual(L1_ROOTS, ['C', 'D', 'E', 'F', 'G', 'A', 'B'])
  // Phase 0 approval: C#, Eb, F#, G#, Bb (not Db / Ab).
  assert.deepEqual(L2_ROOTS, ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'])
  for (const o of ALL) assert.equal(o.colour, 'none')
  const symbols = outcomes('L2').map(o => resolveChord(o).symbol)
  assert.equal(new Set(symbols).size, 24, 'symbols are unique within Level 2')
})

for (const o of ALL) {
  test(`Tonal resolves ${o.levelId} ${o.root} ${o.quality}`, () => {
    const c = resolveChord(o)
    const tonal = Chord.get(c.symbol)
    assert.equal(tonal.empty, false)
    assert.equal(tonal.tonic, o.root)
    const third = o.quality === 'major' ? '3M' : '3m'
    assert.deepEqual(tonal.intervals, ['1P', third, '5P'])
    assert.deepEqual(c.notes, tonal.notes, 'our spelling is Tonal’s spelling')
    assert.deepEqual(c.chromas, c.notes.map(Note.chroma))
    assert.equal(c.chromas[0], Note.chroma(o.root))
    assert.equal(semitonesUp(c.chromas[0], c.chromas[1]), o.quality === 'major' ? 4 : 3)
    assert.equal(semitonesUp(c.chromas[0], c.chromas[2]), 7)
  })
}

test('spellings the student will see: E♯ in C♯, B♯ in G♯, E♭ minor has G♭', () => {
  assert.deepEqual(resolveChord({ root: 'C#', quality: 'major' }).notes, ['C#', 'E#', 'G#'])
  assert.deepEqual(resolveChord({ root: 'G#', quality: 'major' }).notes, ['G#', 'B#', 'D#'])
  assert.deepEqual(resolveChord({ root: 'Eb', quality: 'minor' }).notes, ['Eb', 'Gb', 'Bb'])
  assert.equal(resolveChord({ root: 'F#', quality: 'minor' }).name, 'F♯m')
  assert.equal(displayNote('Bbm'), 'B♭m')
  assert.equal(displayNote('F##'), 'F𝄪')
})

test('rolls stay in their level; Mix draws from both', () => {
  let seed = 7
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const l1 = Array.from({ length: 300 }, () => rollChord('L1', { rng }))
  assert.ok(l1.every(r => L1_ROOTS.includes(r.root)))
  const l2 = Array.from({ length: 600 }, () => rollChord('L2', { rng }))
  assert.equal(new Set(l2.map(r => r.root + r.quality)).size, 24)
  const mix = Array.from({ length: 600 }, () => rollChord('mix', { rng }))
  assert.ok(mix.some(r => r.levelId === 'L1') && mix.some(r => r.levelId === 'L2'))
  assert.deepEqual(LEVEL_CHOICES.map(c => c.key), ['L1', 'L2', 'mix'])
  const prev = { root: 'C', quality: 'major' }
  const nexts = Array.from({ length: 200 }, () => rollChord('L1', { rng, avoid: prev }))
  assert.ok(nexts.every(r => !(r.root === 'C' && r.quality === 'major')), 'never the same chord twice running')
})

// ---------- pitch-class and enharmonic matching ----------

test('pitch classes: octave ignored, repeats count once, both accidental styles read', () => {
  assert.deepEqual(pitchClassSet(['C4', 'E5', 'G2', 'C6', 'C']), [0, 4, 7])
  assert.equal(chromaOf('A♭'), 8)
  assert.equal(chromaOf('G#3'), 8)
  assert.equal(chromaOf('E𝄪'), 6)
  assert.equal(chromaOf('nonsense'), null)
})

test('enharmonic answers match: A♭ for G♯, F for E♯, C for B♯', () => {
  const gsm = resolveChord({ root: 'G#', quality: 'minor' })
  assert.ok(matches(gsm, ['A♭', 'B', 'E♭']))
  assert.ok(matches(gsm, ['G#4', 'B4', 'D#5', 'G#5']))
  assert.ok(matches(resolveChord({ root: 'C#', quality: 'major' }), ['Db', 'F', 'Ab']))
  assert.ok(matches(resolveChord({ root: 'G#', quality: 'major' }), ['Ab', 'C', 'Eb']))
  assert.ok(!matches(gsm, ['G#', 'B']), 'missing a note')
  assert.ok(!matches(gsm, ['G#', 'B', 'D#', 'E']), 'an extra note')
  assert.ok(!matches(gsm, ['G#', 'C', 'D#']), 'major third instead of minor')
})

test('every outcome matches its own notes in any spelling and any order', () => {
  for (const o of ALL) {
    const c = resolveChord(o)
    assert.ok(matches(c, c.notes))
    assert.ok(matches(c, [...c.chromas].reverse().map(ch => KEY_NAMES[ch].at(-1) + '5')))
    assert.ok(compare(c, c.chromas).complete)
  }
})

// ---------- interval feedback at Levels 1–2 ----------

// Every wrong key for every chord, from the name and from the sound, both
// with nothing else placed and with the rest of the chord in place.
test('a wrong note always names its interval, as a question, never a grade', () => {
  let cases = 0
  for (const o of ALL) {
    const c = resolveChord(o)
    const root = displayNote(c.root)
    for (let k = 0; k < 12; k++) {
      if (c.chromas.includes(k)) continue
      const semis = semitonesUp(c.chromas[0], k)
      for (const others of [[], c.chromas]) {
        const selected = [...others, k]
        const name = placementFeedback(c, k, selected, 'name')
        assert.ok(name.includes(INTERVAL_NAMES[semis]), `${c.symbol} + ${keyLabel(k)}: “${name}”`)
        assert.ok(name.includes(root), `measured from the root: “${name}”`)
        assert.ok(name.trim().endsWith('?'), `ends on a question: “${name}”`)
        assert.ok(!GRADE_WORDS.test(name), `no grade words: “${name}”`)
        if (o.quality === 'major' && semis === 3) assert.match(name, /Major needs a major third.*up a semitone\?$/)
        if (o.quality === 'minor' && semis === 4) assert.match(name, /Minor needs a minor third.*down a semitone\?$/)

        const sound = placementFeedback(c, k, selected, 'sound')
        assert.ok(sound.trim().endsWith('?') || sound.trim().endsWith('.'), sound)
        assert.ok(!GRADE_WORDS.test(sound), `no grade words: “${sound}”`)
        cases++
      }
    }
  }
  assert.equal(cases, 38 * 9 * 2)
})

test('Phase 0 examples read as drafted', () => {
  const am = resolveChord({ root: 'A', quality: 'minor' })
  assert.equal(placementFeedback(am, 1, [9, 1]),
    'You played a major third above A. Minor needs a minor third. What changes if you move that note down a semitone?')
  const fs = resolveChord({ root: 'F#', quality: 'major' })
  assert.equal(nextPrompt(fs, [6, 10]), 'You’ve found the root and major third. What completes the perfect fifth above F♯?')
  // A chord tone on a black key says why it is spelled that way.
  const fm = resolveChord({ root: 'F', quality: 'minor' })
  assert.equal(placementFeedback(fm, 8, [5, 8]),
    'A♭ is the minor third above F. That key is G♯/A♭. Here we write A♭ because it’s the minor third of F.')
  const cs = resolveChord({ root: 'C#', quality: 'major' })
  assert.match(placementFeedback(cs, 5, [1, 5]), /^E♯ is the major third above C♯\. That key is F\. Here we write E♯/)
})

test('one missing-note prompt at a time, in root, third, fifth order', () => {
  const d = resolveChord({ root: 'D', quality: 'major' })
  assert.equal(nextPrompt(d, []), 'Start with the root. Where is D?')
  assert.equal(nextPrompt(d, [2]), 'You’ve found the root. Which note is a major third above D?')
  assert.equal(nextPrompt(d, [2, 6]), 'You’ve found the root and major third. What completes the perfect fifth above D?')
  assert.equal(nextPrompt(d, [6, 9]), 'Where is the root, D?')
  assert.equal(nextPrompt(d, [2, 6, 9]), null)
  assert.equal(nextPrompt(d, [2, 6, 9, 0]), 'All three notes of D major are here, plus one more. Which would you take away?')
  for (const p of [nextPrompt(d, []), nextPrompt(d, [2]), nextPrompt(d, [2, 6])]) {
    assert.equal((p.match(/\?/g) || []).length, 1, 'a single question')
  }
})

// From sound, feedback may only name notes the student placed.
test('from sound, feedback never names the chord, its quality or an unplaced note', () => {
  for (const o of ALL) {
    const c = resolveChord(o)
    for (let k = 0; k < 12; k++) {
      for (const others of [[], [c.chromas[0]], [c.chromas[1]]]) {
        const selected = [...new Set([...others, k])]
        const lines = [placementFeedback(c, k, selected, 'sound'), nextPrompt(c, selected, 'sound') ?? '']
        for (const line of lines) {
          for (let i = 0; i < 3; i++) {
            if (selected.includes(c.chromas[i])) continue
            const spelled = displayNote(c.notes[i])
            const keyNames = KEY_NAMES[c.chromas[i]].map(displayNote)
            for (const n of new Set([spelled, ...keyNames])) {
              // The note as a word of its own: not the C of "Can", not the
              // G of "G♯".
              const re = new RegExp(`(^|[^A-Za-z])${n}(?![A-Za-z♯♭𝄪𝄫])`, 'u')
              // A key label the student tapped ("G♯/A♭") may share a letter
              // name with nothing hidden; only flag whole-name matches.
              const placedLabels = selected.map(keyLabel).join(' ')
              if (re.test(line) && !new RegExp(`(^|[^A-Za-z])${n}(?![A-Za-z♯♭𝄪𝄫])`, 'u').test(placedLabels)) {
                assert.fail(`${c.symbol} with [${selected}] leaks ${n}: “${line}”`)
              }
            }
          }
          assert.ok(!/\b(major|minor) (chord|triad)\b/.test(line), line)
          // A major chord's name is its root, checked as a note above; a
          // minor name ("Cm") must never appear.
          if (c.name !== displayNote(c.root)) assert.ok(!line.includes(c.name), line)
          assert.ok(!line.includes(c.prose), line)
        }
      }
    }
  }
})

test('finish reflections: replay count is neutral, reveal is named', () => {
  const c = resolveChord({ root: 'E', quality: 'minor' })
  assert.equal(finishReflection(c, { start: 'sound', replays: 3 }), 'You replayed it 3 times. What did you listen for on the last play?')
  assert.equal(finishReflection(c, { start: 'sound', replays: 1 }), 'You replayed it once. What did you listen for on the last play?')
  assert.match(finishReflection(c, { start: 'sound', replays: 0 }), /first play/)
  assert.match(finishReflection(c, { start: 'name' }), /makes it minor\?/)
  assert.match(finishReflection(c, { start: 'sound', replays: 2, revealed: true }), /listen for the minor third/)
  for (const line of [finishReflection(c, { start: 'sound', replays: 9 }), finishReflection(c, { start: 'name', revealed: true })]) {
    assert.ok(!GRADE_WORDS.test(line), line)
  }
})

// ---------- keep and serialise ----------

function memory(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

test('keep: reason required and trimmed, records start, replays and reveal', () => {
  const c = resolveChord({ root: 'Bb', quality: 'minor' })
  const now = new Date(Date.UTC(2026, 10, 25, 10))
  assert.throws(() => makeKept(c, { start: 'name', reason: '   ', now }))
  assert.throws(() => makeKept(c, { start: 'ear', reason: 'x', now }))
  const k = makeKept(c, { start: 'sound', replays: 4, revealed: true, reason: '  the dark third  ', levelKey: 'L2', now })
  assert.deepEqual(k, {
    id: String(now.getTime()), keptAt: now.toISOString(), root: 'Bb', quality: 'minor', colour: 'none', symbol: 'Bbm',
    start: 'sound', replays: 4, revealed: true, reason: 'the dark third', levelKey: 'L2',
  })
  assert.equal(makeKept(c, { start: 'name', replays: 9, reason: 'x', now }).replays, 0, 'no replays from the name')
  assert.equal(makeKept(c, { start: 'name', reason: 'y'.repeat(500), now }).reason.length, REASON_MAX)
})

test('kept chords round-trip through storage and survive bad entries', () => {
  const store = memory()
  const now = new Date(Date.UTC(2026, 10, 25))
  const a = makeKept(resolveChord({ root: 'C', quality: 'major' }), { start: 'name', reason: 'bright', now })
  const b = makeKept(resolveChord({ root: 'G#', quality: 'minor' }), { start: 'sound', replays: 2, revealed: true, reason: 'by ear', now: new Date(now.getTime() + 1) })
  writeKept([b, a], store)
  assert.equal(store.getItem(KEYS.kept), serialiseKept([b, a]))
  assert.deepEqual(readKept(store), [b, a])
  assert.equal(KEYS.kept, 'kyndaTools.chordDice.keptChords')
  assert.deepEqual(parseKept('not json'), [])
  assert.deepEqual(parseKept('{"a":1}'), [])
  const mixed = JSON.stringify([a, null, { ...a, root: 'H' }, { ...a, reason: '' }, { ...a, start: 'ear' }, { ...a, revealed: 'yes' }])
  const parsed = parseKept(mixed)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[1].revealed, false, 'only true is true')
})
