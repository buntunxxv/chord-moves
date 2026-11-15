// Rhythm Dice faces. Each die is one beat; each face is an ordered list of
// events on a 12-ticks-per-crotchet grid:
//
//   semiquaver 3 · quaver 6 · crotchet 12 · triplet quaver 4 ·
//   sextuplet semiquaver 2 · dotted quaver 9 · dotted crotchet 18
//
// A face's events must add up to exactly one beat: 12 ticks for a simple
// beat (crotchet), 18 for a compound beat (dotted crotchet). validateLevels()
// checks that on load, so a typo in a face fails loudly instead of rolling a
// bar of the wrong length.
//
// Every die has exactly six slots. Rolls are uniform over slots, so a face
// printed on two slots is twice as likely -- that is deliberate and mirrors
// the physical dice. Face lists were signed off by the founder in Phase 0
// (15 Nov 2026) as drafts, to be swapped for the physical dice's faces.

export const TICKS_PER_CROTCHET = 12
export const SIMPLE_BEAT = 12
export const COMPOUND_BEAT = 18
export const SLOTS_PER_DIE = 6

const n = ticks => ({ type: 'note', ticks })
const r = ticks => ({ type: 'rest', ticks })
const tie = ticks => ({ type: 'note', ticks, tieOut: true })

function level(id, { beat, tier, label, faces }) {
  return {
    id,
    beat,
    tier,
    label,
    faces: faces.map(([name, events], i) => ({ id: `${id}-${i + 1}`, name, events })),
  }
}

export const LEVELS = [
  level('L1', {
    beat: SIMPLE_BEAT, tier: 'free', label: 'Crotchets, quavers, rests',
    faces: [
      ['Crotchet', [n(12)]],
      ['2 quavers', [n(6), n(6)]],
      ['Crotchet rest', [r(12)]],
      ['Quaver rest + quaver', [r(6), n(6)]],
      ['Quaver + quaver rest', [n(6), r(6)]],
      ['2 quavers', [n(6), n(6)]],
    ],
  }),
  level('L2', {
    beat: SIMPLE_BEAT, tier: 'free', label: 'Semiquavers',
    faces: [
      ['4 semiquavers', [n(3), n(3), n(3), n(3)]],
      ['Quaver + 2 semiquavers', [n(6), n(3), n(3)]],
      ['2 semiquavers + quaver', [n(3), n(3), n(6)]],
      ['Semiquaver rest + 3 semiquavers', [r(3), n(3), n(3), n(3)]],
      ['Crotchet', [n(12)]],
      ['2 quavers', [n(6), n(6)]],
    ],
  }),
  level('L3', {
    beat: SIMPLE_BEAT, tier: 'free', label: 'Syncopation and ties',
    faces: [
      ['Dotted quaver + semiquaver', [n(9), n(3)]],
      ['Semiquaver + dotted quaver', [n(3), n(9)]],
      ['Semiquaver–quaver–semiquaver', [n(3), n(6), n(3)]],
      ['Rest–semi–rest–semi', [r(3), n(3), r(3), n(3)]],
      ['Crotchet, tied out', [tie(12)]],
      ['4 semiquavers', [n(3), n(3), n(3), n(3)]],
    ],
  }),
  level('L4', {
    beat: SIMPLE_BEAT, tier: 'pro', label: 'Triplets',
    faces: [
      ['Quaver triplet', [n(4), n(4), n(4)]],
      ['Crotchet–quaver triplet', [n(8), n(4)]],
      ['Quaver–crotchet triplet', [n(4), n(8)]],
      ['Rest + 2 triplet quavers', [r(4), n(4), n(4)]],
      ['Sextuplet', [n(2), n(2), n(2), n(2), n(2), n(2)]],
      ['2 quavers', [n(6), n(6)]],
    ],
  }),
  level('L5', {
    beat: COMPOUND_BEAT, tier: 'pro', label: 'Compound: one dotted-crotchet beat',
    faces: [
      ['Dotted crotchet', [n(18)]],
      ['3 quavers', [n(6), n(6), n(6)]],
      ['Crotchet + quaver', [n(12), n(6)]],
      ['Quaver + crotchet', [n(6), n(12)]],
      ['Dotted quaver–semi–quaver', [n(9), n(3), n(6)]],
      ['6 semiquavers', [n(3), n(3), n(3), n(3), n(3), n(3)]],
    ],
  }),
]

export function faceTicks(face) {
  return face.events.reduce((sum, e) => sum + e.ticks, 0)
}

// Throws on the first face that breaks the model. Returns the levels so it
// can wrap the export at load.
export function validateLevels(levels) {
  for (const lvl of levels) {
    if (lvl.beat !== SIMPLE_BEAT && lvl.beat !== COMPOUND_BEAT) {
      throw new Error(`${lvl.id}: beat must be ${SIMPLE_BEAT} or ${COMPOUND_BEAT} ticks`)
    }
    if (lvl.faces.length !== SLOTS_PER_DIE) {
      throw new Error(`${lvl.id}: a die has exactly ${SLOTS_PER_DIE} faces, found ${lvl.faces.length}`)
    }
    for (const face of lvl.faces) {
      if (!face.events.length) throw new Error(`${face.id}: no events`)
      for (const e of face.events) {
        if (e.type !== 'note' && e.type !== 'rest') throw new Error(`${face.id}: unknown event type ${e.type}`)
        if (!Number.isInteger(e.ticks) || e.ticks <= 0) throw new Error(`${face.id}: ticks must be a positive integer`)
        if (e.tieOut && e.type !== 'note') throw new Error(`${face.id}: only a note can tie out`)
      }
      if (face.events.slice(0, -1).some(e => e.tieOut)) throw new Error(`${face.id}: only the last event can tie out`)
      const total = faceTicks(face)
      if (total !== lvl.beat) throw new Error(`${face.id} adds up to ${total} ticks, expected ${lvl.beat}`)
    }
  }
  return levels
}

validateLevels(LEVELS)

export function levelById(id) {
  return LEVELS.find(l => l.id === id) ?? null
}

// What PR 1 offers. L3+ and the Pro levels arrive in later PRs.
export const AVAILABLE_LEVEL_IDS = ['L1', 'L2']
