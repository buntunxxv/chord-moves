import { useState, useEffect, useRef } from 'react'
import PianoDisplay from './PianoDisplay'
import GuitarDisplay from './GuitarDisplay'
import { getAdjacentTabIndex } from '../utils/tabsKeyboardNav'
import './InstrumentDock.css'

const KEYS_POSITION_LABELS = ['Close', 'Drop-2', 'Split']

export default function InstrumentDock({ chordNotes, previewNotes, bassHighlightNote, keysRootNote, keysPositionIndex, onKeysPositionChange, guitarPositionIndex, onGuitarPositionChange, root, guitarShape, guitarSlashNotice, guitarInversionUnavailable, guitarMissingNotice = null, guitarPositions, isPro }) {
  const [tab, setTab] = useState('keys')
  // guitarMissingNotice: a progression chord is sounding that has no curated
  // shape. The Guitar tab stays open and says so, rather than closing mid-
  // playback (and staying closed for the next chord that does have one).
  const canShowFrets = !guitarInversionUnavailable && (!!guitarShape || guitarSlashNotice || !!guitarMissingNotice)
  const dockTabRefs = useRef([])
  const dockTabs = [
    { key: 'keys', disabled: false },
    { key: 'frets', disabled: !canShowFrets },
  ]

  function handleDockTabKeyDown(e, index) {
    const nextIndex = getAdjacentTabIndex(dockTabs, index, e.key)
    if (nextIndex === index) return
    e.preventDefault()
    setTab(dockTabs[nextIndex].key)
    dockTabRefs.current[nextIndex]?.focus()
  }

  // Structurally parallel to the guitar position selector below, but with
  // its own independent state (keysPositionIndex lives in App.jsx, not
  // here, since the "Play Chord" button outside this component needs to
  // hear whichever voicing is currently selected too) -- same three-way
  // defensive Pro-gating pattern: disabled attribute on the locked tabs,
  // an early-return in the click handler, and a clamped max index. This
  // clamp is independent of (and redundant with) App.jsx's own clamp on
  // the same raw keysPositionIndex + isPro, so a free user can never
  // actually be shown position 2/3 here even if App.jsx's clamp were ever
  // bypassed some other way.
  const maxAllowedKeysIndex = isPro ? KEYS_POSITION_LABELS.length - 1 : 0
  const activeKeysIndex = Math.min(keysPositionIndex, maxAllowedKeysIndex)

  function selectKeysPosition(idx) {
    if (idx > 0 && !isPro) return
    onKeysPositionChange(idx)
  }

  useEffect(() => {
    if (!canShowFrets && tab === 'frets') setTab('keys')
  }, [canShowFrets, tab])

  const hasPositions = Array.isArray(guitarPositions) && guitarPositions.length > 1
  // Position 1 is always free; positions 2+ are Pro-gated. Clamping here
  // (not just disabling the "next" control) means a free user can never
  // actually be shown position 2/3, even if guitarPositionIndex state
  // somehow held a stale non-zero value -- the same defense-in-depth
  // pattern already used for effectiveBassNote in App.jsx. guitarPositionIndex
  // itself (reset to 0 on a genuinely new builder chord, restored from the
  // tapped progression entry's own stored value otherwise) lives in App.jsx
  // now, not here, since Phase 2's reverse-lookup ranking needs to read it
  // too, and since progression entries are the source of truth for it.
  const maxAllowedIndex = hasPositions ? (isPro ? guitarPositions.length - 1 : 0) : 0
  const activeIndex = Math.min(guitarPositionIndex, maxAllowedIndex)
  const activeShape = hasPositions ? guitarPositions[activeIndex] : guitarShape

  function goToPrevPosition() {
    if (!isPro) return
    onGuitarPositionChange(Math.max(0, guitarPositionIndex - 1))
  }
  function goToNextPosition() {
    if (!isPro || !hasPositions) return
    onGuitarPositionChange(Math.min(guitarPositions.length - 1, guitarPositionIndex + 1))
  }

  return (
    <div className="instrument-dock">
      <div className="instrument-dock__tabs" role="tablist" aria-label="Instrument view">
        <button
          id="wt-keys-tab"
          ref={el => { dockTabRefs.current[0] = el }}
          type="button"
          role="tab"
          aria-selected={tab === 'keys'}
          tabIndex={tab === 'keys' ? 0 : -1}
          className={`instrument-dock__tab ${tab === 'keys' ? 'instrument-dock__tab--active' : ''}`}
          onClick={() => setTab('keys')}
          onKeyDown={e => handleDockTabKeyDown(e, 0)}
        >
          Keys
        </button>
        <button
          id="wt-frets-tab"
          ref={el => { dockTabRefs.current[1] = el }}
          type="button"
          role="tab"
          aria-selected={tab === 'frets'}
          tabIndex={tab === 'frets' ? 0 : -1}
          className={`instrument-dock__tab ${tab === 'frets' ? 'instrument-dock__tab--active' : ''}`}
          onClick={() => setTab('frets')}
          onKeyDown={e => handleDockTabKeyDown(e, 1)}
          disabled={!canShowFrets}
          title={
            guitarInversionUnavailable ? 'No clean guitar fingering exists for this inversion'
              : guitarSlashNotice ? 'Guitar shapes for slash chords coming soon'
                : guitarMissingNotice ? undefined
                  : (!guitarShape ? 'No guitar shape for this chord yet' : undefined)
          }
        >
          Guitar
        </button>
      </div>
      <div className="instrument-dock__view">
        {tab === 'keys' ? (
          <div className="instrument-dock__keys-view">
            <PianoDisplay chordNotes={chordNotes} previewNotes={previewNotes} bassHighlightNote={bassHighlightNote} rootNote={keysRootNote} compact />
            <div className="instrument-dock__keys-position-selector" role="tablist" aria-label="Piano voicing">
              {KEYS_POSITION_LABELS.map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={activeKeysIndex === idx}
                  className={`instrument-dock__keys-tab ${activeKeysIndex === idx ? 'instrument-dock__keys-tab--active' : ''}`}
                  onClick={() => selectKeysPosition(idx)}
                  disabled={idx > 0 && !isPro}
                >
                  {label}
                  {idx > 0 && !isPro && <span className="instrument-dock__position-badge">PRO</span>}
                </button>
              ))}
            </div>
          </div>
        ) : guitarSlashNotice ? (
          <p className="instrument-dock__guitar-notice">Guitar shapes for slash chords coming soon</p>
        ) : guitarMissingNotice ? (
          <p className="instrument-dock__guitar-notice" role="status">{guitarMissingNotice}</p>
        ) : (
          <div className="instrument-dock__guitar-view">
            <GuitarDisplay root={root} shape={activeShape} notes={chordNotes} compact />
            {hasPositions && (
              <div className="instrument-dock__position-selector">
                <button
                  type="button"
                  id="wt-position-prev"
                  className="instrument-dock__position-btn"
                  onClick={goToPrevPosition}
                  disabled={activeIndex === 0}
                  aria-label="Previous neck position"
                >
                  ‹
                </button>
                <span className="instrument-dock__position-label">
                  {activeIndex + 1}/{guitarPositions.length}
                </span>
                {!isPro && (
                  <span className="instrument-dock__position-badge">PRO</span>
                )}
                <button
                  type="button"
                  id="wt-position-next"
                  className="instrument-dock__position-btn"
                  onClick={goToNextPosition}
                  disabled={!isPro || activeIndex === guitarPositions.length - 1}
                  aria-label="Next neck position"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
