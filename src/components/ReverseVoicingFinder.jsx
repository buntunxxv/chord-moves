import { useEffect, useMemo, useState } from 'react'
import { Chord } from 'tonal'
import GuitarDisplay from './GuitarDisplay'
import NotePicker from './NotePicker'
import MidiImportPanel from './MidiImportPanel'
import DeckNav from './DeckNav'
import BottomSheet from './BottomSheet'
import { useCardDeck } from '../hooks/useCardDeck'
import { findVoicings, soundingNotes, detectChordName, PITCH_CLASS_NAMES } from '../utils/reverseVoicingLookup'
import { formatChordName, normalizeChordName } from '../utils/formatChordName'
import './ReverseVoicingFinder.css'

const STRING_COUNT = 6
const RESULT_LABELS = ['Best match', '2nd best', '3rd best']

function statsLine(result) {
  const mutedText = result.muted === 0 ? 'no muted strings' : `${result.muted} muted string${result.muted === 1 ? '' : 's'}`
  const spanText = `${result.span} fret${result.span === 1 ? '' : 's'} span`
  const ease = `${mutedText} · ${spanText} · avg fret ${result.avgFret.toFixed(1)}`
  if (result.distance == null) return ease
  return `${result.distance} fret${result.distance === 1 ? '' : 's'} from last chord · ${ease}`
}

