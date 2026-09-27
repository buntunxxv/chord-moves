// Pure chord-name <-> selector-state <-> guitar-shape lookup helpers, split
// out of App.jsx so they can be reused (App.jsx's live builder selection,
// the reverse-lookup's reference shape, and progression-playback's
// currently-sounding chord all need the exact same pipeline) and unit
// tested directly (App.jsx itself can't be imported outside a JSX-aware
// bundler, since it renders markup) -- see scripts/verify-preview-and-
// playback.mjs.
//
// Explicit .js extensions (unlike this codebase's usual extensionless local
// imports, e.g. slashChord.js's own imports): this module is also imported
// directly by that Node-run verification script, and plain Node's ESM
// resolver -- unlike Vite's -- requires them (same reasoning as
// voiceLeading.js).
import { GUITAR_SHAPES } from '../guitarData.js'
import { GUITAR_INVERSION_SHAPES } from '../guitarInversions.js'
import { GUITAR_ALT_POSITIONS } from '../guitarPositions.js'
import { GUITAR_INVERSION_ALT_POSITIONS } from '../guitarInversionPositions.js'
import { Note } from 'tonal'
import { isInChordTone } from './slashChord.js'

// Map selector state to CHORD_DATA key
export function toDataKey(root, quality, extension) {
  if (quality === 'major' && extension === 'none') return `${root} major`
  if (quality === 'minor' && extension === 'none') return `${root} minor`
  if (quality === 'diminished' && extension === 'none') return `${root} diminished`
  if (quality === 'augmented' && extension === 'none') return `${root} augmented`
  if (quality === 'major' && extension === '7') return `${root}7`
  if (quality === 'major' && extension === 'maj7') return `${root}maj7`
  if (quality === 'minor' && extension === '7') return `${root}m7`
  if (quality === 'diminished' && extension === '7') return `${root}m7b5`
  if (quality === 'diminished' && extension === 'dim7') return `${root}dim7`
  if (quality === 'major' && extension === 'add9') return `${root}add9`
  if (quality === 'sus2' && extension === 'none') return `${root}sus2`
  if (quality === 'sus4' && extension === 'none') return `${root}sus4`
  if (quality === 'major' && extension === '9') return `${root}9`
  if (quality === 'major' && extension === 'maj9') return `${root}maj9`
  if (quality === 'minor' && extension === '9') return `${root}m9`
  if (quality === 'major' && extension === '11') return `${root}11`
  if (quality === 'minor' && extension === '11') return `${root}m11`
  if (quality === 'major' && extension === '13') return `${root}13`
  if (quality === 'major' && extension === 'maj13') return `${root}maj13`
  if (quality === 'minor' && extension === '13') return `${root}m13`
  if (quality === 'major' && extension === '7#9') return `${root}7#9`
  if (quality === 'major' && extension === '7b9') return `${root}7b9`
  if (quality === 'major' && extension === '7#5') return `${root}7#5`
  if (quality === 'major' && extension === '7b5') return `${root}7b5`
  if (quality === 'major' && extension === '7#11') return `${root}7#11`
  return null
}

// Exact inverse of buildChordSymbol (ChordSelector.jsx): every suffix that
// function can ever append to a root, mapped back to the quality/extension
// that produced it. A Pro user can add any of these -- not just the 8 basic
// types -- to the progression from Build, so chordNameToSelection has to
// recognize every one of them too, or tapping that chip later leaves the
// arrangement's own selection highlighted (plain index state) while the
// builder/instrument silently keeps showing whatever chord was selected
// before, since the failed parse means setSelection never runs.
const SUFFIX_TO_SELECTION = {
  '': { quality: 'major', extension: 'none' },
  '7': { quality: 'major', extension: '7' },
  'maj7': { quality: 'major', extension: 'maj7' },
  'add9': { quality: 'major', extension: 'add9' },
  '9': { quality: 'major', extension: '9' },
  'maj9': { quality: 'major', extension: 'maj9' },
  '11': { quality: 'major', extension: '11' },
  '13': { quality: 'major', extension: '13' },
  'maj13': { quality: 'major', extension: 'maj13' },
  '7#9': { quality: 'major', extension: '7#9' },
  '7b9': { quality: 'major', extension: '7b9' },
  '7#5': { quality: 'major', extension: '7#5' },
  '7b5': { quality: 'major', extension: '7b5' },
  '7#11': { quality: 'major', extension: '7#11' },
  'm': { quality: 'minor', extension: 'none' },
  'm7': { quality: 'minor', extension: '7' },
  'mM7': { quality: 'minor', extension: 'maj7' },
  'madd9': { quality: 'minor', extension: 'add9' },
  'm9': { quality: 'minor', extension: '9' },
  'm11': { quality: 'minor', extension: '11' },
  'm13': { quality: 'minor', extension: '13' },
  'dim': { quality: 'diminished', extension: 'none' },
  'm7b5': { quality: 'diminished', extension: '7' },
  'dim7': { quality: 'diminished', extension: 'dim7' },
  'aug': { quality: 'augmented', extension: 'none' },
  'aug7': { quality: 'augmented', extension: '7' },
  'sus2': { quality: 'sus2', extension: 'none' },
  'sus4': { quality: 'sus4', extension: 'none' },
}

