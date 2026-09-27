// Reverse voicing lookup: given a set of target pitch classes, search
// standard tuning for playable 6-string fret combinations whose sounding
// pitch classes are a superset of the target -- the inverse of every other
// guitar-shape file in this app, which start from a known chord and
// produce one shape.
//
// Phase 1 ranked results by ease/playability alone (fewer muted strings,
// smaller fret span, lower average fret). Phase 2 adds an optional
// referenceShape (the last chord already in the progression, resolved by
// App.jsx): when given, it REPLACES ease as the sort key entirely rather
// than blending with it -- once there's a progression to voice-lead
// toward, "closest to what you just played" is the whole point, not one
// input among several. Ease-only ranking is unchanged and still exactly
// what runs when there's no reference shape (an empty progression).
import { Note, Interval, Chord } from 'tonal'

// Standard tuning, low string to high: E A D G B e -- same open-string
// pitch classes and (open + fret) % 12 formula GuitarDisplay.jsx already
// uses to place its dots, not a new music-theory approach.
const OPEN_PITCH_CLASS = [4, 9, 2, 7, 11, 4]
// Same strings, but as real note names + octave -- standard guitar tuning's
// actual sounding pitches, needed to add a found shape to the progression
// (which plays/displays real notes, not bare pitch classes).
const OPEN_STRING_NOTE = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
const STRING_COUNT = 6
const MAX_FRET = 15

export const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Every fret in [0, MAX_FRET] on `stringIndex` that sounds `pitchClass`.
// The range spans more than an octave, so this is 1 or 2 frets per string.
function fretsForPitchClass(stringIndex, pitchClass) {
  const open = OPEN_PITCH_CLASS[stringIndex]
  const frets = []
  for (let fret = 0; fret <= MAX_FRET; fret++) {
    if ((open + fret) % 12 === pitchClass) frets.push(fret)
  }
  return frets
}

function scoreShape(frets) {
  const played = frets.filter(f => f !== 'x').map(Number)
  const muted = STRING_COUNT - played.length
  const nonOpen = played.filter(f => f > 0)
  const span = nonOpen.length ? Math.max(...nonOpen) - Math.min(...nonOpen) : 0
  const avgFret = played.length ? played.reduce((a, b) => a + b, 0) / played.length : 0
  return { muted, span, avgFret }
}

function compareShapes(a, b) {
  return a.muted - b.muted || a.span - b.span || a.avgFret - b.avgFret
}

// A string flipping between muted and fretted is a bigger hand-position
// change than sliding an already-fretted finger a couple of frets, so it's
// weighted well above a typical single-string fret difference (usually
// 0-4 within one coherent shape) rather than being just "worth one fret."
const MUTE_CHANGE_PENALTY = 4

// Physical closeness between two shapes on the neck: sum of absolute fret
// differences on strings fretted in BOTH shapes, plus a penalty per string
// whose muted/fretted status differs between them. A string muted in both
// contributes nothing either way -- it's not part of either hand shape.
function shapeDistance(a, b) {
  let total = 0
  for (let i = 0; i < STRING_COUNT; i++) {
    const aMuted = a[i] === 'x'
    const bMuted = b[i] === 'x'
    if (aMuted && bMuted) continue
    if (aMuted !== bMuted) {
      total += MUTE_CHANGE_PENALTY
      continue
    }
    total += Math.abs(Number(a[i]) - Number(b[i]))
  }
  return total
}

// The pitch classes a fret array actually sounds (muted strings excluded).
export function soundingPitchClasses(frets) {
  const set = new Set()
  frets.forEach((f, i) => {
    if (f !== 'x') set.add((OPEN_PITCH_CLASS[i] + Number(f)) % 12)
  })
  return [...set].sort((a, b) => a - b)
}

