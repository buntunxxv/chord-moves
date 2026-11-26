import test from 'node:test'
import assert from 'node:assert/strict'
import { Chord, Note } from 'tonal'
import { BASSES, L1_ROOTS, L2_ROOTS, LEVEL_CHOICES, alternatives, changeOneDie, diceFor, displayNote, feedbackStyle, isProChord, levelIdsFor, needsPro, outcomes, poolFor, resolveChord, rollChord } from './faces.js'
import {
  INTERVAL_NAMES, KEY_NAMES, chromaOf, compare, describeChange, finishReflection, keyLabel, matches, nextPrompt,
  pitchClassSet, placementFeedback, semitonesUp, submitFeedback,
} from './answer.js'
import { selectionVoicing, targetVoicing } from './voicing.js'
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

test('rolls stay in their level; Mix draws from all three', () => {
  let seed = 7
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const l1 = Array.from({ length: 300 }, () => rollChord('L1', { rng }))
  assert.ok(l1.every(r => L1_ROOTS.includes(r.root)))
  const l2 = Array.from({ length: 600 }, () => rollChord('L2', { rng }))
  assert.equal(new Set(l2.map(r => r.root + r.quality)).size, 24)
  const mix = Array.from({ length: 600 }, () => rollChord('mix', { rng }))
  assert.ok(['L1', 'L2', 'L3'].every(l => mix.some(r => r.levelId === l)))
  assert.deepEqual(LEVEL_CHOICES.map(c => c.key), ['L1', 'L2', 'L3', 'L4', 'L5', 'mix'])
  assert.ok(mix.every(r => r.levelId !== 'L4'), 'Mix without Pro never rolls Level 4')
  const l3 = Array.from({ length: 900 }, () => rollChord('L3', { rng }))
  assert.equal(new Set(l3.map(r => r.root + r.quality + r.colour)).size, 48)
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
    id: String(now.getTime()), keptAt: now.toISOString(), root: 'Bb', quality: 'minor', colour: 'none', bass: 'root', symbol: 'Bbm',
    start: 'sound', replays: 4, revealed: true, reason: 'the dark third', levelKey: 'L2', changedFrom: null, bass: 'root',
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

// ================= PR 2: Level 3, Submit, Change one die =================

const L3 = outcomes('L3')
const L3_FORMULAS = { dim: ['1P', '3m', '5d'], aug: ['1P', '3M', '5A'], sus2: ['1P', '2M', '5P'], sus4: ['1P', '4P', '5P'] }
const L3_SEMIS = { dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7] }
const kind = o => o.quality

test('face table: 48 outcomes at Level 3, all 12 roots × dim, aug, sus2, sus4', () => {
  assert.equal(L3.length, 48)
  assert.deepEqual([...new Set(L3.map(o => o.root))], L2_ROOTS)
  assert.equal(new Set(L3.map(o => resolveChord(o).symbol)).size, 48)
  assert.equal(poolFor('mix').length, 14 + 24 - 14 + 48, 'Mix: Level 1 is inside Level 2, so 72 distinct chords')
  assert.equal(feedbackStyle('L1'), 'note')
  assert.equal(feedbackStyle('L2'), 'note')
  assert.equal(feedbackStyle('L3'), 'submit')
  assert.equal(feedbackStyle('mix'), 'submit')
})

for (const o of L3) {
  test(`Tonal resolves L3 ${o.root} ${kind(o)}`, () => {
    const c = resolveChord(o)
    const tonal = Chord.get(c.symbol)
    assert.equal(tonal.empty, false)
    assert.equal(tonal.tonic, o.root)
    assert.deepEqual(tonal.intervals, L3_FORMULAS[kind(o)])
    assert.deepEqual(c.notes, tonal.notes)
    assert.deepEqual(c.chromas.map(ch => semitonesUp(c.chromas[0], ch)), L3_SEMIS[kind(o)])
  })
}

test('Level 3 spellings, double accidentals included', () => {
  assert.deepEqual(resolveChord({ root: 'Eb', quality: 'dim' }).notes, ['Eb', 'Gb', 'Bbb'])
  assert.deepEqual(resolveChord({ root: 'G#', quality: 'aug' }).notes, ['G#', 'B#', 'D##'])
  assert.deepEqual(resolveChord({ root: 'F', quality: 'sus4' }).notes, ['F', 'Bb', 'C'])
  assert.equal(resolveChord({ root: 'Eb', quality: 'dim' }).name, 'E♭dim')
  assert.equal(resolveChord({ root: 'Bb', quality: 'sus2' }).name, 'B♭sus2')
  assert.equal(resolveChord({ root: 'C#', quality: 'aug' }).prose, 'C♯ augmented')
  assert.equal(resolveChord({ root: 'C', quality: 'sus4' }).prose, 'C sus4')
  assert.throws(() => resolveChord({ root: 'C', quality: 'sus', colour: 'none' }), 'sus is no longer a quality on its own')
  assert.throws(() => resolveChord({ root: 'C', quality: 'major', colour: 'sus4' }), 'sus4 is not a colour')
  for (const o of L3) assert.equal(o.colour, 'none', 'Level 3 has no colours: sus is on the Quality die')
  // Enharmonic answers: B𝄫 is the A key, D𝄪 the E key.
  assert.ok(matches(resolveChord({ root: 'Eb', quality: 'dim' }), ['D#', 'F#', 'A']))
  assert.ok(matches(resolveChord({ root: 'G#', quality: 'aug' }), ['Ab', 'C', 'E']))
})

// Every wrong note and every missing note, for every Level 3 chord.
test('Submit: extra and missing described separately, every Level 3 case', () => {
  let cases = 0
  for (const o of [...L3, ...ALL]) {
    const c = resolveChord(o)
    for (let k = 0; k < 12; k++) {
      if (c.chromas.includes(k)) continue
      for (const base of [c.chromas, [c.chromas[0], c.chromas[2]], [c.chromas[0]]]) {
        const sel = [...base, k]
        for (const mode of ['name', 'sound']) {
          const fb = submitFeedback(c, sel, mode)
          assert.equal(fb.complete, false)
          assert.ok(fb.extra, `${c.symbol} + ${keyLabel(k)} (${mode}) names the extra note`)
          assert.ok(fb.extra.includes(keyLabel(k)) || /You played/.test(fb.extra), fb.extra)
          for (const line of [fb.extra, fb.missing].filter(Boolean)) {
            assert.ok(!GRADE_WORDS.test(line), `no grade words: “${line}”`)
            assert.ok(line.trim().endsWith('?') || line.trim().endsWith('.'), line)
          }
          if (mode === 'name') {
            const semis = semitonesUp(c.chromas[0], k)
            assert.ok(fb.extra.includes(INTERVAL_NAMES[semis]), `${c.symbol} + ${keyLabel(k)}: “${fb.extra}”`)
          }
          const anyMissing = base.length < 3
          // A pair can cover the one missing note; otherwise it is named.
          if (!anyMissing) assert.equal(fb.missing, null)
          cases++
        }
      }
    }
  }
  assert.equal(cases, (48 + 38) * 9 * 3 * 2)
})

test('Submit: Phase 0 Level 3 example, pairing only when clear', () => {
  const csus4 = resolveChord({ root: 'C', quality: 'sus4' })
  assert.deepEqual(submitFeedback(csus4, [0, 4, 7]), {
    complete: false,
    extra: 'You played a major third above C. C sus4 uses a perfect fourth in place of the third. What changes if you move that note up a semitone?',
    missing: null,
    bass: null,
  })
  const cdim = resolveChord({ root: 'C', quality: 'dim' })
  assert.match(submitFeedback(cdim, [0, 3, 7]).extra, /perfect fifth above C\. C diminished uses a diminished fifth\. .*down a semitone\?$/)
  // E♭ is a semitone from D, and E is not in sus2: a clear pair.
  const csus2 = resolveChord({ root: 'C', quality: 'sus2' })
  assert.match(submitFeedback(csus2, [0, 3, 7]).extra, /^You played a minor third above C\. C sus2 uses a major second in place of the third\. .*down a semitone\?$/)
  // F♯ sits a semitone from both F and G, both missing: no pairing, both lines speak.
  const amb = submitFeedback(csus4, [0, 6])
  assert.equal(amb.extra, 'F♯/G♭ is a tritone (augmented fourth or diminished fifth) above C. C sus4 doesn’t use it. Which would you take away?')
  assert.equal(amb.missing, 'Which note is a perfect fourth above C?')
  assert.equal(submitFeedback(csus2, [0, 2, 7]).complete, true)
  assert.deepEqual(submitFeedback(cdim, [0]), { complete: false, extra: null, missing: 'Which note is a minor third above C?', bass: null })
})

test('Submit from the sound never names the chord, its quality or an unplaced note', () => {
  for (const o of [...L3, ...ALL]) {
    const c = resolveChord(o)
    for (let k = 0; k < 12; k++) {
      for (const base of [[], [c.chromas[0]], [c.chromas[1], c.chromas[2]]]) {
        const sel = [...new Set([...base, k])]
        const fb = submitFeedback(c, sel, 'sound')
        for (const line of [fb.extra, fb.missing].filter(Boolean)) {
          for (let i = 0; i < 3; i++) {
            if (sel.includes(c.chromas[i])) continue
            for (const n of new Set([displayNote(c.notes[i]), ...KEY_NAMES[c.chromas[i]].map(displayNote)])) {
              const re = new RegExp(`(^|[^A-Za-z])${n}(?![A-Za-z♯♭𝄪𝄫])`, 'u')
              const placed = sel.map(keyLabel).join(' ')
              if (re.test(line) && !re.test(placed)) assert.fail(`${c.symbol} [${sel}] leaks ${n}: “${line}”`)
            }
          }
          assert.ok(!line.includes(c.prose), line)
          assert.ok(!/\b(major|minor|diminished|augmented|suspended|sus[24])\b/.test(line), line)
        }
      }
    }
  }
})

// ---------- Change one die ----------

test('alternatives keep the other dice and stay inside the level', () => {
  for (const levelKey of ['L1', 'L2', 'L3', 'mix']) {
    for (const o of poolFor(levelKey)) {
      for (const die of ['root', 'quality', 'colour']) {
        for (const alt of alternatives(o, die, levelKey)) {
          assert.notEqual(alt[die], o[die])
          for (const other of ['root', 'quality', 'colour'].filter(d => d !== die)) assert.equal(alt[other], o[other])
          assert.doesNotThrow(() => resolveChord(alt))
        }
      }
    }
  }
  assert.equal(alternatives({ root: 'C', quality: 'major', colour: 'none' }, 'root', 'L1').length, 6)
  assert.deepEqual(alternatives({ root: 'C', quality: 'major', colour: 'none' }, 'quality', 'L1').map(o => o.quality), ['minor'])
  assert.deepEqual(alternatives({ root: 'C', quality: 'dim', colour: 'none' }, 'quality', 'L3').map(o => o.quality), ['aug', 'sus2', 'sus4'])
  assert.deepEqual(alternatives({ root: 'C', quality: 'sus2', colour: 'none' }, 'quality', 'L3').map(o => o.quality), ['dim', 'aug', 'sus4'])
  assert.deepEqual(alternatives({ root: 'C', quality: 'sus4', colour: 'none' }, 'colour', 'L3'), [])
  assert.deepEqual(alternatives({ root: 'C', quality: 'major', colour: 'none' }, 'quality', 'mix').map(o => o.quality), ['minor', 'dim', 'aug', 'sus2', 'sus4'])
})

test('Levels 1–3 roll two dice; every die on the tray can always change', () => {
  for (const levelKey of ['L1', 'L2', 'L3', 'mix']) {
    assert.deepEqual(diceFor(levelKey), ['root', 'quality'], `${levelKey}: no Colour die until Level 4`)
    for (const o of poolFor(levelKey)) {
      for (const die of diceFor(levelKey)) {
        assert.ok(changeOneDie(o, die, levelKey, { rng: () => 0 }).outcome, `${levelKey} ${o.root}${o.quality}: ${die} can change`)
      }
    }
  }
  // The blocked message stays for Level 4, when a die can run out of faces.
  assert.equal(changeOneDie({ root: 'C', quality: 'major', colour: 'none' }, 'colour', 'L1', { rng: () => 0 }).blocked,
    'The Colour die has only “none” at this level. Change the Root or the Quality instead, or move up a level.')
  const ok = changeOneDie({ root: 'C', quality: 'major', colour: 'none' }, 'quality', 'L2', { rng: () => 0 })
  assert.deepEqual(ok.outcome, { root: 'C', quality: 'minor', colour: 'none', bass: 'root', levelId: 'L2', levelKey: 'L2' })
})

test('the change reflection says what moved, then asks', () => {
  const r = (root, quality, colour = 'none') => resolveChord({ root, quality, colour })
  assert.equal(describeChange(r('C', 'major'), r('C', 'minor'), 'quality'),
    'You changed the Quality: C became Cm. E moved down a semitone to E♭. What does that change do to the sound?')
  assert.equal(describeChange(r('C', 'sus2'), r('C', 'sus4'), 'quality'),
    'You changed the Quality: Csus2 became Csus4. D moved up 3 semitones to F. What does that change do to the sound?')
  assert.equal(describeChange(r('C', 'dim'), r('C', 'aug'), 'quality'),
    'You changed the Quality: Cdim became Caug. E♭ moved up a semitone to E, and G♭ moved up 2 semitones to G♯. What does that change do to the sound?'.replace('up 2 semitones', 'up a tone'))
  assert.equal(describeChange(r('C', 'major'), r('A', 'major'), 'root'),
    'You changed the Root: C became A. Every note moved down a minor third, so the shape stayed the same. What changed in the sound, and what didn’t?')
  const line = finishReflection(r('C', 'minor'), { start: 'sound', replays: 2, changedFrom: { die: 'quality', chord: r('C', 'major') } })
  assert.match(line, /^You replayed it twice\. You changed the Quality/)
  for (const l of [line, describeChange(r('G#', 'aug'), r('G#', 'major'), 'quality')]) assert.ok(!GRADE_WORDS.test(l), l)
})

test('finish reflections for Level 3 qualities', () => {
  assert.match(finishReflection(resolveChord({ root: 'B', quality: 'dim' }), { start: 'name' }), /^Two notes make it diminished/)
  assert.match(finishReflection(resolveChord({ root: 'B', quality: 'aug' }), { start: 'name' }), /makes it augmented\?/)
  assert.match(finishReflection(resolveChord({ root: 'B', quality: 'sus4' }), { start: 'name' }), /perfect fourth do in place of the third\?/)
})

test('kept Level 3 and changed chords round-trip', () => {
  const store = memory()
  const now = new Date(Date.UTC(2026, 10, 26))
  const c = resolveChord({ root: 'Eb', quality: 'dim' })
  const k = makeKept(c, { start: 'name', reason: 'tense', levelKey: 'L3', changedFrom: { die: 'quality', symbol: 'Eb' }, now })
  assert.deepEqual(k.changedFrom, { die: 'quality', symbol: 'Eb' })
  const plain = makeKept(resolveChord({ root: 'C', quality: 'sus2' }), { start: 'sound', reason: 'open', now: new Date(now.getTime() + 1) })
  assert.equal(plain.changedFrom, null)
  writeKept([k, plain], store)
  assert.deepEqual(readKept(store), [k, plain])
  const bad = parseKept(JSON.stringify([{ ...k, changedFrom: { die: 'tempo', symbol: 'C' } }, { ...k, quality: 'sus', colour: 'none' }]))
  assert.equal(bad.length, 1, 'a chord that cannot exist is dropped')
  assert.equal(bad[0].changedFrom, null, 'an unknown change is ignored, the chord kept')
  // Sus chords kept before the Quality die took sus2/sus4 still load.
  const old = parseKept(JSON.stringify([{ ...plain, quality: 'sus', colour: 'sus4', symbol: 'Csus4' }]))
  assert.equal(old.length, 1)
  assert.equal(old[0].quality, 'sus4')
  assert.equal(old[0].colour, 'none')
  assert.equal(resolveChord(old[0]).name, 'Csus4')
})

// ================= PR 3: Level 4 sevenths, Pro =================

const L4 = outcomes('L4')
const L4_FORMULAS = { 'dom/7': ['1P', '3M', '5P', '7m'], 'major/7': ['1P', '3M', '5P', '7M'], 'minor/7': ['1P', '3m', '5P', '7m'] }

test('face table: 36 outcomes at Level 4, all 12 roots × 7, maj7, m7', () => {
  assert.equal(L4.length, 36)
  assert.deepEqual([...new Set(L4.map(o => o.root))], L2_ROOTS)
  assert.equal(new Set(L4.map(o => resolveChord(o).symbol)).size, 36)
  assert.ok(needsPro('L4') && !needsPro('L3') && !needsPro('mix'))
  assert.equal(feedbackStyle('L4'), 'submit')
  assert.deepEqual(levelIdsFor('mix'), ['L1', 'L2', 'L3'])
  assert.deepEqual(levelIdsFor('mix', true), ['L1', 'L2', 'L3', 'L4', 'L5'])
  assert.equal(poolFor('mix', true).length, 72 + 36 + 132)
  assert.deepEqual(diceFor('L4'), ['root', 'quality', 'colour'], 'the Colour die returns at Level 4')
  assert.deepEqual(diceFor('mix'), ['root', 'quality'])
  assert.deepEqual(diceFor('mix', true), ['root', 'quality', 'colour', 'bass'])
  assert.ok(L4.every(isProChord) && !L3.some(isProChord))
})

for (const o of L4) {
  test(`Tonal resolves L4 ${resolveChord(o).symbol}`, () => {
    const c = resolveChord(o)
    const tonal = Chord.get(c.symbol)
    assert.equal(tonal.empty, false)
    assert.equal(tonal.tonic, o.root)
    assert.deepEqual(tonal.intervals, L4_FORMULAS[`${o.quality}/${o.colour}`])
    assert.deepEqual(c.notes, tonal.notes)
    assert.equal(c.chromas.length, 4)
  })
}

test('Level 4 names and spellings', () => {
  const r = (root, quality, colour) => resolveChord({ root, quality, colour })
  // The dice read as the chord is said: dom·7 is C7, major·7 is Cmaj7.
  assert.equal(r('C', 'dom', '7').name, 'C7')
  assert.equal(r('C', 'dom', '7').prose, 'C dominant seventh')
  assert.equal(r('Bb', 'major', '7').name, 'B♭maj7')
  assert.equal(r('Bb', 'major', '7').prose, 'B♭ major seventh')
  assert.equal(r('F#', 'minor', '7').name, 'F♯m7')
  assert.deepEqual(r('G#', 'major', '7').notes, ['G#', 'B#', 'D#', 'F##'])
  assert.ok(matches(r('G#', 'major', '7'), ['Ab', 'C', 'Eb', 'G']))
  assert.throws(() => r('C', 'minor', 'maj7'), 'maj7 is no longer a Colour face')
  assert.throws(() => r('C', 'dim', '7'))
  assert.throws(() => r('C', 'dom', 'none'), 'dominant always comes with a colour')
  assert.throws(() => r('C', 'dom', 'add9'))
})

test('Submit at Level 4: Phase 0 example and every wrong note', () => {
  const cmaj7 = resolveChord({ root: 'C', quality: 'major', colour: '7' })
  assert.deepEqual(submitFeedback(cmaj7, [0, 4, 7, 10]), {
    complete: false,
    extra: 'You played a minor seventh above C. C major seventh uses a major seventh. What changes if you move that note up a semitone?',
    missing: null,
    bass: null,
  })
  assert.equal(submitFeedback(cmaj7, [0, 4, 7]).missing, 'The triad is there. What happens when you add the major seventh, B?')
  assert.equal(submitFeedback(cmaj7, [0, 4, 7, 11]).complete, true)
  for (const o of L4) {
    const c = resolveChord(o)
    for (let k = 0; k < 12; k++) {
      if (c.chromas.includes(k)) continue
      for (const mode of ['name', 'sound']) {
        const fb = submitFeedback(c, [...c.chromas.slice(0, 3), k], mode)
        assert.ok(fb.extra && !GRADE_WORDS.test(fb.extra), `${c.symbol} + ${k}: ${fb.extra}`)
        if (mode === 'sound') {
          for (const line of [fb.extra, fb.missing].filter(Boolean)) {
            assert.ok(!/seventh|dominant/.test(line), `from the sound, no hint of the seventh: “${line}”`)
          }
        }
      }
    }
  }
})

test('Change one die at Level 4: the Quality die moves between the sevenths', () => {
  const rng = () => 0
  assert.deepEqual(alternatives({ root: 'C', quality: 'dom', colour: '7' }, 'quality', 'L4').map(o => o.quality), ['major', 'minor'])
  assert.deepEqual(alternatives({ root: 'C', quality: 'major', colour: '7' }, 'colour', 'L4'), [])
  assert.equal(changeOneDie({ root: 'C', quality: 'minor', colour: '7' }, 'colour', 'L4', { rng }).blocked,
    'The Colour die has only “7” at this level. Change the Root or the Quality instead, or move up a level.')
  // Mix with Pro: a triad's Colour can gain a seventh.
  const added = changeOneDie({ root: 'C', quality: 'major', colour: 'none' }, 'colour', 'mix', { rng, isPro: true })
  assert.equal(added.outcome.colour, '7')
  assert.equal(changeOneDie({ root: 'C', quality: 'major', colour: 'none' }, 'colour', 'mix', { rng }).blocked !== undefined, true, 'without Pro, Mix has no colours')
  const r = (root, quality, colour) => resolveChord({ root, quality, colour })
  assert.equal(describeChange(r('C', 'major', 'none'), r('C', 'major', '7'), 'colour'),
    'You changed the Colour: C became Cmaj7. A major seventh, B, was added on top. What does that change do to the sound?')
  assert.equal(describeChange(r('C', 'major', '7'), r('C', 'major', 'none'), 'colour'),
    'You changed the Colour: Cmaj7 became C. The major seventh, B, came off the top. What does that change do to the sound?')
  assert.equal(describeChange(r('C', 'dom', '7'), r('C', 'major', '7'), 'quality'),
    'You changed the Quality: C7 became Cmaj7. B♭ moved up a semitone to B. What does that change do to the sound?')
  assert.equal(describeChange(r('D', 'dom', '7'), r('D', 'minor', '7'), 'quality'),
    'You changed the Quality: D7 became Dm7. F♯ moved down a semitone to F. What does that change do to the sound?')
  assert.match(finishReflection(r('A', 'minor', '7'), { start: 'name' }), /What does the minor seventh add on top\?/)
})

test('kept Level 4 chords round-trip', () => {
  const store = memory()
  const k = makeKept(resolveChord({ root: 'Eb', quality: 'major', colour: '7' }), { start: 'name', reason: 'soft', levelKey: 'L4', now: new Date(Date.UTC(2026, 10, 27)) })
  writeKept([k], store)
  assert.deepEqual(readKept(store), [k])
  assert.ok(isProChord(readKept(store)[0]))
})

// ================= PR 4: Level 5, the Bass die, ninths =================

const L5 = outcomes('L5')
const L5_FORMULAS = {
  'major/add9': ['1P', '3M', '5P', '9M'], 'minor/add9': ['1P', '3m', '5P', '9M'],
  'dom/9': ['1P', '3M', '5P', '7m', '9M'], 'major/9': ['1P', '3M', '5P', '7M', '9M'], 'minor/9': ['1P', '3m', '5P', '7m', '9M'],
}
const r5 = (root, quality, colour = 'none', bass = 'root') => resolveChord({ root, quality, colour, bass })

test('face table: 132 outcomes at Level 5', () => {
  assert.equal(L5.length, 132)
  assert.equal(L5.filter(o => o.bass !== 'root').length, 72, '12 roots × major/minor × 3rd, 5th, 2nd')
  assert.equal(L5.filter(o => o.colour !== 'none').length, 60, '12 roots × add9, madd9, 9, maj9, m9')
  assert.equal(new Set(L5.map(o => resolveChord(o).symbol)).size, 132)
  assert.deepEqual(diceFor('L5'), ['root', 'quality', 'colour', 'bass'], 'the Bass die joins at Level 5')
  assert.deepEqual(diceFor('L4'), ['root', 'quality', 'colour'])
  assert.ok(needsPro('L5') && feedbackStyle('L5') === 'submit')
  assert.ok(L5.every(isProChord))
  assert.deepEqual(Object.values(BASSES).map(b => b.label), ['2nd', '3rd', '5th', 'root'])
})

for (const o of L5) {
  test(`Tonal resolves L5 ${resolveChord(o).symbol}`, () => {
    const c = resolveChord(o)
    const tonal = Chord.get(c.symbol)
    assert.equal(tonal.empty, false)
    assert.equal(tonal.tonic, o.root)
    assert.deepEqual(new Set(c.chromas), new Set(tonal.notes.map(Note.chroma)), 'the answer is Tonal’s pitch set, foreign bass included')
    if (o.bass === 'root') {
      assert.deepEqual(tonal.intervals, L5_FORMULAS[`${o.quality}/${o.colour}`])
      assert.deepEqual(c.notes, tonal.notes)
      assert.equal(c.bass.chroma, c.chromas[0])
    } else {
      assert.equal(tonal.bass, c.bass.note, 'the bass note is Tonal’s')
      assert.equal(tonal.notes[0], c.bass.note, 'and sounds first')
      assert.equal(semitonesUp(c.chromas[0], c.bass.chroma), { 3: o.quality === 'major' ? 4 : 3, 5: 7, 2: 2 }[o.bass])
    }
  })
}

test('Level 5 names, prose and spellings', () => {
  assert.equal(r5('C', 'major', 'none', '3').name, 'C/E')
  assert.equal(r5('C', 'minor', 'none', '3').name, 'Cm/E♭')
  assert.equal(r5('C', 'major', 'none', '2').name, 'C/D')
  assert.deepEqual(r5('C', 'major', 'none', '2').notes, ['C', 'E', 'G', 'D'], 'the 2nd joins the chord, below it')
  assert.equal(r5('C', 'major', 'add9').name, 'Cadd9')
  assert.equal(r5('C', 'minor', 'add9').name, 'Cmadd9')
  assert.equal(r5('C', 'minor', 'add9').prose, 'C minor add9')
  assert.equal(r5('Bb', 'dom', '9').prose, 'B♭ dominant ninth')
  assert.equal(r5('Bb', 'major', '9').name, 'B♭maj9')
  assert.equal(r5('F#', 'minor', '9').name, 'F♯m9')
  assert.deepEqual(r5('G#', 'major', '9').notes, ['G#', 'B#', 'D#', 'F##', 'A#'])
  assert.throws(() => r5('C', 'major', '9', '3'), 'extensions keep the root in the bass')
  assert.throws(() => r5('C', 'dim', 'none', '3'))
})

test('the bass is checked apart from the notes: Phase 0 examples', () => {
  const ce = r5('C', 'major', 'none', '3')
  assert.deepEqual(submitFeedback(ce, [0, 4, 7], 'name', 7), {
    complete: false, extra: null, missing: null,
    bass: 'Your chord tones are there. You chose the perfect fifth as bass. Which note is the major third?',
  })
  assert.equal(submitFeedback(ce, [0, 4, 7], 'name', null).bass,
    'Your chord tones are there. The bass is still the root. Which note is the major third? Mark it as the bass.')
  assert.equal(submitFeedback(ce, [0, 4, 7], 'name', 4).complete, true)
  // Same notes, different bass: C/G is not C/E.
  assert.equal(submitFeedback(r5('C', 'major', 'none', '5'), [0, 4, 7], 'name', 4).complete, false)
  // Root-position chords: an unmarked bass is the root.
  const cadd9 = r5('C', 'major', 'add9')
  assert.equal(submitFeedback(cadd9, [0, 4, 7, 2]).complete, true)
  assert.equal(submitFeedback(cadd9, [0, 4, 7, 2], 'name', 0).complete, true)
  assert.match(submitFeedback(cadd9, [0, 4, 7, 2], 'name', 4).bass, /You chose the major third as bass\. Which note is the root\?$/)
  assert.equal(submitFeedback(cadd9, [0, 4, 7]).missing, 'The triad is there. What happens when you add the major ninth, D?')
  assert.equal(submitFeedback(r5('C', 'dom', '9'), [0, 4, 7]).missing, 'The triad is there. What happens when you add the minor seventh, B♭?')
  // The foreign 2nd must be played as well as marked.
  const cd = r5('C', 'major', 'none', '2')
  assert.equal(submitFeedback(cd, [0, 4, 7, 2], 'name', 2).complete, true)
  assert.equal(submitFeedback(cd, [0, 4, 7], 'name').missing, 'Which note is a major second above C?')
  assert.match(submitFeedback(cd, [0, 4, 7, 2], 'name').bass, /Which note is the major second\? Mark it as the bass\.$/)
})

test('from the sound, the bass line names only what the student marked', () => {
  for (const o of L5.filter(x => x.bass !== 'root')) {
    const c = resolveChord(o)
    for (const mark of [null, ...c.chromas]) {
      const fb = submitFeedback(c, c.chromas, 'sound', mark)
      if (fb.complete) continue
      assert.ok(fb.bass, `${c.symbol} marked ${mark}`)
      assert.ok(!/third|fifth|second|root|seventh|ninth/.test(fb.bass), fb.bass)
      for (const n of [displayNote(c.bass.note), ...KEY_NAMES[c.bass.chroma].map(displayNote)]) {
        if (mark === c.bass.chroma) continue
        const re = new RegExp(`(^|[^A-Za-z])${n}(?![A-Za-z♯♭𝄪𝄫])`, 'u')
        const markedLabel = mark === null ? '' : keyLabel(mark)
        if (re.test(fb.bass) && !re.test(markedLabel)) assert.fail(`${c.symbol} leaks its bass: “${fb.bass}”`)
      }
      assert.ok(!GRADE_WORDS.test(fb.bass), fb.bass)
    }
  }
})

test('Change one die at Level 5: the Bass die and blocked dice', () => {
  const rng = () => 0
  assert.deepEqual(alternatives({ root: 'C', quality: 'major', colour: 'none', bass: '3' }, 'bass', 'L5').map(o => o.bass), ['5', '2'])
  assert.equal(changeOneDie({ root: 'C', quality: 'major', colour: 'none', bass: '3' }, 'colour', 'L5', { rng }).blocked,
    'Nothing else on the Colour die fits with the 3rd in the bass here. Change the Bass first.')
  assert.equal(changeOneDie({ root: 'C', quality: 'major', colour: 'add9', bass: 'root' }, 'bass', 'L5', { rng }).blocked,
    'Nothing else on the Bass die fits with the add9 colour here. Change the Colour first.')
  assert.equal(changeOneDie({ root: 'C', quality: 'dom', colour: '9', bass: 'root' }, 'colour', 'L5', { rng }).blocked,
    'Nothing else on the Colour die fits with a dominant chord here. Change the Quality first.')
  assert.deepEqual(alternatives({ root: 'C', quality: 'major', colour: '9', bass: 'root' }, 'quality', 'L5').map(o => o.quality), ['dom', 'minor'])
  // At Levels 1–3 the old wording stays: only the dice on the tray are named.
  assert.equal(changeOneDie({ root: 'C', quality: 'major', colour: 'none' }, 'colour', 'L1', { rng }).blocked,
    'The Colour die has only “none” at this level. Change the Root or the Quality instead, or move up a level.')
  assert.equal(describeChange(r5('C', 'major', 'none', '3'), r5('C', 'major', 'none', '5'), 'bass'),
    'You changed the Bass: C/E became C/G. The lowest note moved from E to G. What does that change do to the sound?')
  assert.equal(describeChange(r5('C', 'major', 'none', '5'), r5('C', 'major', 'none', '2'), 'bass'),
    'You changed the Bass: C/G became C/D. The lowest note moved from G to D. D isn’t one of the triad’s own notes. What does that change do to the sound?')
  assert.equal(describeChange(r5('C', 'major', 'none', '3'), r5('C', 'minor', 'none', '3'), 'quality'),
    'You changed the Quality: C/E became Cm/E♭. E moved down a semitone to E♭. What does that change do to the sound?')
  assert.equal(describeChange(r5('C', 'major', 'add9'), r5('C', 'dom', '9'), 'colour'),
    'You changed the Colour: Cadd9 became C9. A minor seventh, B♭, was added on top. What does that change do to the sound?')
  assert.equal(describeChange(r5('C', 'dom', '9'), r5('C', 'major', '9'), 'quality'),
    'You changed the Quality: C9 became Cmaj9. B♭ moved up a semitone to B. What does that change do to the sound?')
  assert.equal(describeChange(r5('C', 'major', '9'), r5('C', 'major', 'none'), 'colour'),
    'You changed the Colour: Cmaj9 became C. The major seventh, B, came off the top, and the major ninth, D, came off the top. What does that change do to the sound?')
  assert.match(finishReflection(r5('C', 'major', 'none', '3'), { start: 'name' }), /^The major third, E, is in the bass\./)
  assert.match(finishReflection(r5('C', 'major', '9'), { start: 'name' }), /What does the major ninth add on top\?/)
  assert.match(finishReflection(r5('C', 'major', 'none', '2'), { start: 'name', revealed: true }), /listen for the D in the bass/)
})

test('kept Level 5 chords keep their bass', () => {
  const store = memory()
  const k = makeKept(r5('Eb', 'minor', 'none', '3'), { start: 'sound', reason: 'dark and leaning', levelKey: 'L5', now: new Date(Date.UTC(2026, 10, 28)) })
  assert.equal(k.bass, '3')
  writeKept([k], store)
  const back = readKept(store)
  assert.deepEqual(back, [k])
  assert.equal(resolveChord(back[0]).name, 'E♭m/G♭')
  assert.ok(isProChord(back[0]))
})

test('playback: every chord rises from its bass; a slash bass sounds lowest', () => {
  for (const o of [...ALL, ...L3, ...L4, ...L5]) {
    const c = resolveChord(o)
    const v = targetVoicing(c)
    assert.ok(v.every((m, i) => i === 0 || m > v[i - 1]), `${c.symbol} rises: ${v}`)
    assert.equal(((v[0] % 12) + 12) % 12, c.bass.chroma, `${c.symbol} has its bass lowest`)
    assert.deepEqual(new Set(v.map(m => m % 12)), new Set(c.chromas), `${c.symbol} plays every note`)
    assert.ok(v[0] >= 36 && v.at(-1) <= 84, `${c.symbol} stays in range: ${v}`)
  }
  assert.deepEqual(targetVoicing(r5('C', 'major', 'none', '3')), [52, 60, 64, 67], 'C/E: E3 under C4 E4 G4')
  assert.deepEqual(targetVoicing(r5('C', 'major', 'none', '2')), [50, 60, 64, 67], 'C/D: D3 under the triad')
  assert.deepEqual(selectionVoicing([0, 4, 7], 4), [52, 60, 64, 67], 'the marked bass sounds an octave down')
  assert.deepEqual(selectionVoicing([7, 0, 4, 0]), [60, 64, 67])
})

test('sevenths and ninths kept before 26 Nov read as the chord they were', () => {
  const base = { id: '1', keptAt: '2026-11-25T00:00:00.000Z', root: 'C', start: 'name', reason: 'r', replays: 0, revealed: false, bass: 'root' }
  const old = parseKept(JSON.stringify([
    { ...base, quality: 'major', colour: '7', symbol: 'C7' },
    { ...base, quality: 'major', colour: 'maj7', symbol: 'Cmaj7' },
    { ...base, quality: 'major', colour: '9', symbol: 'C9' },
    { ...base, quality: 'major', colour: 'maj9', symbol: 'Cmaj9' },
    { ...base, quality: 'minor', colour: '7', symbol: 'Cm7' },
    // Today's shape stays as it is.
    { ...base, quality: 'major', colour: '7', symbol: 'Cmaj7' },
  ]))
  assert.deepEqual(old.map(k => resolveChord(k).name), ['C7', 'Cmaj7', 'C9', 'Cmaj9', 'Cm7', 'Cmaj7'])
  assert.deepEqual(old.map(k => `${k.quality}/${k.colour}`), ['dom/7', 'major/7', 'dom/9', 'major/9', 'minor/7', 'major/7'])
})

// Founder decision (26 Nov): notes are named from the chord's key and scale.
// A major is A–C♯–E, never A–D♭–E; every chord on every level is spelled by
// letter from its root (each chord tone on its own letter).
test('every chord is spelled from its root, letter by letter', () => {
  assert.deepEqual(resolveChord({ root: 'A', quality: 'major' }).notes, ['A', 'C#', 'E'])
  const letters = 'CDEFGAB'
  const step = { root: 0, third: 2, fifth: 4, second: 1, fourth: 3, seventh: 6, ninth: 1 }
  for (const o of [...ALL, ...L3, ...L4, ...L5]) {
    const c = resolveChord(o)
    const r = letters.indexOf(c.root[0])
    c.roles.forEach((role, i) => {
      const kind = Object.keys(step).find(k => role.name.endsWith(k))
      assert.equal(c.notes[i][0], letters[(r + step[kind]) % 7], `${c.symbol}: the ${role.name} is ${c.notes[i]}`)
    })
  }
})