// Parse a chord DISPLAY NAME (e.g. a progression chip's or a suggestion's
// "chord" field -- "C", "Dm7", "Cmaj7", "Db7#5", "Gbm13"...) back into
// selector state. Returns null for anything the builder itself could never
// have produced (including slash chords -- a bare display string can't
// recover a slash bass -- and any name Chord.detect might invent that
// doesn't match this app's own suffix conventions).
export function chordNameToSelection(name) {
  if (!name) return null
  const m = name.match(/^([A-G][#b]?)(.*)$/)
  if (!m) return null
  const [, root, suffix] = m
  const qual = SUFFIX_TO_SELECTION[suffix]
  if (!qual) return null
  return { root, ...qual }
}

// The closest chord the builder CAN show, for a name it cannot: Badd#11 ->
// B major, Gm7/D -> Gm7, Cmaj7b9 -> Cmaj7. The slash bass is dropped and the
// suffix cut back to the longest prefix the builder knows; roots the builder
// has no entry for (E#, B#, Cb, Fb, double accidentals) move to their plain
// enharmonic name. Returns null only when not even the root parses.
export function nearestSelectionForName(name) {
  // A bare note list ("F# · B · F") is not a chord name at all.
  if (!name || name.includes('·')) return null
  const m = name.split('/')[0].match(/^([A-G](?:##|bb|#|b)?)(.*)$/)
  if (!m) return null
  let [, root, suffix] = m
  if (/^(E#|B#|Cb|Fb)$/.test(root) || root.length > 2) root = Note.enharmonic(root)
  for (let end = suffix.length; end >= 0; end--) {
    const qual = SUFFIX_TO_SELECTION[suffix.slice(0, end)]
    if (qual) return { root, ...qual }
  }
  return null
}

// Guitar-shape/position resolution for a chord identified by its own
// dataKey + (optional) slash bass. Root-position lookup (hasSlashBass:
// false) is what both the reverse-lookup's reference shape and
// progression-playback's currently-sounding chord use, since neither has a
// slash bass to recover from a bare display name.
export function resolveGuitarPositions(dataKey, hasSlashBass, effectiveBassNote, chordNotes) {
  if (!dataKey) return null
  if (hasSlashBass) {
    const isInversion = isInChordTone(chordNotes, effectiveBassNote)
    const inversionShape = isInversion ? GUITAR_INVERSION_SHAPES[dataKey]?.[effectiveBassNote] : null
    if (!isInversion || !inversionShape) return null
    const alt = GUITAR_INVERSION_ALT_POSITIONS[dataKey]?.[effectiveBassNote] || []
    return [inversionShape, ...alt.filter(Boolean)]
  }
  if (!GUITAR_SHAPES[dataKey]) return null
  const alt = GUITAR_ALT_POSITIONS[dataKey] || []
  return [GUITAR_SHAPES[dataKey], ...alt.filter(Boolean)]
}

// Full pipeline: chord display name -> its own root-position guitar shape
// (always position 1 -- there's no "selected position" for an arbitrary
// chord referenced only by name) + root pitch letter, or null if the name
// doesn't parse or has no curated shape.
export function guitarShapeForChordName(name) {
  const selection = chordNameToSelection(name)
  if (!selection) return null
  const dataKey = toDataKey(selection.root, selection.quality, selection.extension)
  const positions = resolveGuitarPositions(dataKey, false, 'none', null)
  if (!positions) return null
  return { shape: positions[0], root: selection.root }
}
