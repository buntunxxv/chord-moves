import { useState, useRef, useEffect } from 'react'
import { formatNoteNames, toUnicodeAccidentals } from '../utils/formatNotes'
import { buildChordMidiBytes, downloadMidiFile, sanitizeFilename } from '../utils/midiExport'
import OverlayPage from './OverlayPage'
import './ChordOutputPanel.css'

// Every interval Session 30's extended/altered chord types can actually
// produce (verified against Tonal's own Chord.get(...).intervals for each
// symbol buildChordSymbol emits -- 9/maj9/11/13/maj13, 7#9/7b9/7#5/7b5/7#11,
// m9/m11/m13 -- not guessed), on top of the base triad/7th/sus set.
const INTERVAL_NAMES = {
  '1P': 'Root',
  '3M': '3',
  '3m': '♭3',
  '5P': '5',
  '5d': '♭5',
  '5A': '♯5',
  '7m': '♭7',
  '7d': '♭♭7',
  '7M': '7',
  '9M': '9',
  '9m': '♭9',
  '9A': '♯9',
  '4P': '4',
  '2M': '2',
  '11P': '11',
  '11A': '♯11',
  '13M': '13',
}

function formatInterval(interval) {
  return INTERVAL_NAMES[interval] || interval
}

// A single chord preview doesn't need a tempo — just hold it long enough to hear
const HOLD_SECONDS = 1.5
const CONFIRMATION_MS = 1500

