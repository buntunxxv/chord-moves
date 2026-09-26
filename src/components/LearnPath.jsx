import { useState, useRef, useEffect } from 'react'
import * as Tone from 'tone'
import { createKeysSynth, startAudioContext } from '../audio/synth'
import { LEARN_ROOTS, LEARN_CHORD_SUBSET, LEARN_CHALLENGES, resolveChallengeChord } from '../learnData'
import {
  didPassLearnChallenge,
  learnCompletionId,
  markLearnChallengeComplete,
  readLearnCompletions,
} from '../utils/learnProgress'
import './LearnPath.css'

const PREDICT_HOLD_SECONDS = 1.2
const PATTERN_STEP_SECONDS = 1.3

// A dominant7 step displays as e.g. "V7", not the bare degree "V" --
// showing the bare numeral while only offering dominant-7th chords in the
// picker would be its own version of the family-mismatch bug this file was
// built to avoid (see LEARN_CHALLENGES in learnData.js).
function formatNumeral(step) {
  return step.dominant7 ? `${step.numeral}7` : step.numeral
}

export default function LearnPath({ onBackToBuild }) {
  const [selectedKey, setSelectedKey] = useState('C')
  // The challenge currently in progress, or null when browsing the list --
  // no persistence by design, so this (and every other piece of in-progress
  // state below) simply resets to null/empty whenever a challenge starts.
  const [activeChallenge, setActiveChallenge] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  // One entry per step once guessed: { picked, actual, correct }. A step's
  // guess is final once made -- predict-before-hear only means something if
  // the pick happens before the reveal, so re-guessing the same step isn't
  // offered.
  const [guesses, setGuesses] = useState([])
  const [revealed, setRevealed] = useState(false)
  const [playingSequence, setPlayingSequence] = useState(false)
  // Completion is local-only and per key: completing I-IV-V-I in C does
  // not mark the same pattern complete in G. A Set keeps list lookups cheap
  // while the helper owns JSON persistence and malformed-data recovery.
  const [completedChallenges, setCompletedChallenges] = useState(() => readLearnCompletions(localStorage))
  const synthRef = useRef(null)

  function ensureSynth() {
    if (!synthRef.current) synthRef.current = createKeysSynth()
    return synthRef.current
  }

  // Mounts and unmounts on every switch to/from the Learn tab, so free this
  // instance's voices rather than leaking a synth per switch.
  useEffect(() => () => synthRef.current?.dispose(), [])

  async function playChord(notes) {
    if (!notes || notes.length === 0) return
    await startAudioContext()
    ensureSynth().triggerAttackRelease(notes, PREDICT_HOLD_SECONDS)
  }

  function startChallenge(challenge) {
    setActiveChallenge(challenge)
    setStepIndex(0)
    setGuesses([])
    setRevealed(false)
  }

  function backToList() {
    setActiveChallenge(null)
    setStepIndex(0)
    setGuesses([])
    setRevealed(false)
  }

  function repeatChallenge() {
    setStepIndex(0)
    setGuesses([])
    setRevealed(false)
  }

  const resolvedChords = activeChallenge
    ? activeChallenge.romanNumerals.map(step => resolveChallengeChord(step, selectedKey))
    : []

  const currentStep = activeChallenge ? activeChallenge.romanNumerals[stepIndex] : null
  // Never mix triads and dominant 7ths in one step's picker -- a plain step
  // only offers the triads (major/minor), a dominant7 step only offers the
  // dominant 7ths, regardless of how many roots LEARN_CHORD_SUBSET covers.
  const pickerOptions = currentStep
    ? LEARN_CHORD_SUBSET.filter(c => (currentStep.dominant7 ? c.extension === '7' : c.extension === 'none'))
    : []

  // The learner's pick plays -- and gets compared against -- whatever they
  // actually selected, never the "correct" answer, even when the two
  // differ. Feedback only; nothing here blocks reaching the next step.
  function handlePick(chord) {
    if (guesses[stepIndex]) return
    playChord(chord.notes)
    const actual = resolvedChords[stepIndex]
    const correct = !!actual && actual.symbol === chord.symbol
    setGuesses(prev => {
      const next = [...prev]
      next[stepIndex] = { picked: chord, actual, correct }
      return next
    })
  }

  function goNext() {
    if (stepIndex + 1 < activeChallenge.romanNumerals.length) {
      setStepIndex(i => i + 1)
    } else {
      setRevealed(true)
      if (didPassLearnChallenge(guesses, activeChallenge.romanNumerals.length)) {
        setCompletedChallenges(previous => (
          markLearnChallengeComplete(localStorage, previous, selectedKey, activeChallenge.id)
        ))
      }
    }
  }

  async function playFullPattern() {
    if (playingSequence) return
    const chords = resolvedChords.filter(c => c && c.notes && c.notes.length > 0)
    if (chords.length === 0) return
    setPlayingSequence(true)
    await startAudioContext()
    const synth = ensureSynth()
    const now = Tone.now()
    chords.forEach((c, i) => {
      synth.triggerAttackRelease(c.notes, PATTERN_STEP_SECONDS, now + i * PATTERN_STEP_SECONDS)
    })
    const totalMs = chords.length * PATTERN_STEP_SECONDS * 1000 + 300
    setTimeout(() => setPlayingSequence(false), totalMs)
  }

  const currentGuess = guesses[stepIndex]
  const challengePassed = activeChallenge
    ? didPassLearnChallenge(guesses, activeChallenge.romanNumerals.length)
    : false

  return (
    <div className="learn-path">
      <div className="learn-path__inner">
        <div className="learn-path__topbar">
          <button type="button" className="learn-path__back-btn" onClick={onBackToBuild}>
            Back to Build
          </button>
        </div>

        {!activeChallenge ? (
          <>
            <section className="learn-path__section">
              <h2 className="learn-path__section-title">Choose a key</h2>
              <div id="wt-learn-key-picker" className="learn-path__key-row" role="group" aria-label="Starting key">
                {LEARN_ROOTS.map(root => (
                  <button
                    key={root}
                    type="button"
                    className={`learn-path__key-btn ${selectedKey === root ? 'learn-path__key-btn--active' : ''}`}
                    onClick={() => setSelectedKey(root)}
                    aria-pressed={selectedKey === root}
                  >
                    {root}
                  </button>
                ))}
              </div>
            </section>

            <section className="learn-path__section">
              <h2 className="learn-path__section-title">Challenges</h2>
              <ul id="wt-learn-challenge-list" className="learn-path__challenge-list">
                {LEARN_CHALLENGES.map(challenge => {
                  const isCompleted = completedChallenges.has(learnCompletionId(selectedKey, challenge.id))
                  return (
                    <li key={challenge.id} className={`learn-path__challenge-card ${isCompleted ? 'learn-path__challenge-card--completed' : ''}`}>
                      <div className="learn-path__challenge-info">
                        <span className="learn-path__challenge-label">{challenge.label}</span>
                        {isCompleted && (
                          <span className="learn-path__completed" aria-label={`Completed in ${selectedKey} major`}>
                            <span aria-hidden="true">✓</span> Completed in {selectedKey}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="learn-path__start-btn"
                        onClick={() => startChallenge(challenge)}
                      >
                        Start
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          </>
        ) : (
          <section className="learn-path__section learn-path__challenge-view">
            <div className="learn-path__challenge-header">
              <div>
                <h2 className="learn-path__challenge-title">{activeChallenge.label}</h2>
                <span className="learn-path__key-note">Key of {selectedKey} major</span>
              </div>
              <button type="button" className="learn-path__exit-btn" onClick={backToList}>
                ← Challenges
              </button>
            </div>

            <div className="learn-path__pattern-strip">
              {activeChallenge.romanNumerals.map((step, i) => {
                const g = guesses[i]
                const isActive = i === stepIndex && !revealed
                const cls = [
                  'learn-path__numeral',
                  isActive ? 'learn-path__numeral--active' : '',
                  g ? (g.correct ? 'learn-path__numeral--correct' : 'learn-path__numeral--guessed') : '',
                ].filter(Boolean).join(' ')
                return (
                  <span key={i} className={cls}>
                    {formatNumeral(step)}
                  </span>
                )
              })}
            </div>

            {!revealed ? (
              <>
                <p className="learn-path__prompt">
                  What's the next chord — step {stepIndex + 1} of {activeChallenge.romanNumerals.length}?
                </p>

                <div id="wt-learn-step-picker" className="learn-path__chord-grid" role="group" aria-label="Pick the next chord">
                  {pickerOptions.map(chord => (
                    <button
                      key={chord.symbol}
                      type="button"
                      className={`learn-path__chord-btn ${currentGuess?.picked.symbol === chord.symbol ? 'learn-path__chord-btn--picked' : ''}`}
                      onClick={() => handlePick(chord)}
                      disabled={!!currentGuess}
                    >
                      {chord.symbol}
                    </button>
                  ))}
                </div>

                {currentGuess && (
                  <div className={`learn-path__feedback ${currentGuess.correct ? 'learn-path__feedback--correct' : 'learn-path__feedback--miss'}`} role="status">
                    <p>
                      You picked <strong>{currentGuess.picked.symbol}</strong>
                      {currentGuess.correct
                        ? ' — matches the pattern!'
                        : ` — the pattern's next chord is ${currentGuess.actual?.symbol ?? '—'}`}
                    </p>
                    <button type="button" className="learn-path__next-btn" onClick={goNext}>
                      {stepIndex + 1 < activeChallenge.romanNumerals.length ? 'Next chord →' : 'See full pattern →'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="learn-path__reveal">
                <p className="learn-path__prompt">Here's the full pattern:</p>
                <ol className="learn-path__reveal-list">
                  {activeChallenge.romanNumerals.map((step, i) => (
                    <li key={i} className="learn-path__reveal-item">
                      <span className="learn-path__reveal-numeral">{formatNumeral(step)}</span>
                      <span className="learn-path__reveal-chord">{resolvedChords[i]?.symbol ?? '—'}</span>
                    </li>
                  ))}
                </ol>
                <div className={`learn-path__completion-result ${challengePassed ? 'learn-path__completion-result--passed' : 'learn-path__completion-result--retry'}`} role="status">
                  <strong>{challengePassed ? '✓ Challenge complete' : 'Not complete yet'}</strong>
                  <p>
                    {challengePassed
                      ? `You identified every chord correctly in ${selectedKey} major.`
                      : 'One or more chords were missed. Repeat the challenge and identify every step correctly to complete it.'}
                  </p>
                </div>
                <div className="learn-path__why">
                  <h3>Why this works</h3>
                  <p>{activeChallenge.why}</p>
                </div>
                <div className="learn-path__reveal-actions">
                  <button
                    type="button"
                    className={`learn-path__play-btn ${playingSequence ? 'learn-path__play-btn--playing' : ''}`}
                    onClick={playFullPattern}
                    disabled={playingSequence}
                  >
                    {playingSequence ? '♪ Playing…' : '▶ Play pattern'}
                  </button>
                  <button
                    type="button"
                    className="learn-path__repeat-btn"
                    onClick={repeatChallenge}
                    disabled={playingSequence}
                  >
                    ↻ Repeat
                  </button>
                  <button type="button" className="learn-path__exit-btn" onClick={backToList}>
                    Back to challenges
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
