import { useState } from 'react'
import { Chord } from 'tonal'
import { CHORD_DATA } from '../chordData'
import { BASS_NOTE_PITCH_CLASSES, isSlashEligible } from '../utils/slashChord'
import { toUnicodeAccidentals } from '../utils/formatNotes'
import { extensionLabel } from '../utils/extensionLabels'
import Dropdown from './Dropdown'
import OverlayPage from './OverlayPage'
import './ChordSelector.css'

function toDataKey(root, quality, extension) {
  if (quality === 'major'     && extension === 'none')  return `${root} major`
  if (quality === 'minor'     && extension === 'none')  return `${root} minor`
  if (quality === 'diminished' && extension === 'none') return `${root} diminished`
  if (quality === 'augmented' && extension === 'none') return `${root} augmented`
  if (quality === 'major'     && extension === '7')     return `${root}7`
  if (quality === 'major'     && extension === 'maj7')  return `${root}maj7`
  if (quality === 'minor'     && extension === '7')     return `${root}m7`
  if (quality === 'diminished' && extension === '7')    return `${root}m7b5`
  if (quality === 'diminished' && extension === 'dim7') return `${root}dim7`
  if (quality === 'major'     && extension === 'add9')  return `${root}add9`
  if (quality === 'sus2'      && extension === 'none')  return `${root}sus2`
  if (quality === 'sus4'      && extension === 'none')  return `${root}sus4`
  if (quality === 'major'     && extension === '9')     return `${root}9`
  if (quality === 'major'     && extension === 'maj9')  return `${root}maj9`
  if (quality === 'minor'     && extension === '9')     return `${root}m9`
  if (quality === 'major'     && extension === '11')    return `${root}11`
  if (quality === 'minor'     && extension === '11')    return `${root}m11`
  if (quality === 'major'     && extension === '13')    return `${root}13`
  if (quality === 'major'     && extension === 'maj13') return `${root}maj13`
  if (quality === 'minor'     && extension === '13')    return `${root}m13`
  if (quality === 'major'     && extension === '7#9')   return `${root}7#9`
  if (quality === 'major'     && extension === '7b9')   return `${root}7b9`
  if (quality === 'major'     && extension === '7#5')   return `${root}7#5`
  if (quality === 'major'     && extension === '7b5')   return `${root}7b5`
  if (quality === 'major'     && extension === '7#11')  return `${root}7#11`
  return null
}

// Extended and altered chord types (9, 11, 13, and altered dominants) are a
// Pro feature -- gated the same way slash chords/inversions are (see
// effectiveBassNote in App.jsx): hasData is the single source of truth every
// disabled-state calculation in this file goes through, so a free user (or a
// downgraded session that still holds one of these in state) sees the same
// disabled/false result everywhere, not just at the Extension dropdown.
const PRO_ONLY_EXTENSIONS = new Set([
  '9', 'maj9', '11', '13', 'maj13', '7#9', '7b9', '7#5', '7b5', '7#11',
])

function hasData(root, quality, extension, isPro) {
  const key = toDataKey(root, quality, extension)
  if (key === null || !(key in CHORD_DATA)) return false
  if (PRO_ONLY_EXTENSIONS.has(extension) && !isPro) return false
  return true
}

// ROOTS are the internal values -- CHORD_DATA lookup keys, logic, etc. all
// key off these exact ASCII strings and stay unchanged. ROOT_DISPLAY is
// display-only, derived from ROOTS via the same toUnicodeAccidentals every
// other note/chord display in the app already goes through (this dropdown
// was the last spot still showing raw "#"/"b").
const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']
const ROOT_DISPLAY = ROOTS.map(toUnicodeAccidentals)

const QUALITIES = [
  { value: 'major', label: 'Major', tonal: 'M' },
  { value: 'minor', label: 'Minor', tonal: 'm' },
  { value: 'diminished', label: 'Diminished', tonal: 'dim' },
  { value: 'augmented', label: 'Augmented', tonal: 'aug' },
  { value: 'sus2', label: 'Sus2', tonal: 'sus2' },
  { value: 'sus4', label: 'Sus4', tonal: 'sus4' },
]

const EXTENSIONS = [
  { value: 'none', label: 'None', tonal: '' },
  { value: '7', label: '7', tonal: '7' },
  { value: 'maj7', label: 'maj7', tonal: 'maj7' },
  { value: 'add9', label: 'add9', tonal: 'add9' },
  { value: 'dim7', label: 'dim7', tonal: 'dim7' },
  { value: '9', label: '9', tonal: '9', proOnly: true },
  { value: 'maj9', label: 'maj9', tonal: 'maj9', proOnly: true },
  { value: '11', label: '11', tonal: '11', proOnly: true },
  { value: '13', label: '13', tonal: '13', proOnly: true },
  { value: 'maj13', label: 'maj13', tonal: 'maj13', proOnly: true },
  { value: '7#9', label: toUnicodeAccidentals('7#9'), tonal: '7#9', proOnly: true },
  { value: '7b9', label: toUnicodeAccidentals('7b9'), tonal: '7b9', proOnly: true },
  { value: '7#5', label: toUnicodeAccidentals('7#5'), tonal: '7#5', proOnly: true },
  { value: '7b5', label: toUnicodeAccidentals('7b5'), tonal: '7b5', proOnly: true },
  { value: '7#11', label: toUnicodeAccidentals('7#11'), tonal: '7#11', proOnly: true },
]