// Phase 1: ease/playability-only ranking, no MIDI import (Phase 3). Free
// for every user for now -- there's no Pro gate here yet, same way the
// rest of this app gates a feature only once it actually needs to (this
// one has no reason to yet).
//
// Phase 2: once the progression already has a chord in it, proximity to
// that last chord's own currently-displayed guitar shape REPLACES ease as
// the ranking (not blended with it) -- see reverseVoicingLookup.js's
// findVoicings for why. referenceGuitarShape is resolved by App.jsx
// (which already owns the lookup logic for every chord's guitar shape);
// this component only needs progression for the "closest to X" hint text.
// MIDI import (alongside the note picker) is Pro-gated -- unlike Phase 1's
// note-picker matching itself, which stays free (see the comment above).
// `isPro`/`onImportSequence` are new; both are threaded straight through
// from App.jsx (isPro is the same tier flag every other Pro-gated control
// in this app already reads, onImportSequence is addProgressionSequence,
// the bulk sibling of onAddToProgression -- see its own comment in App.jsx
// for why a range import needs a dedicated bulk function rather than
// calling onAddToProgression once per chord in a loop).
export default function ReverseVoicingFinder({ onAddToProgression, onImportSequence, progression, referenceGuitarShape, isPro }) {
  const [selected, setSelected] = useState([])
  const [inputMode, setInputMode] = useState('notes') // 'notes' | 'midi'
  // Shapes exist from the first note picked, but picking is incremental -- a
  // sheet that opened on that first tap would sit over the keys still being
  // tapped. So the results announce themselves as a bar, and opening them is
  // a deliberate tap.
  const [sheetOpen, setSheetOpen] = useState(false)

  // Defense-in-depth, same pattern InstrumentDock uses for its own tabs:
  // even if inputMode somehow held 'midi' while isPro was/became false,
  // this snaps back to the note picker rather than leaving the locked
  // panel showing.
  useEffect(() => {
    if (!isPro && inputMode === 'midi') setInputMode('notes')
  }, [isPro, inputMode])

  const results = useMemo(() => {
    if (selected.length === 0 || selected.length > STRING_COUNT) return []
    return findVoicings(selected, { maxResults: 3, referenceShape: referenceGuitarShape?.frets ?? null })
  }, [selected, referenceGuitarShape])

  // Memoised rather than derived inline because `shapes` below depends on
  // it and useCardDeck keys the deck off that array's identity -- a fresh
  // array every render would snap the deck back to the first shape.
  const selectedNoteNames = useMemo(
    () => selected.slice().sort((a, b) => a - b).map(pc => PITCH_CLASS_NAMES[pc]),
    [selected],
  )

  // Naming resolved here rather than inside the render loop, so the deck's
  // counter can show the current shape's chord name without detecting it a
  // second time.
  const shapes = useMemo(() => results.map(result => {
    // Detected per-result, not once for the whole picked set -- this specific
    // shape's actual sounding notes (doublings/an extra tone) can genuinely
    // differ from another ranked shape's, so they can legitimately deserve
    // different names.
    const detected = detectChordName(result.frets)
    // rawName is what gets stored as a progression entry's "chord" field
    // (onAddToProgression below) -- plain ASCII, so a later tap on the chip
    // can still round-trip through chordNameToSelection. name is the
    // Unicode-accidental version for display only (see formatChordName).
    const rawName = normalizeChordName(detected.name)
    const name = formatChordName(detected.name)
    // Root for GuitarDisplay's highlight/aria-label: derived from the RAW
    // detected name (Chord.get needs tonal's own naming, not
    // formatChordName's display-only "M"-tag stripping), same
    // Chord.get(...).tonic pattern App.jsx already uses. Falls back to the
    // first picked note when detection found no confident match
    // (detected.name is then just a plain note list, which Chord.get can't
    // resolve a tonic from).
    const root = detected.root || Chord.get(detected.name).tonic || selectedNoteNames[0]
    return { result, detected, rawName, name, root }
  }), [results, selectedNoteNames])

  const { index, isDeck, trackRef, cardRefs, chipRefs, goTo, handleChipKeyDown } = useCardDeck(shapes, sheetOpen)

  const lastChordName = progression && progression.length > 0 ? progression[progression.length - 1].chord : null

  function addShape(shape) {
    onAddToProgression?.(shape.rawName, soundingNotes(shape.result.frets))
    // Close on add: the dock is behind the backdrop, so leaving the sheet up
    // would hide the only feedback that the chord actually landed anywhere.
    setSheetOpen(false)
  }

  // In the one-card deck the add button lives in the sheet's pinned footer and
  // acts on whichever card is showing, so it is visible without scrolling on
  // any phone. In the wide layout every card is on screen at once, so each
  // keeps its own button.
  const current = shapes[index]
  const deckFooter = isDeck && current ? (
    <button
      type="button"
      className="reverse-finder__add-btn reverse-finder__add-btn--footer"
      onClick={() => addShape(current)}
      aria-label={`Add to progression ${current.name}`}
    >
      + Add {current.name} to progression
    </button>
  ) : null

  return (
    <div className="reverse-finder">
      {/* No heading here: the workspace h1 names whichever slide you are on.
          The hint stays -- it says what to do, which that title doesn't. */}
      <p className="reverse-finder__hint">
        {referenceGuitarShape
          ? `Tap the notes you want to hear, then see the best shapes near ${lastChordName} on the neck.`
          : 'Tap the notes you want to hear, then see the best playable guitar shapes that contain them.'}
      </p>

      <div className="reverse-finder__input-tabs" role="tablist" aria-label="Note input method">
        <button
          type="button"
          role="tab"
          aria-selected={inputMode === 'notes'}
          className={`reverse-finder__input-tab ${inputMode === 'notes' ? 'reverse-finder__input-tab--active' : ''}`}
          onClick={() => setInputMode('notes')}
        >
          Pick Notes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={inputMode === 'midi'}
          className={`reverse-finder__input-tab ${inputMode === 'midi' ? 'reverse-finder__input-tab--active' : ''}`}
          disabled={!isPro}
          onClick={() => { if (isPro) setInputMode('midi') }}
        >
          Import MIDI
          {!isPro && <span className="reverse-finder__pro-badge">PRO</span>}
        </button>
      </div>

      {inputMode === 'notes' ? (
        <NotePicker selected={selected} onChange={setSelected} />
      ) : (
        isPro && (
          <MidiImportPanel
            onLoadMoment={pitchClasses => setSelected(pitchClasses)}
            onImportSequence={chords => onImportSequence?.(chords)}
            onImportError={() => setSelected([])}
          />
        )
      )}

      <div className="reverse-finder__selection-row">
        <span className="reverse-finder__selection">
          {selectedNoteNames.length > 0 ? `Selected: ${selectedNoteNames.join(', ')}` : 'No notes selected yet'}
        </span>
        {selected.length > 0 && (
          <button type="button" className="reverse-finder__clear-btn" onClick={() => setSelected([])}>
            Clear
          </button>
        )}
      </div>

      {selected.length > STRING_COUNT && (
        <p className="reverse-finder__notice">
          A guitar only has 6 strings — pick {STRING_COUNT} notes or fewer so a shape can sound all of them.
        </p>
      )}

      {selected.length > 0 && selected.length <= STRING_COUNT && (
        shapes.length === 0 ? (
          <p className="reverse-finder__notice">
            No playable shape found for these notes within a 15-fret range.
          </p>
        ) : (
          <button
            type="button"
            className="reverse-finder__results-bar"
            onClick={() => setSheetOpen(true)}
          >
            <span className="reverse-finder__results-count">
              {shapes.length} shape{shapes.length === 1 ? '' : 's'} found
            </span>
            <span className="reverse-finder__results-cta" aria-hidden="true">View →</span>
          </button>
        )
      )}

      <BottomSheet
        isOpen={sheetOpen && shapes.length > 0}
        onClose={() => setSheetOpen(false)}
        eyebrow="Identify"
        title={`Shapes for ${selectedNoteNames.join(', ')}`}
        footer={deckFooter}
      >
        {/* Chips are the rank, not the chord name: three voicings of one chord
            detect as the same name more often than not, and three identical
            chips would name nothing. Ranking is what distinguishes these
            cards, and the counter carries the name alongside it. */}
        <DeckNav
          count={shapes.length}
          index={index}
          name={shapes[index]?.name}
          chipLabels={shapes.map((_, i) => RESULT_LABELS[i] || `#${i + 1}`)}
          noun="shape"
          onGoTo={goTo}
          onChipKeyDown={handleChipKeyDown}
          chipRefs={chipRefs}
        />
        <div className="reverse-finder__results deck-track" ref={trackRef}>
          {shapes.map((shape, i) => {
            const { result, detected, name, root } = shape
            const rank = RESULT_LABELS[i] || `#${i + 1}`
            return (
              <article
                className="reverse-finder__result"
                key={result.frets.join('-')}
                ref={el => { cardRefs.current[i] = el }}
                aria-label={isDeck ? `${rank}, ${name}, ${i + 1} of ${shapes.length}` : undefined}
              >
                <div className="reverse-finder__result-label">{rank}</div>
                <div className={`reverse-finder__result-name ${detected.isDetected ? '' : 'reverse-finder__result-name--fallback'}`}>
                  {name}
                </div>
                {detected.isDetected && detected.alternates.length > 0 && (
                  <div className="reverse-finder__result-alt">also: {detected.alternates.map(formatChordName).join(', ')}</div>
                )}
                <GuitarDisplay shape={{ frets: result.frets }} notes={selectedNoteNames} root={root} compact />
                <div className="reverse-finder__result-stats">{statsLine(result)}</div>
                {!isDeck && (
                  <button
                    type="button"
                    className="reverse-finder__add-btn"
                    onClick={() => addShape(shape)}
                    aria-label={`Add to progression ${name}`}
                  >
                    + Add to progression
                  </button>
                )}
              </article>
            )
          })}
        </div>
      </BottomSheet>
    </div>
  )
}
