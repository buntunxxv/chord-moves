// M0 notation feasibility check -- DISPOSABLE PROTOTYPE, never merged.
// Fixtures F1-F12 from the M0 brief, in the approved note format (AP 36):
// already-spelled pitches, start tick and length in ticks (12 per crotchet,
// 48 per 4/4 bar), notes may cross barlines. Chords are a symbol at a tick.
//
// `expect` is counted by hand from the music, NOT from the renderer, so the
// T1 check compares the drawing against an independent answer:
//   notes       noteheads drawn for sounding notes (a tied note counts once
//               per written piece)
//   rests       rests drawn
//   ties        tie arcs (one per pair of tied pieces)
//   accidentals accidental glyphs drawn (sharps + flats + naturals)
//   sharps / flats / naturals  where the fixture tests spelling
//   chords      chord symbols drawn
//   keyFlats    flats in the key signature (0 = no key signature)
//   swing       a swing marking is drawn

const n = (pitch, start, ticks) => ({ pitch, start, ticks })
const c = (symbol, start) => ({ symbol, start })
const BAR = 48

// Shift a list of notes or chords by whole bars.
const shift = (items, bars) => items.map(i => ({ ...i, start: i.start + bars * BAR }))

const F1_BAR1 = [n('C4', 0, 12), n('D4', 12, 12), n('E4', 24, 6), n('G4', 30, 6), n('A4', 36, 12)]
const F2_BAR1 = [
  n('C5', 0, 3), n('D5', 3, 3), n('E5', 6, 3), n('G5', 9, 3),
  // semiquaver rest 12-15
  n('A5', 15, 3), n('G5', 18, 3), n('E5', 21, 3),
  // quaver rest 24-30
  n('D5', 30, 3), n('C5', 33, 3), n('A4', 36, 6),
  // quaver rest 42-48
]
const F5_BAR1 = [n('C4', 0, 6), n('E4', 6, 12), n('G4', 18, 6), n('A4', 24, 6), n('G4', 30, 12), n('E4', 42, 6)]
const F6_BAR1 = [n('A3', 0, 12), n('C4', 12, 12), n('E6', 24, 12), n('C6', 36, 12)]

const F11_NOTES = [
  ...F1_BAR1, // bar 1: 5 notes
  ...shift(F2_BAR1, 1), // bar 2: 10 notes, 3 rests
  // bar 3: rests 0-42 (minim, crotchet, quaver), G4 from 4& tied into bar 4
  n('G4', 2 * BAR + 42, 18),
  // bar 4: tie continuation (0-12), then blues accidentals
  n('F4', 3 * BAR + 12, 6), n('Gb4', 3 * BAR + 18, 6), n('G4', 3 * BAR + 24, 12), n('Bb4', 3 * BAR + 36, 12),
  ...shift(F6_BAR1, 4), // bar 5: range, 4 notes
  ...shift(F5_BAR1, 5), // bar 6: syncopation, 6 notes
  // bar 7: minim, then a minim tied into bar 8
  n('C5', 6 * BAR, 24), n('E5', 6 * BAR + 24, 48),
  // bar 8: continuation (0-24), then two crotchets
  n('D5', 7 * BAR + 24, 12), n('C5', 7 * BAR + 36, 12),
]
const F11_CHORDS = [
  c('C', 0), c('Am7', BAR), c('F/A', 2 * BAR), c('C7', 3 * BAR), c('F7', 3 * BAR + 24),
  c('C', 4 * BAR), c('G7#9', 6 * BAR), c('C', 7 * BAR),
]

