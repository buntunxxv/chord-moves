import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import * as Tone from 'tone'
import { LABEL_COLORS, LABEL_COLORS_DARK, LABEL_EXPLANATIONS } from '../chordData'
import { createKeysSynth, startAudioContext } from '../audio/synth'
import { formatNoteNames } from '../utils/formatNotes'
import { logEvent } from '../analytics/events'
import { scrollRevealIntoView } from '../utils/scrollReveal'
import './NextChordSuggestions.css'

export default function NextChordSuggestions({ suggestions, currentNotes, bpm, previewIndex, onPreviewChange, onAddToProgression, theme, isPro }) {
  const labelColors = theme === 'dark' ? LABEL_COLORS_DARK : LABEL_COLORS
  const labelFallback = theme === 'dark' ? { bg: '#2a2a2a', text: '#bbb' } : { bg: '#f0f0f0', text: '#555' }
  const [playingIndex, setPlayingIndex] = useState(null)
  const synthRef = useRef(null)
  const detailRef = useRef(null)

  // Mounts and unmounts whenever the current chord's suggestions appear or
  // disappear (ordinary chord browsing), so free this instance's voices
  // rather than leaking a synth per cycle.
  useEffect(() => () => synthRef.current?.dispose(), [])

  // Expanding a suggestion's detail panel can push it below the visible
  // viewport (or behind the bottom progression drawer) -- scroll just
  // enough to reveal it, same shared rule every other reveal/expand control
  // in the app uses (Field Test, 12 Aug 2026).
  useEffect(() => {
    if (previewIndex != null) scrollRevealIntoView(detailRef.current)
  }, [previewIndex])

  async function handleHear(index, nextNotes) {
    onPreviewChange(index)
    if (playingIndex !== null) return
    setPlayingIndex(index)

    await startAudioContext()
    Tone.getTransport().bpm.value = bpm

    if (!synthRef.current) {
      synthRef.current = createKeysSynth()
    }
    const synth = synthRef.current
    const beatDuration = 60 / bpm // seconds per beat
    const barDuration = beatDuration * 4 // one bar = 4 beats
    const chordDuration = '1m' // one measure per chord

    const now = Tone.now()
    // Play current chord
    if (currentNotes && currentNotes.length > 0) {
      synth.triggerAttackRelease(currentNotes, chordDuration, now)
    }
    // Play next chord one bar later
    synth.triggerAttackRelease(nextNotes, chordDuration, now + barDuration)

    const totalMs = (barDuration * 2) * 1000 + 500
    setTimeout(() => setPlayingIndex(null), totalMs)
  }

  function handleCardClick(index) {
    onPreviewChange(previewIndex === index ? null : index)
  }

  if (!suggestions || suggestions.length === 0) {
    return null
  }

  const visibleSuggestions = suggestions.slice(0, isPro ? 5 : 3)
  const hasMoreForPro = !isPro && suggestions.length > visibleSuggestions.length
  const selected = previewIndex != null ? visibleSuggestions[previewIndex] : null

  return (
    <div className="next-chords" id="wt-next-chords">
      <h2 className="next-chords__title">Choose your next move</h2>
      <div className="next-chords__tabs">
        {visibleSuggestions.map((s, i) => {
          const labelStyle = labelColors[s.label] || labelFallback
          const isSelected = previewIndex === i
          return (
            <button
              key={i}
              type="button"
              className={`next-chords__tab ${isSelected ? 'next-chords__tab--selected' : ''}`}
              onClick={() => handleCardClick(i)}
              aria-pressed={isSelected}
            >
              <span className="next-chords__chord-name">{s.chord}</span>
              <span
                className="next-chords__label-badge"
                style={{ background: labelStyle.bg, color: labelStyle.text }}
              >
                {s.label}
              </span>
            </button>
          )
        })}
      </div>

      {hasMoreForPro && (
        <p className="next-chords__pro-teaser">2 more directions available in Chord Moves Pro.</p>
      )}

      {selected && (() => {
        const i = previewIndex
        const s = selected
        const explanation = LABEL_EXPLANATIONS[s.label] || ''
        const isPlaying = playingIndex === i
        const noteNames = formatNoteNames(s.notes)

        return (
          <div className="next-chords__detail" ref={detailRef}>
            <p className="next-chords__notes">{noteNames.join(' · ')}</p>

            {explanation && (
              <p className="next-chords__explanation">{explanation}</p>
            )}

            <div className="next-chords__card-actions">
              <button
                className={`next-chords__hear-btn ${isPlaying ? 'next-chords__hear-btn--playing' : ''}`}
                onClick={() => handleHear(i, s.notes)}
                disabled={playingIndex !== null}
                aria-label={`Hear movement to ${s.chord}`}
              >
                {isPlaying ? '♪ Playing…' : 'Hear →'}
              </button>
              <button
                className="next-chords__add-btn"
                onClick={() => onAddToProgression(s.chord, s.notes)}
                aria-label={`Add to progression ${s.chord}`}
              >
                + Add to progression
              </button>
            </div>
          </div>
        )
      })()}

      {!isPro && (
        <Link
          to="/upgrade"
          className="next-chords__upgrade-cta"
          onClick={() => logEvent('upgrade_cta_click', { source: 'next_chords' })}
        >
          <span className="next-chords__upgrade-lock">🔒</span>
          <span>Future Pro: unlock more chord directions</span>
        </Link>
      )}
    </div>
  )
}
