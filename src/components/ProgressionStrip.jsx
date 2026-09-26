import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import * as Tone from 'tone'
import { createKeysSynth, startAudioContext } from '../audio/synth'
import { computePlaybackProgression } from '../utils/voiceLeading'
import { buildProgressionMidiBytes, downloadMidiFile } from '../utils/midiExport'
import InstrumentDock from './InstrumentDock'
import PianoDisplay from './PianoDisplay'
import './ProgressionStrip.css'

const BPM_MIN = 60
const BPM_MAX = 140
const BPM_MID = 100
const SNAP_THRESHOLD = 4
const SAVED_STORAGE_KEY = 'chordMovesSavedProgressions'
const CONFIRMATION_MS = 1500
// The arrangement is a 4-wide grid, one page at a time. Rows appear only once
// there are chords to fill them -- four chords is one row, the 5th opens a
// second, the 9th a third, the 13th a fourth -- so a short progression never
// sits in a mostly-empty 16-cell frame. Note that the free tier stops at four
// chords (PROGRESSION_LIMIT in App.jsx), so rows two and beyond are Pro
// territory in practice.
const GRID_COLUMNS = 4
const PAGE_SIZE = GRID_COLUMNS * 4

function formatProgressionText(progression) {
  return progression
    .map(entry => (entry.degree ? `${entry.chord} (${entry.degree})` : entry.chord))
    .join(' – ')
}

function snapBpm(val) {
  return Math.abs(val - BPM_MID) <= SNAP_THRESHOLD ? BPM_MID : val
}