export default function ChordOutputPanel({ chordName, notes, intervals, available, onAddToProgression, onOpenSuggestions, hasSuggestions, isPro, onPlayChord, isPlayingChord, canPlayChord }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  // 'idle' | 'exporting' | 'success' | 'error' -- gives the button itself a
  // brief, visible state for each phase, instead of the previous
  // build-and-download happening with no feedback at all if it fails.
  const [exportStatus, setExportStatus] = useState('idle')
  const [exportError, setExportError] = useState('')
  const exportResetRef = useRef(null)

  useEffect(() => () => {
    if (exportResetRef.current) clearTimeout(exportResetRef.current)
  }, [])

  // Exports the currently displayed voicing (already Close/Drop-2/Split and
  // slash/inversion-aware -- `notes` is the exact array Play itself sounds,
  // App.jsx resolves it once for both) as one simultaneous note-on group in
  // a real playable .mid file, held for the same duration the live preview
  // plays.
  function handleExportMidi() {
    if (!isPro || !notes || notes.length === 0) return
    if (exportResetRef.current) clearTimeout(exportResetRef.current)
    setExportStatus('exporting')
    setExportError('')
    // Deferred a tick so the "Exporting…" state actually gets painted --
    // building the bytes and clicking the download anchor are otherwise
    // synchronous and would otherwise land in the same batched render as
    // the success/error state that follows it.
    setTimeout(() => {
      try {
        const bytes = buildChordMidiBytes(notes, HOLD_SECONDS)
        downloadMidiFile(bytes, `${sanitizeFilename(chordName)}.mid`)
        setExportStatus('success')
      } catch (err) {
        setExportStatus('error')
        setExportError(err instanceof Error ? err.message : 'Export failed')
      }
      exportResetRef.current = setTimeout(() => setExportStatus('idle'), CONFIRMATION_MS)
    }, 0)
  }

  if (!available) {
    return (
      <div className="chord-output">
        <h2 className="chord-output__title">Explore chord</h2>
        <div className="chord-output--unavailable">
          <p className="chord-output__unavailable-msg">Chord not available in Stage 1</p>
        </div>
      </div>
    )
  }

  const noteNames = formatNoteNames(notes)
  // chordName itself stays raw ASCII ("Db") -- it's the exact string
  // chordNameToSelection parses back into root/quality/extension when a
  // progression entry is re-selected, and sanitizeFilename's MIDI export
  // name, so onAddToProgression and handleExportMidi both keep using the
  // prop directly. Only this formatted copy reaches the page.
  const displayChordName = toUnicodeAccidentals(chordName)

  function renderDetailsPanel() {
    return (
      <div className="chord-output__details-panel">
        <dl className="chord-output__details">
          <div className="chord-output__detail-row">
            <dt>Notes</dt>
            <dd>{noteNames.join(' · ')}</dd>
          </div>
          {intervals && intervals.length > 0 && (
            <div className="chord-output__detail-row">
              <dt title="The distance between each note — Root is the tonic, 3 is the third, 5 is the fifth">Intervals</dt>
              <dd>{intervals.map(formatInterval).join(' · ')}</dd>
            </div>
          )}
        </dl>
        {isPro ? (
          <button
            type="button"
            className={`chord-output__export-btn ${exportStatus === 'error' ? 'chord-output__export-btn--error' : ''}`}
            onClick={handleExportMidi}
            disabled={exportStatus === 'exporting' || !notes || notes.length === 0}
          >
            {exportStatus === 'exporting' ? 'Exporting…'
              : exportStatus === 'success' ? 'Downloaded!'
                : exportStatus === 'error' ? 'Export failed'
                  : 'Export MIDI'}
          </button>
        ) : (
          <button type="button" className="chord-output__export-btn chord-output__export-btn--locked" disabled>
            Export MIDI <span className="chord-output__pro-badge">PRO</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="chord-output" id="wt-chord-output">
      <h2 className="chord-output__title">Explore {displayChordName}</h2>
      <div className="chord-output__body">
        <div className="chord-output__summary">
          {/* Play sits beside the chord it plays, at desktop widths only.
              It reads as an action here because it's attached to the thing
              being acted on and says so in words -- unlike the version this
              replaces, which sat between two navigation tabs wearing nothing
              but a triangle and the chord symbol, and duly read as a third
              tab. Phones hide it: the dock's own Play chord button is always
              on screen there, and two identical buttons a thumb apart is
              worse than one. */}
          <div className="chord-output__name-row">
            <div className="chord-output__name">{displayChordName}</div>
            {onPlayChord && (
              <button
                type="button"
                className={`chord-output__play-btn ${isPlayingChord ? 'chord-output__play-btn--playing' : ''}`}
                onClick={onPlayChord}
                disabled={isPlayingChord || !canPlayChord}
                aria-label={`Play chord ${displayChordName}`}
              >
                <span aria-hidden="true">{isPlayingChord ? '♪' : '▶'}</span>
                {isPlayingChord ? 'Playing…' : 'Play chord'}
              </button>
            )}
          </div>
          <button
            type="button"
            className="chord-output__details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen(open => !open)}
          >
            Notes &amp; actions <span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
          </button>
          <div className="chord-output__details-inline" aria-label="Chord notes, intervals and export">
            {renderDetailsPanel()}
          </div>
          <OverlayPage
            isOpen={detailsOpen}
            onClose={() => setDetailsOpen(false)}
            eyebrow={displayChordName}
            eyebrowIsChord
            title="Chord details"
          >
            {renderDetailsPanel()}
          </OverlayPage>
        </div>
        <div className="chord-output__actions">
          {/* Accessible name leads with the visible label so the label is
              contained in the name (WCAG 2.5.3) and the chord still comes
              through -- the same shape as the Play chord control. */}
          <button
            id="wt-add-btn"
            className="chord-output__add-btn"
            onClick={() => onAddToProgression(chordName, notes)}
            aria-label={`Add to progression ${displayChordName}`}
          >
            + Add to progression
          </button>
          {hasSuggestions && (
            <button type="button" className="chord-output__next-btn" onClick={onOpenSuggestions}>
              Explore next chords →
            </button>
          )}
        </div>
      </div>
      {exportStatus === 'error' && (
        <p className="chord-output__export-error" role="status">{exportError}</p>
      )}
    </div>
  )
}