const BASS_NOTE_OPTIONS = [
  { value: 'none', label: 'None' },
  ...BASS_NOTE_PITCH_CLASSES.map(n => ({ value: n, label: toUnicodeAccidentals(n) })),
]

// Map our selection to a Tonal chord symbol
function buildChordSymbol(root, quality, extension) {
  const q = QUALITIES.find(q => q.value === quality)
  const e = EXTENSIONS.find(e => e.value === extension)
  if (!q || !e) return null

  if (quality === 'major') {
    if (extension === 'none') return root
    if (extension === '7') return root + '7'
    if (extension === 'maj7') return root + 'maj7'
    if (extension === 'add9') return root + 'add9'
    if (extension === '9') return root + '9'
    if (extension === 'maj9') return root + 'maj9'
    if (extension === '11') return root + '11'
    if (extension === '13') return root + '13'
    if (extension === 'maj13') return root + 'maj13'
    if (extension === '7#9') return root + '7#9'
    if (extension === '7b9') return root + '7b9'
    if (extension === '7#5') return root + '7#5'
    if (extension === '7b5') return root + '7b5'
    if (extension === '7#11') return root + '7#11'
  }
  if (quality === 'minor') {
    if (extension === 'none') return root + 'm'
    if (extension === '7') return root + 'm7'
    if (extension === 'maj7') return root + 'mM7'
    if (extension === 'add9') return root + 'madd9'
    if (extension === '9') return root + 'm9'
    if (extension === '11') return root + 'm11'
    if (extension === '13') return root + 'm13'
  }
  if (quality === 'diminished') {
    if (extension === 'none') return root + 'dim'
    if (extension === '7') return root + 'm7b5'
    if (extension === 'dim7') return root + 'dim7'
    return root + 'dim'
  }
  if (quality === 'augmented') {
    if (extension === 'none') return root + 'aug'
    if (extension === '7') return root + 'aug7'
    return root + 'aug'
  }
  if (quality === 'sus2') return root + 'sus2'
  if (quality === 'sus4') return root + 'sus4'
  return root
}

export default function ChordSelector({ root, quality, extension, bassNote, isPro, onChange }) {
  const symbol = buildChordSymbol(root, quality, extension)
  const chord = symbol ? Chord.get(symbol) : null
  const bassEligible = isSlashEligible(quality, extension)
  const hasAdvancedSelection = extension !== 'none' || bassNote !== 'none'
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function handleChange(field, value) {
    onChange({ root, quality, extension, bassNote, [field]: value })
  }

  function renderAdvancedFields(idSuffix) {
    return (
      <div className="chord-selector__advanced-fields">
        <div className="chord-selector__field">
          <Dropdown
            label="Extension"
            description="Adds colour with extra notes"
            value={extension}
            onChange={v => handleChange('extension', v)}
            options={EXTENSIONS.map(e => ({
              value: e.value,
              label: extensionLabel(e.value, e.label, quality),
              disabled: !hasData(root, quality, e.value, isPro),
              badge: e.proOnly && !isPro ? 'PRO' : undefined,
            }))}
          />
        </div>

        <div className="chord-selector__field" id={`wt-bass-note-${idSuffix}`}>
          <div className="chord-selector__bass-row">
            <Dropdown
              label="Bass note"
              description={bassEligible ? 'Places a different note underneath' : 'Not available for this chord type'}
              badge={!bassEligible ? 'N/A' : !isPro ? 'PRO' : undefined}
              value={bassNote}
              onChange={v => handleChange('bassNote', v)}
              disabled={!isPro || !bassEligible}
              options={BASS_NOTE_OPTIONS}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chord-selector">
      <h2 className="chord-selector__title">Build a Chord</h2>
      <div className="chord-selector__dropdowns">
        <div className="chord-selector__field" id="wt-root">
          <Dropdown
            label="Root"
            description="The note the chord is named after"
            value={root}
            onChange={v => handleChange('root', v)}
            options={ROOTS.map((r, i) => ({
              value: r,
              label: ROOT_DISPLAY[i],
              disabled: !hasData(r, quality, extension, isPro),
            }))}
          />
        </div>

        <div className="chord-selector__field" id="wt-quality">
          <Dropdown
            label="Quality"
            description="Changes the chord's basic mood"
            value={quality}
            onChange={v => handleChange('quality', v)}
            options={QUALITIES.map(q => ({
              value: q.value,
              label: q.label,
              disabled: !hasData(root, q.value, extension, isPro),
            }))}
          />
        </div>

        <div className="chord-selector__advanced">
          <button
            type="button"
            className="chord-selector__advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(open => !open)}
          >
            <span>
              More options
              {hasAdvancedSelection && <span className="chord-selector__active-dot" aria-label="Advanced option active" />}
            </span>
            <span className="chord-selector__chevron" aria-hidden="true">→</span>
          </button>

          <div className="chord-selector__advanced-inline" aria-label="Extensions and bass">
            {renderAdvancedFields('inline')}
          </div>

          <OverlayPage
            isOpen={advancedOpen}
            onClose={() => setAdvancedOpen(false)}
            eyebrow="Chord builder"
            title="Extensions & bass"
          >
            {renderAdvancedFields('overlay')}
          </OverlayPage>
        </div>
      </div>
    </div>
  )
}

export { buildChordSymbol, ROOTS, ROOT_DISPLAY, QUALITIES, EXTENSIONS, BASS_NOTE_OPTIONS }