export default function ProgressionStrip({ expanded, onExpandedChange, currentChordName, onPlayChord, isChordPlaying, canPlayChord, progression, selectedChordIndex, bpm, onBpmChange, onClear, onRemoveSelected, onSelectChord, onReorder, onLoadSaved, teaserMessage, onPlayingChordChange, chordNotes, previewNotes, bassHighlightNote, keysRootNote, keysPositionIndex, onKeysPositionChange, guitarPositionIndex, onGuitarPositionChange, root, guitarShape, guitarSlashNotice, guitarInversionUnavailable, guitarPositions, templateInfo, canUndoLoad, onUndoLoad, isPro }) {
  const [activeIndex, setActiveIndex] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const synthRef = useRef(null)

  // ProgressionStrip mounts and unmounts every time the app switches to/from
  // the Learn tab -- without this, every switch leaked a running
  // synth+effects chain (see the dispose() comment in audio/synth.js).
  useEffect(() => () => synthRef.current?.dispose(), [])

  // Phone-only disclosure for the instrument section: on a phone the
  // keyboard/fretboard used to eat the whole first screen before the user
  // could reach their own progression or Play, so it starts closed and the
  // timeline + transport get that space instead. There's no matching
  // desktop state because the desktop layout shows the instrument as a
  // permanent side inspector -- the toggle itself is display:none there, so
  // its aria-expanded never contradicts what's on screen.
  const [instrumentOpen, setInstrumentOpen] = useState(false)
  // Keyboard-accessible reordering: focus is handed to the opposite button
  // whenever a move parks the selected chord at an end and disables the
  // button that was just pressed. The hand-off is recorded here and applied
  // from a layout effect below rather than a requestAnimationFrame callback
  // -- rAF is throttled (and in a background tab, suspended outright), so a
  // focus move scheduled that way can arrive long after the button that had
  // focus was disabled and the browser already dropped focus to <body>.
  const moveLeftRef = useRef(null)
  const moveRightRef = useRef(null)
  const pendingMoveFocusRef = useRef(null)
  const chipRefs = useRef([])
  const [page, setPage] = useState(0)

  // Reordering is Move left/Move right only. Long-press drag used to sit
  // alongside it, but it was built around a single horizontally-scrolling row
  // -- its edge auto-scroll and 1D nearest-chip search both assumed every chip
  // shared a y -- and neither survives a grid. It was also never verified on a
  // real device, since automation cannot produce a true long press.
  function moveSelected(delta) {
    if (selectedChordIndex == null || isPlaying) return
    const to = selectedChordIndex + delta
    if (to < 0 || to >= progression.length) return
    onReorder?.(selectedChordIndex, to)
    // Landing on either end disables the button that was just pressed, which
    // would drop focus to the document body mid-reorder -- hand it to the
    // opposite direction instead, which is by definition still enabled.
    if (to === 0 || to === progression.length - 1) {
      pendingMoveFocusRef.current = delta < 0 ? 'right' : 'left'
    }
  }

  // Runs synchronously after the reorder commits and before paint, so focus
  // lands on the still-enabled button in the same frame the other one is
  // disabled -- never leaving a keyboard user on <body> mid-reorder.
  useLayoutEffect(() => {
    const direction = pendingMoveFocusRef.current
    if (!direction) return
    pendingMoveFocusRef.current = null
    const target = direction === 'left' ? moveLeftRef : moveRightRef
    if (target.current && !target.current.disabled) target.current.focus()
  })

  // The progression page always brings the relevant chord into view: the
  // sounding chord during playback, otherwise the chord the user selected.
  useEffect(() => {
    if (!expanded) return
    const indexToReveal = activeIndex ?? selectedChordIndex
    if (indexToReveal == null) return
    // Turning the page matters more than scrolling now: playing a progression
    // longer than one page would otherwise highlight the sounding chord on a
    // page you are not looking at.
    setPage(Math.floor(indexToReveal / PAGE_SIZE))
    chipRefs.current[indexToReveal]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeIndex, selectedChordIndex, expanded])

  // Removing chords can strand the view on a page that no longer exists.
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(progression.length / PAGE_SIZE) - 1)
    setPage(current => Math.min(current, lastPage))
  }, [progression.length])

  const [savedProgressions, setSavedProgressions] = useState(() => {
    try {
      const stored = localStorage.getItem(SAVED_STORAGE_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  // 'idle' | 'exporting' | 'success' | 'error' -- gives the Export button a
  // brief, visible state for each phase, instead of the previous
  // build-and-download happening with no feedback at all if it fails.
  const [exportStatus, setExportStatus] = useState('idle')
  const [exportError, setExportError] = useState('')
  const [showSavedPanel, setShowSavedPanel] = useState(false)
  // Index of the saved-progression item currently being renamed inline, or
  // null when nothing is being edited -- only one at a time, same as the
  // top-level save flow only ever has one name input open.
  const [savedEditingIndex, setSavedEditingIndex] = useState(null)
  const [savedEditName, setSavedEditName] = useState('')
  // Reuses the exact same brief, self-clearing role="status" pattern (and
  // even the same CSS class) as justSaved's "Progression saved" message
  // above, just parameterized by message so rename and delete can both
  // flash through it instead of each inventing their own toast.
  const [savedListStatus, setSavedListStatus] = useState('')
  const saveInputRef = useRef(null)
  const savedEditInputRef = useRef(null)
  const exportResetRef = useRef(null)
  const savedListStatusResetRef = useRef(null)

  useEffect(() => {
    localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedProgressions))
  }, [savedProgressions])

  useEffect(() => () => {
    if (exportResetRef.current) clearTimeout(exportResetRef.current)
    if (savedListStatusResetRef.current) clearTimeout(savedListStatusResetRef.current)
  }, [])

  useEffect(() => {
    if (showSaveInput) saveInputRef.current?.focus()
  }, [showSaveInput])

  useEffect(() => {
    if (savedEditingIndex != null) savedEditInputRef.current?.focus()
  }, [savedEditingIndex])

  function handleSaveClick() {
    if (!isPro || progression.length === 0) return
    setSaveName('')
    setShowSaveInput(true)
  }

  function handleConfirmSave() {
    const name = saveName.trim()
    if (!name) return
    setSavedProgressions(prev => [...prev, { name, chords: progression, savedAt: Date.now() }])
    setShowSaveInput(false)
    setSaveName('')
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), CONFIRMATION_MS)
  }

  function handleCancelSave() {
    setShowSaveInput(false)
    setSaveName('')
  }

  function handleSaveKeyDown(e) {
    if (e.key === 'Enter') handleConfirmSave()
    if (e.key === 'Escape') handleCancelSave()
  }

  // Exports a real playable .mid file (via @tonejs/midi), not clipboard
  // text -- one chord per bar, in sequence, using the exact same voiced
  // notes (Close/Drop-2/Split, slash/inversion-aware) that Play actually
  // sounds, since both go through computePlaybackProgression.
  function handleExportClick() {
    if (!isPro || progression.length === 0) return
    if (exportResetRef.current) clearTimeout(exportResetRef.current)
    setExportStatus('exporting')
    setExportError('')
    // Deferred a tick so the "Exporting…" state actually gets painted --
    // building the bytes and clicking the download anchor are otherwise
    // synchronous and would otherwise land in the same batched render as
    // the success/error state that follows it.
    setTimeout(() => {
      try {
        const voicedProgression = computePlaybackProgression(progression, isPro)
        const bytes = buildProgressionMidiBytes(voicedProgression, bpm)
        downloadMidiFile(bytes, 'chord-progression.mid')
        setExportStatus('success')
      } catch (err) {
        setExportStatus('error')
        setExportError(err instanceof Error ? err.message : 'Export failed')
      }
      exportResetRef.current = setTimeout(() => setExportStatus('idle'), CONFIRMATION_MS)
    }, 0)
  }

  function handleLoadSaved(chords) {
    onLoadSaved?.(chords)
    setShowSavedPanel(false)
  }

  function flashSavedListStatus(message) {
    if (savedListStatusResetRef.current) clearTimeout(savedListStatusResetRef.current)
    setSavedListStatus(message)
    savedListStatusResetRef.current = setTimeout(() => setSavedListStatus(''), CONFIRMATION_MS)
  }

  function startSavedRename(index, currentName) {
    setSavedEditingIndex(index)
    setSavedEditName(currentName)
  }

  function cancelSavedRename() {
    setSavedEditingIndex(null)
    setSavedEditName('')
  }

  function confirmSavedRename(index) {
    const name = savedEditName.trim()
    if (!name) {
      cancelSavedRename()
      return
    }
    setSavedProgressions(prev => prev.map((saved, i) => (i === index ? { ...saved, name } : saved)))
    cancelSavedRename()
    flashSavedListStatus('Progression renamed')
  }

  function handleSavedRenameKeyDown(e, index) {
    if (e.key === 'Enter') confirmSavedRename(index)
    if (e.key === 'Escape') cancelSavedRename()
  }

  function handleDeleteSaved(index) {
    const target = savedProgressions[index]
    if (!target) return
    if (!window.confirm(`Delete saved progression "${target.name}"?`)) return
    setSavedProgressions(prev => prev.filter((_, i) => i !== index))
    // Deleting shifts every later index down by one -- if an unrelated item
    // was mid-rename, keep that edit pointed at the right row rather than
    // silently dropping or misattributing it; only clear it outright if the
    // deleted row was the one actually being edited.
    setSavedEditingIndex(prev => {
      if (prev == null) return prev
      if (prev === index) return null
      return prev > index ? prev - 1 : prev
    })
    if (savedEditingIndex === index) setSavedEditName('')
    flashSavedListStatus('Progression deleted')
  }

  async function handlePlay() {
    if (isPlaying || progression.length === 0) return
    setIsPlaying(true)

    await startAudioContext()
    Tone.getTransport().bpm.value = bpm

    if (!synthRef.current) {
      synthRef.current = createKeysSynth()
    }
    const synth = synthRef.current
    const barDuration = (60 / bpm) * 4 // seconds per chord (one bar)
    const now = Tone.now()

    // Every chord plays back exactly as stored -- the same notes a
    // single-chord preview would sound for it (no chord-to-chord
    // re-voicing; see voiceLeading.js for why that was removed). EACH
    // chord's OWN stored Keys voicing (Close/Drop-2/Split -- set at
    // add-time, not the single global keysPositionIndex the live builder
    // happens to be showing right now) is layered on top of its own notes
    // as a separate, per-chord step, with the same Pro-tier clamp the live
    // builder uses so a free user can't hear a Pro-gated position here
    // either. Pulled into computePlaybackProgression (voiceLeading.js) so
    // MIDI export builds the exact same voiced notes.
    const voicedProgression = computePlaybackProgression(progression, isPro)

    voicedProgression.forEach((entry, i) => {
      synth.triggerAttackRelease(entry.notes, '1m', now + i * barDuration)
      setTimeout(() => {
        setActiveIndex(i)
        onPlayingChordChange?.(entry.notes, entry.rootNote, entry.chord)
      }, i * barDuration * 1000)
    })

    const totalMs = progression.length * barDuration * 1000 + 300
    setTimeout(() => {
      setActiveIndex(null)
      setIsPlaying(false)
      onPlayingChordChange?.(null, null, null)
    }, totalMs)
  }

  const chordCount = progression.length
  const chordCountLabel = `${chordCount} chord${chordCount === 1 ? '' : 's'}`
  const isEmpty = chordCount === 0
  const hasSelection = selectedChordIndex != null && selectedChordIndex < chordCount

  return (
    <div className={`progression-strip ${expanded ? 'progression-strip--expanded' : 'progression-strip--collapsed'}`} id="wt-progression">
      {/* ─── Collapsed dock ──────────────────────────────────────────────────
          A plain container, NOT a role="button": the version this replaces
          nested real <button>s inside a tabbable div that announced itself as
          a single button, which is invalid and made the inner controls
          unreachable in any predictable order. Every action here now owns its
          own semantic button, and the container itself is inert. */}
      <div className="progression-strip__dock">
        <div className="progression-strip__dock-current">
          <span className="progression-strip__dock-label">Current chord</span>
          <span className="progression-strip__dock-chord">{currentChordName || '—'}</span>
        </div>

        {/* The same PianoDisplay the expanded workspace renders, in its
            existing `miniature` mode -- one implementation of the
            note-matching and key geometry, so this strip can never drift out
            of sync with the full keyboard. It tracks chordNotes, which
            App.jsx already points at the sounding chord during progression
            playback and at the builder's own chord otherwise. */}
        <PianoDisplay
          chordNotes={chordNotes}
          previewNotes={previewNotes}
          bassHighlightNote={bassHighlightNote}
          rootNote={keysRootNote}
          miniature
        />

        <div className="progression-strip__dock-actions">
          <button
            id="wt-play-btn"
            type="button"
            className={`progression-strip__dock-play ${isChordPlaying ? 'progression-strip__dock-play--playing' : ''}`}
            onClick={onPlayChord}
            disabled={isChordPlaying || !canPlayChord}
            aria-label={`Play chord ${currentChordName || ''}`.trim()}
          >
            <span aria-hidden="true">{isChordPlaying ? '♪' : '▶'}</span>
            {isChordPlaying ? 'Playing…' : 'Play chord'}
          </button>
          <button
            type="button"
            className="progression-strip__dock-open"
            onClick={() => onExpandedChange?.(true)}
          >
            Progression
            <span aria-hidden="true">·</span>
            <span className="progression-strip__dock-count">{chordCount}</span>
            {/* Keeps the button's own visible text as its accessible name
                (rather than an aria-label that would replace it) while still
                saying what the bare number counts. */}
            <span className="sr-only">{chordCount === 1 ? 'chord' : 'chords'}</span>
          </button>
        </div>
      </div>

      <header className="progression-strip__page-header">
        <div>
          <span className="progression-strip__page-eyebrow">Progression workspace</span>
          <h2>{isEmpty ? 'Build your progression' : `${chordCount}-chord progression`}</h2>
        </div>
        <button type="button" className="progression-strip__page-close" onClick={() => onExpandedChange?.(false)} aria-label="Close progression workspace">×</button>
      </header>

      {/* ─── Expanded workspace ──────────────────────────────────────────────
          Source order IS the phone order: arrangement, transport, the
          instrument, then the secondary Manage and destructive sections. The
          desktop layout re-places those same five regions into a two-column
          split via named grid areas (see ProgressionStrip.css) -- no second
          copy of the markup, and no reliance on `order` to fake a reading
          sequence that doesn't match the DOM. */}
      <div className="progression-strip__expanded-content">
        <div className="progression-strip__layout">
          <div className="progression-strip__notices">
            {teaserMessage && (
              <div className="progression-strip__teaser">🔒 {teaserMessage}</div>
            )}

            {templateInfo && !isEmpty && (
              <div className="progression-strip__template-banner">
                <strong>{templateInfo.name}</strong> — {templateInfo.description}
              </div>
            )}

            {/* One-step undo for the progression that was just replaced by a
                template load -- App.jsx clears this (canUndoLoad becomes
                false) after ~10s or as soon as any other progression edit
                happens, so it never lingers as a stale offer to restore an
                outdated state. */}
            {canUndoLoad && (
              <div className="progression-strip__undo-banner">
                <span>Progression loaded.</span>
                <button type="button" className="progression-strip__undo-btn" onClick={onUndoLoad}>
                  Undo
                </button>
              </div>
            )}
          </div>

          {/* ── 1. Arrangement ── */}
          <section className="progression-strip__section progression-strip__arrangement" aria-labelledby="prog-arrangement-heading">
            <div className="progression-strip__section-head">
              <h3 className="progression-strip__section-title" id="prog-arrangement-heading">Arrangement</h3>
              {!isEmpty && <span className="progression-strip__section-meta">{chordCountLabel}</span>}
            </div>

            {isEmpty ? (
              <p className="progression-strip__empty">No chords yet — add one from Build, Identify or Templates and it lands here.</p>
            ) : (
              <>
                {(() => {
                  const pageCount = Math.max(1, Math.ceil(progression.length / PAGE_SIZE))
                  const safePage = Math.min(page, pageCount - 1)
                  const pageStart = safePage * PAGE_SIZE
                  const pageEntries = progression.slice(pageStart, pageStart + PAGE_SIZE)
                  const rows = Math.min(GRID_COLUMNS, Math.max(1, Math.ceil(pageEntries.length / GRID_COLUMNS)))
                  const cells = Array.from({ length: rows * GRID_COLUMNS }, (_, i) => pageEntries[i] ?? null)
                  return (
                    <>
                      <div
                        className="progression-strip__grid"
                        style={{ '--prog-rows': rows }}
                        role="group"
                        aria-label={pageCount > 1 ? `Chords ${pageStart + 1} to ${pageStart + pageEntries.length} of ${progression.length}` : 'Chords in this progression'}
                      >
                        {cells.map((entry, cell) => {
                          if (!entry) {
                            // A placeholder rather than nothing, so a part-full
                            // row still reads as a row with space left in it.
                            return <span key={`empty-${cell}`} className="progression-strip__cell-empty" aria-hidden="true" />
                          }
                          const index = pageStart + cell
                          // Every chip is selectable, not just the last one --
                          // Session 11's "last chip only" restriction is lifted
                          // here; the same generalization also makes chords with
                          // accidental roots (e.g. F#m7) fully tappable, since
                          // the exclusion was never really about accidentals,
                          // just about position, and chordNameToSelection
                          // already parses sharps/flats correctly (Session 18).
                          const tappable = !isPlaying
                          return (
                            <button
                              key={index}
                              type="button"
                              ref={el => { chipRefs.current[index] = el }}
                              className={`progression-strip__slot ${activeIndex === index ? 'progression-strip__slot--active' : ''} ${activeIndex == null && selectedChordIndex === index ? 'progression-strip__slot--selected' : ''} ${tappable ? 'progression-strip__slot--tappable' : ''}`}
                              aria-pressed={selectedChordIndex === index}
                              disabled={!tappable}
                              onClick={() => onSelectChord?.(index, entry.chord)}
                              title={tappable ? `Select ${entry.chord}` : undefined}
                            >
                              <span className="progression-strip__slot-index">{index + 1}</span>
                              <span className="progression-strip__slot-chord">{entry.chord}</span>
                            </button>
                          )
                        })}
                      </div>

                      {pageCount > 1 && (
                        <div className="progression-strip__pager" role="group" aria-label="Progression pages">
                          <button
                            type="button"
                            className="progression-strip__pager-btn"
                            onClick={() => setPage(current => Math.max(0, current - 1))}
                            disabled={safePage === 0}
                            aria-label="Previous page of chords"
                          >
                            ←
                          </button>
                          <span className="progression-strip__pager-label" aria-live="polite">
                            Chords {pageStart + 1}–{pageStart + pageEntries.length} of {progression.length}
                          </span>
                          <button
                            type="button"
                            className="progression-strip__pager-btn"
                            onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))}
                            disabled={safePage >= pageCount - 1}
                            aria-label="Next page of chords"
                          >
                            →
                          </button>
                        </div>
                      )}
                    </>
                  )
                })()}

                {/* The only route to reordering now that long-press drag is
                    gone -- and the only one that ever worked from a keyboard. */}
                <div className="progression-strip__reorder" role="group" aria-label="Reorder the selected chord">
                  <span className="progression-strip__reorder-status">
                    {hasSelection
                      ? `Chord ${selectedChordIndex + 1} of ${chordCount} selected`
                      : 'Select a chord to move it'}
                  </span>
                  <div className="progression-strip__reorder-buttons">
                    <button
                      type="button"
                      ref={moveLeftRef}
                      className="progression-strip__reorder-btn"
                      onClick={() => moveSelected(-1)}
                      disabled={!hasSelection || isPlaying || selectedChordIndex === 0}
                    >
                      <span aria-hidden="true">←</span> Move left
                    </button>
                    <button
                      type="button"
                      ref={moveRightRef}
                      className="progression-strip__reorder-btn"
                      onClick={() => moveSelected(1)}
                      disabled={!hasSelection || isPlaying || selectedChordIndex === chordCount - 1}
                    >
                      Move right <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* ── 2. Transport ── */}
          <section className="progression-strip__section progression-strip__transport" aria-labelledby="prog-transport-heading">
            <h3 className="progression-strip__section-title" id="prog-transport-heading">Transport</h3>
            <div className="progression-strip__transport-row">
              <button
                className={`progression-strip__play-btn ${isPlaying ? 'progression-strip__play-btn--playing' : ''}`}
                onClick={handlePlay}
                disabled={isPlaying || isEmpty}
              >
                <span aria-hidden="true">{isPlaying ? '♪' : '▶'}</span> {isPlaying ? 'Playing…' : 'Play progression'}
              </button>

              <div className="progression-strip__bpm">
                <span
                  className={`progression-strip__bpm-value ${bpm === BPM_MID ? 'progression-strip__bpm-value--snapped' : ''}`}
                  title="Tempo — only affects sequences of more than one chord"
                >
                  {bpm} BPM
                </span>
                <input
                  type="range"
                  min={BPM_MIN}
                  max={BPM_MAX}
                  value={bpm}
                  onChange={e => onBpmChange(snapBpm(Number(e.target.value)))}
                  className="progression-strip__bpm-slider"
                  aria-label="Tempo in BPM"
                />
              </div>
            </div>
          </section>

          {/* ── 3. Selected chord (desktop: side inspector; phone: collapsed
                 disclosure so the timeline and transport own the first
                 screen) ── */}
          <section className="progression-strip__section progression-strip__inspector" aria-labelledby="prog-instrument-heading">
            <div className="progression-strip__section-head">
              <h3 className="progression-strip__section-title" id="prog-instrument-heading">Selected chord</h3>
              <button
                type="button"
                className="progression-strip__disclosure"
                aria-expanded={instrumentOpen}
                aria-controls="prog-instrument-body"
                onClick={() => setInstrumentOpen(open => !open)}
              >
                {instrumentOpen ? 'Hide instrument' : 'Show instrument'}
              </button>
            </div>
            <div
              id="prog-instrument-body"
              className={`progression-strip__section-body ${instrumentOpen ? '' : 'progression-strip__section-body--collapsed'}`}
            >
              <InstrumentDock
                chordNotes={chordNotes}
                previewNotes={previewNotes}
                bassHighlightNote={bassHighlightNote}
                keysRootNote={keysRootNote}
                keysPositionIndex={keysPositionIndex}
                onKeysPositionChange={onKeysPositionChange}
                guitarPositionIndex={guitarPositionIndex}
                onGuitarPositionChange={onGuitarPositionChange}
                root={root}
                guitarShape={guitarShape}
                guitarSlashNotice={guitarSlashNotice}
                guitarInversionUnavailable={guitarInversionUnavailable}
                guitarPositions={guitarPositions}
                isPro={isPro}
              />
            </div>
          </section>

          {/* ── 4. Manage ── */}
          <section className="progression-strip__section progression-strip__manage" aria-labelledby="prog-manage-heading">
            <h3 className="progression-strip__section-title" id="prog-manage-heading">Manage</h3>

            <div className="progression-strip__pro-group">
              {showSaveInput ? (
                <div className="progression-strip__save-inline">
                  <input
                    ref={saveInputRef}
                    type="text"
                    className="progression-strip__save-input"
                    placeholder="Name this progression"
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    onKeyDown={handleSaveKeyDown}
                    maxLength={60}
                  />
                  <button
                    className="progression-strip__save-confirm-btn"
                    onClick={handleConfirmSave}
                    disabled={!saveName.trim()}
                    aria-label="Confirm save"
                  >
                    ✓
                  </button>
                  <button
                    className="progression-strip__save-cancel-btn"
                    onClick={handleCancelSave}
                    aria-label="Cancel save"
                  >
                    ✕
                  </button>
                </div>
              ) : isPro ? (
                <button
                  className="progression-strip__pro-btn"
                  onClick={handleSaveClick}
                  disabled={isEmpty}
                >
                  {justSaved ? 'Saved!' : 'Save'}
                </button>
              ) : (
                <button className="progression-strip__pro-btn progression-strip__pro-btn--locked" disabled>
                  Save <span className="progression-strip__pro-badge">PRO</span>
                </button>
              )}

              {isPro ? (
                <button
                  className={`progression-strip__pro-btn ${exportStatus === 'error' ? 'progression-strip__pro-btn--error' : ''}`}
                  onClick={handleExportClick}
                  disabled={exportStatus === 'exporting' || isEmpty}
                >
                  {exportStatus === 'exporting' ? 'Exporting…'
                    : exportStatus === 'success' ? 'Exported!'
                      : exportStatus === 'error' ? 'Export failed'
                        : 'Export'}
                </button>
              ) : (
                <button className="progression-strip__pro-btn progression-strip__pro-btn--locked" disabled>
                  Export <span className="progression-strip__pro-badge">PRO</span>
                </button>
              )}

              {isPro && (
                <button
                  className="progression-strip__saved-toggle"
                  aria-expanded={showSavedPanel}
                  aria-controls="prog-saved-panel"
                  onClick={() => setShowSavedPanel(o => !o)}
                >
                  Saved ({savedProgressions.length}) <span aria-hidden="true">{showSavedPanel ? '▲' : '▼'}</span>
                </button>
              )}
            </div>

            {/* Same self-clearing status-message pattern the export button
                uses (role="status" so it's announced, cleared by the same
                justSaved timeout that flips the Save button's own label
                back) -- previously the only feedback here was the "Saved (N)"
                toggle's count silently changing, easy to miss since it sits
                to the side of the button that was actually clicked. */}
            {justSaved && (
              <p className="progression-strip__save-status" role="status">Progression saved</p>
            )}

            {exportStatus === 'error' && (
              <p className="progression-strip__export-error" role="status">{exportError}</p>
            )}

            {isPro && showSavedPanel && (
              <div id="prog-saved-panel">
                <div className="progression-strip__saved-panel">
                  {savedProgressions.length === 0 ? (
                    <p className="progression-strip__saved-empty">No saved progressions yet — build one and tap Save</p>
                  ) : (
                    <ul className="progression-strip__saved-list">
                      {savedProgressions.map((saved, i) => (
                        <li key={i} className="progression-strip__saved-item">
                          <div className="progression-strip__saved-info">
                            {savedEditingIndex === i ? (
                              <input
                                ref={savedEditInputRef}
                                type="text"
                                className="progression-strip__save-input progression-strip__saved-edit-input"
                                value={savedEditName}
                                onChange={e => setSavedEditName(e.target.value)}
                                onKeyDown={e => handleSavedRenameKeyDown(e, i)}
                                maxLength={60}
                              />
                            ) : (
                              <span className="progression-strip__saved-name">{saved.name}</span>
                            )}
                            <span className="progression-strip__saved-chords">{formatProgressionText(saved.chords)}</span>
                          </div>
                          <div className="progression-strip__saved-actions">
                            {savedEditingIndex === i ? (
                              <>
                                <button
                                  className="progression-strip__save-confirm-btn"
                                  onClick={() => confirmSavedRename(i)}
                                  disabled={!savedEditName.trim()}
                                  aria-label="Confirm rename"
                                >
                                  ✓
                                </button>
                                <button
                                  className="progression-strip__save-cancel-btn"
                                  onClick={cancelSavedRename}
                                  aria-label="Cancel rename"
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="progression-strip__saved-load-btn"
                                  onClick={() => handleLoadSaved(saved.chords)}
                                >
                                  Load
                                </button>
                                <button
                                  className="progression-strip__saved-rename-btn"
                                  onClick={() => startSavedRename(i, saved.name)}
                                  aria-label={`Rename ${saved.name}`}
                                >
                                  Rename
                                </button>
                                <button
                                  className="progression-strip__saved-delete-btn"
                                  onClick={() => handleDeleteSaved(i)}
                                  aria-label={`Delete ${saved.name}`}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Same self-clearing role="status" toast the Save button
                    uses above, reused here for rename/delete instead of a
                    third feedback mechanism. */}
                {savedListStatus && (
                  <p className="progression-strip__save-status" role="status">{savedListStatus}</p>
                )}
              </div>
            )}
          </section>

          {/* ── 5. Destructive actions ──
              Deliberately last, visually quiet, and fenced off from Play:
              nothing here should read as a peer of the transport's primary
              action. */}
          {!isEmpty && (
            <section className="progression-strip__section progression-strip__danger" aria-labelledby="prog-danger-heading">
              <h3 className="progression-strip__section-title" id="prog-danger-heading">Remove chords</h3>
              <div className="progression-strip__danger-row">
                <button
                  className="progression-strip__clear-btn"
                  onClick={onRemoveSelected}
                  disabled={!hasSelection}
                  title={hasSelection ? undefined : 'Select a chord first'}
                >
                  Remove selected
                </button>
                <button
                  className="progression-strip__clear-btn progression-strip__clear-btn--all"
                  onClick={onClear}
                >
                  Clear all
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