// Ranked candidate shapes whose sounding pitch classes are a superset of
// `targetPitchClasses` (0-11 integers, duplicates/order ignored). Each
// string is either muted or plays one of the target classes -- doubling a
// target class is fine (and common: e.g. an open chord's repeated root),
// but a string is never used to sneak in some unrelated pitch class just
// because "extra" notes are technically allowed; that would make results
// like a plain triad search come back full of unrelated open strings.
// Returns [] if there are no target notes, or more distinct target classes
// than there are strings to sound them on (max 6).
//
// `referenceShape`, when given (a plain frets array, e.g. { frets }.frets
// from a GUITAR_SHAPES entry), ranks every candidate by shapeDistance to
// it instead of ease -- see the file header for why this replaces rather
// than blends with the ease criteria. Omitted/null reproduces Phase 1's
// ease-only ranking exactly.
export function findVoicings(targetPitchClasses, { maxResults = 3, referenceShape = null } = {}) {
  const target = [...new Set(targetPitchClasses)].filter(pc => Number.isInteger(pc) && pc >= 0 && pc <= 11)
  if (target.length === 0 || target.length > STRING_COUNT) return []

  // Per string, every (pitch class, fret) pair achievable for a target class.
  const options = []
  for (let s = 0; s < STRING_COUNT; s++) {
    const opts = []
    for (const pc of target) {
      for (const fret of fretsForPitchClass(s, pc)) opts.push({ pc, fret })
    }
    options.push(opts)
  }

  const results = []
  const frets = new Array(STRING_COUNT).fill('x')
  const coveredCount = new Array(12).fill(0)
  let distinctCovered = 0

  function backtrack(stringIdx) {
    if (stringIdx === STRING_COUNT) {
      if (distinctCovered === target.length) results.push(frets.slice())
      return
    }
    // Feasibility prune: even if every remaining string (including this
    // one) covers a still-missing class, can we still reach full coverage?
    const remaining = STRING_COUNT - stringIdx
    if (target.length - distinctCovered > remaining) return

    frets[stringIdx] = 'x'
    backtrack(stringIdx + 1)

    for (const { pc, fret } of options[stringIdx]) {
      frets[stringIdx] = fret
      const wasNew = coveredCount[pc] === 0
      coveredCount[pc]++
      if (wasNew) distinctCovered++
      backtrack(stringIdx + 1)
      coveredCount[pc]--
      if (wasNew) distinctCovered--
    }
  }
  backtrack(0)

  const scored = results.map(f => ({ frets: f, ...scoreShape(f) }))

  if (referenceShape) {
    return scored
      .map(r => ({ ...r, distance: shapeDistance(r.frets, referenceShape) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxResults)
  }

  return scored.sort(compareShapes).slice(0, maxResults)
}

// The real note+octave a fret array sounds, low string to high, for adding
// a found shape to the progression -- muted strings simply don't contribute
// a note, same convention as everywhere else notes are collected.
export function soundingNotes(frets) {
  return frets
    .map((f, i) => (f === 'x' ? null : Note.transpose(OPEN_STRING_NOTE[i], Interval.fromSemitones(Number(f)))))
    .filter(Boolean)
}

// A shape's actual sounding note names, bass to treble, deduped by first
// occurrence -- the real, specific pitch-class set THIS fingering sounds
// (which can differ shape-to-shape even for the same picked notes, per
// Phase 1's "superset of picked notes" matching rule: a doubled or extra
// tone on one shape and not another). Used for the plain fallback label
// and for the alternates list; NOT for detectChordName's input order --
// see that function's own comment for why.
function soundingNoteNames(frets) {
  const seen = new Set()
  const names = []
  frets.forEach((f, i) => {
    if (f === 'x') return
    const pc = (OPEN_PITCH_CLASS[i] + Number(f)) % 12
    if (seen.has(pc)) return
    seen.add(pc)
    names.push(PITCH_CLASS_NAMES[pc])
  })
  return names
}

// A plain, honest fallback label for a found shape -- just the pitch
// classes it actually sounds. Used on its own when chord detection has no
// confident match, so there's always something sensible to show/add.
export function voicingLabel(frets) {
  return soundingNoteNames(frets).join(' · ')
}

// Tonal has no chord type for a triad or seventh with one added tension it
// does not list itself -- B-D#-F#-E# (B major plus a #11/#4) comes back from
// Chord.detect as nothing at all, so a perfectly nameable chord used to show
// up as a bare note list. When detect finds nothing, this looks for a known
// base chord on some root plus exactly ONE added tone, and names it the way
// a musician would: "add" for a triad (Badd#11), the tension written straight
// after a seventh or sixth (B7#11 style). Anything that needs two or more
// added tones stays unnamed -- at that point any name is a guess.
const BASE_CHORDS = [
  { suffix: '', intervals: ['1P', '3M', '5P'], triad: true },
  { suffix: 'm', intervals: ['1P', '3m', '5P'], triad: true },
  { suffix: 'sus4', intervals: ['1P', '4P', '5P'], triad: true },
  { suffix: 'sus2', intervals: ['1P', '2M', '5P'], triad: true },
  { suffix: 'dim', intervals: ['1P', '3m', '5d'], triad: true },
  { suffix: 'aug', intervals: ['1P', '3M', '5A'], triad: true },
  { suffix: '7', intervals: ['1P', '3M', '5P', '7m'] },
  { suffix: 'maj7', intervals: ['1P', '3M', '5P', '7M'] },
  { suffix: 'm7', intervals: ['1P', '3m', '5P', '7m'] },
  { suffix: 'm7b5', intervals: ['1P', '3m', '5d', '7m'] },
  { suffix: '6', intervals: ['1P', '3M', '5P', '6M'] },
  { suffix: 'm6', intervals: ['1P', '3m', '5P', '6M'] },
]

// Semitones above the root -> the added tension's name and its interval, so
// the added note is spelled as what it IS: the #11 of B is E#, not F. 4, 7,
// 10 and 11 are chord tones of some base above, never "added" ones.
const ADDED_TONES = {
  1: { label: 'b9', interval: '9m' },
  2: { label: '9', interval: '9M' },
  3: { label: '#9', interval: '9A' },
  5: { label: '11', interval: '11P' },
  6: { label: '#11', interval: '11A' },
  8: { label: 'b13', interval: '13m' },
  9: { label: '13', interval: '13M' },
}

// Which pitch class to call the root, and so which name wins, when a set
// reads more than one way: the bass note first (what a player hears as home),
// then the plainer base chord (earlier in BASE_CHORDS).
export function detectAddedToneChord(pitchClasses, bassPc = null) {
  const set = new Set(pitchClasses)
  let best = null
  for (const root of set) {
    BASE_CHORDS.forEach((base, baseIndex) => {
      const basePcs = base.intervals.map(i => (root + Interval.semitones(i)) % 12)
      if (!basePcs.every(pc => set.has(pc))) return
      const extras = [...set].filter(pc => !basePcs.includes(pc))
      if (extras.length !== 1) return
      const tone = ADDED_TONES[(extras[0] - root + 12) % 12]
      if (!tone) return
      const rank = (root === bassPc ? 0 : 100) + baseIndex
      if (best && best.rank <= rank) return
      const suffix = base.triad ? `${base.suffix}add${tone.label}` : `${base.suffix}${tone.label}`
      best = { rank, rootPc: root, suffix, intervals: [...base.intervals, tone.interval] }
    })
  }
  if (!best) return null
  const { root, notes } = simplestSpelling(best.rootPc, best.intervals)
  return { name: `${root}${best.suffix}`, root, spelledNotes: notes }
}

function accidentalCount(notes) {
  return notes.reduce((sum, n) => sum + (n.match(/[#b]/g) || []).length, 0)
}

// Spell a chord from whichever name of its root gives the plainer note set:
// Bb-D-F rather than A#-C##-E#. On a tie the sharp name (PITCH_CLASS_NAMES)
// is kept, which is how the root was picked in the first place.
function simplestSpelling(rootPc, intervals) {
  const sharpName = PITCH_CLASS_NAMES[rootPc]
  const candidates = [sharpName, Note.enharmonic(sharpName)].filter((n, i, all) => n && all.indexOf(n) === i)
  let best = null
  for (const root of candidates) {
    const notes = intervals.map(i => Note.pitchClass(Note.transpose(root, i)))
    const score = accidentalCount(notes)
    if (!best || score < best.score) best = { root, notes, score }
  }
  return { root: best.root, notes: best.notes }
}

// A tonal chord name, respelled from its plainer root (see simplestSpelling),
// with its notes spelled to match. A slash bass takes the spelling that note
// has inside the chord. Names tonal cannot parse come back unchanged.
export function spellChordName(name) {
  const [head, bass] = name.split('/')
  const chord = Chord.get(head)
  if (chord.empty || !chord.tonic) return { name, spelledNotes: null }
  const { root, notes } = simplestSpelling(Note.chroma(chord.tonic), chord.intervals)
  let spelledBass = bass
  if (bass) spelledBass = notes.find(n => Note.chroma(n) === Note.chroma(bass)) ?? bass
  return {
    name: `${root}${head.slice(chord.tonic.length)}${spelledBass ? `/${spelledBass}` : ''}`,
    root,
    spelledNotes: notes,
  }
}

// Respell sounding notes (with octaves) to a chord's own spelling, keeping
// each one's exact pitch: F4 as the #11 of B becomes E#4, and B#3 (not B#4)
// is the spelling of C4. Notes the spelling does not cover pass through.
export function respellNotes(notes, spelledNotes) {
  if (!spelledNotes) return notes
  return notes.map(note => {
    const midi = Note.midi(note)
    const pc = spelledNotes.find(n => Note.chroma(n) === Note.chroma(note))
    if (midi == null || !pc) return note
    const octave = Note.get(note).oct
    for (const o of [octave, octave - 1, octave + 1]) {
      if (Note.midi(`${pc}${o}`) === midi) return `${pc}${o}`
    }
    return note
  })
}

function detectFromPitchClasses(pitchClasses, bassPc, fallbackLabel) {
  const names = pitchClasses.map(pc => PITCH_CLASS_NAMES[pc])
  const matches = Chord.detect(names)
  if (matches.length > 0) {
    const primary = spellChordName(matches[0])
    return {
      name: primary.name,
      root: primary.root || null,
      spelledNotes: primary.spelledNotes,
      isDetected: true,
      alternates: matches.slice(1).map(m => spellChordName(m).name),
    }
  }
  const added = detectAddedToneChord(pitchClasses, bassPc)
  if (added) return { ...added, isDetected: true, alternates: [] }
  return { name: fallbackLabel, root: null, spelledNotes: null, isDetected: false, alternates: [] }
}


// Best-effort chord name for one specific shape's actual sounding notes --
// call this per result, not once for the whole picked set, since two
// ranked shapes can genuinely sound a different pitch-class SET from each
// other (see soundingNoteNames above) and deserve different names for
// that reason.
//
// Notes go into Chord.detect in plain pitch-class-ascending order (C first
// upward), not this shape's actual bass-to-treble string order: tonal's
// detector treats whichever note is listed FIRST as the preferred root to
// try, even when that "chord" is an obscure type -- e.g. a plain C major
// triad voiced with E as the lowest string detects as "Em#5" if E leads
// the input, versus the far more useful "CM" if C leads it. A fixed
// pitch-class order keeps the name about what the shape's pitch content
// actually IS (a chord's identity), not which string happens to ring
// lowest for this particular fingering -- that's a voicing/inversion
// detail the guitar diagram itself already shows.
//
// Falls back to the plain note list (voicingLabel) when neither Chord.detect
// nor detectAddedToneChord finds a name -- a genuinely ambiguous cluster
// (e.g. a bare 2nd, or three adjacent semitones) has no chord name worth
// fabricating. `root` is returned alongside the name because an added-tone
// name ("Badd#11") is not one Chord.get can parse a tonic back out of.
export function detectChordName(frets) {
  const lowest = frets.findIndex(f => f !== 'x')
  const bassPc = lowest === -1 ? null : (OPEN_PITCH_CLASS[lowest] + Number(frets[lowest])) % 12
  return detectFromPitchClasses(soundingPitchClasses(frets), bassPc, soundingNoteNames(frets).join(' · '))
}

// Same best-effort naming as detectChordName above, but for an arbitrary
// raw pitch-class set (0-11 integers) instead of a guitar fret array --
// MIDI import's "chord moments" are just the notes sounding at some point
// in a file, not a fingering, so there's no frets array (and no bass string)
// to derive them from. Falls back to the plain sorted pitch-class list.
export function detectChordNameFromPitchClasses(pitchClasses) {
  const sorted = [...new Set(pitchClasses)].sort((a, b) => a - b)
  return detectFromPitchClasses(sorted, null, sorted.map(pc => PITCH_CLASS_NAMES[pc]).join(' · '))
}