export const FIXTURES = [
  {
    id: 'F1', title: 'Crotchets and quavers, C major pentatonic, no key signature', bars: 2,
    notes: [...F1_BAR1, n('G4', 48, 6), n('E4', 54, 6), n('D4', 60, 12), n('C4', 72, 24)],
    chords: [],
    expect: { notes: 9, rests: 0, ties: 0, accidentals: 0, chords: 0, keyFlats: 0, swing: false },
  },
  {
    id: 'F2', title: 'Semiquaver run with semiquaver and quaver rests', bars: 1,
    notes: F2_BAR1, chords: [],
    expect: { notes: 10, rests: 3, ties: 0, accidentals: 0, chords: 0, keyFlats: 0, swing: false },
  },
  {
    id: 'F3', title: 'Pickup on 4& tied over the barline', bars: 2,
    notes: [n('G4', 42, 18), n('E4', 60, 12), n('D4', 72, 12), n('C4', 84, 12)],
    chords: [],
    // bar 1 rests: minim (0-24), crotchet (24-36), quaver (36-42)
    expect: { notes: 5, rests: 3, ties: 1, accidentals: 0, chords: 0, keyFlats: 0, swing: false },
  },
  {
    id: 'F4', title: 'One note held across two barlines', bars: 3,
    notes: [n('E4', 24, 96)],
    chords: [],
    // pieces: minim (bar 1), semibreve (bar 2), minim (bar 3); rests: minim in bars 1 and 3
    expect: { notes: 3, rests: 2, ties: 2, accidentals: 0, chords: 0, keyFlats: 0, swing: false },
  },
  {
    id: 'F5', title: 'Syncopated quaver-crotchet-quaver, beamed by beat', bars: 1,
    notes: F5_BAR1, chords: [],
    expect: { notes: 6, rests: 0, ties: 0, accidentals: 0, chords: 0, keyFlats: 0, swing: false },
  },
  {
    id: 'F6', title: 'Range A3 to E6 with ledger lines', bars: 2,
    notes: [...F6_BAR1, n('A5', 48, 24), n('A3', 72, 24)],
    chords: [],
    expect: { notes: 6, rests: 0, ties: 0, accidentals: 0, chords: 0, keyFlats: 0, swing: false },
  },
  {
    id: 'F7', title: 'Author key set to E-flat major: key signature', bars: 2, keySignature: 'Eb',
    notes: [
      n('Eb4', 0, 12), n('F4', 12, 12), n('G4', 24, 12), n('Bb4', 36, 12),
      n('Ab4', 48, 12), n('G4', 60, 12), n('F4', 72, 12), n('Eb4', 84, 12),
    ],
    chords: [],
    expect: { notes: 8, rests: 0, ties: 0, accidentals: 0, chords: 0, keyFlats: 3, swing: false },
  },
  {
    id: 'F8', title: 'Blues on C: flats as accidentals, no key signature', bars: 2,
    notes: [
      n('C4', 0, 6), n('Eb4', 6, 6), n('F4', 12, 6), n('Gb4', 18, 6), n('G4', 24, 12), n('Bb4', 36, 12),
      n('G4', 48, 6), n('Gb4', 54, 6), n('F4', 60, 6), n('Eb4', 66, 6), n('C4', 72, 24),
    ],
    chords: [],
    // bar 1: flat (Eb), flat (Gb), natural (G after Gb), flat (Bb); bar 2: flat (Gb), flat (Eb)
    expect: { notes: 11, rests: 0, ties: 0, accidentals: 6, flats: 5, naturals: 1, sharps: 0, chords: 0, keyFlats: 0, swing: false },
  },
  {
    id: 'F9', title: 'The same pitch spelled D-sharp and E-flat, as supplied', bars: 2,
    notes: [n('B3', 0, 12), n('D#4', 12, 12), n('F#4', 24, 24), n('C4', 48, 12), n('Eb4', 60, 12), n('G4', 72, 24)],
    chords: [],
    expect: { notes: 6, rests: 0, ties: 0, accidentals: 3, sharps: 2, flats: 1, naturals: 0, chords: 0, keyFlats: 0, swing: false },
  },
  {
    id: 'F10', title: 'Chord symbols, including a change during a held note', bars: 2,
    notes: [n('E4', 0, 36), n('G4', 36, 12), n('F4', 48, 12), n('A4', 60, 12), n('G4', 72, 24)],
    chords: [c('C', 0), c('Am7', 24), c('F/A', 48), c('G7#9', 72)],
    expect: { notes: 5, rests: 0, ties: 0, accidentals: 0, chords: 4, keyFlats: 0, swing: false },
  },
  {
    id: 'F11', title: 'Eight bars mixing all of the above, wrapped into systems', bars: 8,
    notes: F11_NOTES, chords: F11_CHORDS,
    // notes: 5 + 10 + 1 + 5 + 4 + 6 + 2 + 3; rests: 3 (bar 2) + 3 (bar 3);
    // accidentals: bar 4 flat (Gb), natural (G), flat (Bb)
    expect: { notes: 36, rests: 6, ties: 2, accidentals: 3, flats: 2, naturals: 1, sharps: 0, chords: 8, keyFlats: 0, swing: false },
  },
  {
    id: 'F12', title: 'F11 with the swing marking', bars: 8, swing: true,
    notes: F11_NOTES, chords: F11_CHORDS,
    expect: { notes: 36, rests: 6, ties: 2, accidentals: 3, flats: 2, naturals: 1, sharps: 0, chords: 8, keyFlats: 0, swing: true },
  },
]

export const fixtureById = id => FIXTURES.find(f => f.id === id) ?? FIXTURES[0]
