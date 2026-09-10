import { useEffect, useMemo, useState } from 'react'
import ToolShell from '../../app/ToolShell'
import { useKeysPreview } from '../../shared/audio/useKeysPreview'
import {
  CHORD_TYPES,
  ROOTS,
  SCALE_TYPES,
  getChordsInScale,
  getCompatibleScales,
  pitchesFromIntervals,
} from './compatibility'
import './ChordScaleExplorer.css'

const LESSON_ANSWERS = [
  { notes: ['C', 'E', 'G'], label: 'C · E · G', correct: true },
  { notes: ['C', 'F', 'G'], label: 'C · F · G', correct: false },
  { notes: ['D', 'F', 'A'], label: 'D · F · A', correct: false },
]

export default function ChordScaleExplorer() {
  const [view, setView] = useState('explore')
  const [direction, setDirection] = useState('chord-to-scale')
  const [root, setRoot] = useState('C')
  const [chordType, setChordType] = useState(CHORD_TYPES[0])
  const [scaleType, setScaleType] = useState(SCALE_TYPES[0])
  const [lessonAnswer, setLessonAnswer] = useState(null)
  const [resultIndex, setResultIndex] = useState(0)
  const { playSequence, playChord } = useKeysPreview()

  const lessonScale = useMemo(
    () => getCompatibleScales('C', CHORD_TYPES[0]).find(result => result.name === 'C Major'),
    [],
  )

  const results = useMemo(() => (
    direction === 'chord-to-scale'
      ? getCompatibleScales(root, chordType)
      : getChordsInScale(root, scaleType)
  ), [direction, root, chordType, scaleType])

  // A changed filter can leave resultIndex pointing past the end of the new
  // list (or just at a result that no longer matches what's selected), so
  // every fresh set of results starts back at the first one.
  useEffect(() => setResultIndex(0), [results])

  const current = results[resultIndex]

  function goToPrevResult() {
    setResultIndex(index => Math.max(0, index - 1))
  }

  function goToNextResult() {
    setResultIndex(index => Math.min(results.length - 1, index + 1))
  }

  function hear(result) {
    if (direction === 'chord-to-scale') {
      playSequence(pitchesFromIntervals(root, result.intervals), 0.3)
    } else {
      const chordRoot = result.name.match(/^[A-G](?:#|b)?/)?.[0] || root
      playChord(pitchesFromIntervals(chordRoot, result.intervals))
    }
  }

  function openExplorer() {
    setRoot('C')
    setChordType(CHORD_TYPES[0])
    setDirection('chord-to-scale')
    setView('explore')
  }

  return (
    <ToolShell
      title="Chord–Scale Explorer"
      eyebrow="Connect harmony and melody"
      learningAction={{
        label: view === 'learn' ? '← Explorer' : 'Guided learning',
        mobileLabel: view === 'learn' ? '← Explore' : 'Learn',
        ariaLabel: view === 'learn' ? 'Back to Chord–Scale Explorer' : 'Open guided learning',
        onClick: () => setView(view === 'learn' ? 'explore' : 'learn'),
      }}
    >
      <p className="chord-scales__lede">
        Learn why notes work together, then explore scales for improvising or chords for writing.
      </p>

      {view === 'learn' ? (
        <section className="chord-scales__lesson" aria-labelledby="scale-lesson-title">
          <div className="chord-scales__lesson-heading">
            <div>
              <p className="chord-scales__lesson-number">Lesson 1 · About 2 minutes</p>
              <h2 id="scale-lesson-title">Why does a scale fit a chord?</h2>
            </div>
            <span className="chord-scales__lesson-badge">C major</span>
          </div>

          <p className="chord-scales__lesson-copy">
            A scale is compatible when it contains every note in the chord. The chord gives you the stable notes;
            the remaining scale notes add movement and colour around them.
          </p>

          <div className="chord-scales__note-demo">
            <div className="chord-scales__note-demo-heading">
              <div>
                <span className="chord-scales__demo-label">C major scale</span>
                <p>Chord tones are highlighted.</p>
              </div>
              <div className="chord-scales__hear-actions">
                <button type="button" onClick={() => playChord(['C4', 'E4', 'G4'])}>Hear chord</button>
                <button type="button" onClick={() => playSequence(pitchesFromIntervals('C', lessonScale.intervals), 0.3)}>Hear scale</button>
              </div>
            </div>
            <div className="chord-scales__lesson-notes" aria-label="C major scale notes with C, E and G highlighted">
              {lessonScale.notes.map(note => (
                <span key={note} className={['C', 'E', 'G'].includes(note) ? 'chord-scales__lesson-note--chord' : ''}>
                  {note}
                </span>
              ))}
            </div>
          </div>

          <div className="chord-scales__guided-try">
            <p className="chord-scales__demo-label">Guided try</p>
            <h3>Which notes form the C major chord?</h3>
            <div className="chord-scales__answers" role="group" aria-label="Choose the notes in C major">
              {LESSON_ANSWERS.map(answer => (
                <button
                  key={answer.label}
                  type="button"
                  aria-pressed={lessonAnswer?.label === answer.label}
                  className={lessonAnswer?.label === answer.label ? 'chord-scales__answer--selected' : ''}
                  onClick={() => setLessonAnswer(answer)}
                >
                  {answer.label}
                </button>
              ))}
            </div>
            {lessonAnswer && (
              <div className={`chord-scales__lesson-feedback ${lessonAnswer.correct ? 'chord-scales__lesson-feedback--correct' : ''}`} role="status">
                <strong>{lessonAnswer.correct ? 'Exactly.' : 'Not quite.'}</strong>{' '}
                {lessonAnswer.correct
                  ? 'C, E and G are all inside the C major scale, so the scale supports the chord.'
                  : 'C major is built from C, E and G. Look for those three highlighted notes above.'}
              </div>
            )}
          </div>

          <div className="chord-scales__lesson-footer">
            <p>Next, compare every same-root scale that contains C, E and G.</p>
            <button type="button" onClick={openExplorer}>Explore C major →</button>
          </div>
        </section>
      ) : (
      <section className="chord-scales">
        <div className="chord-scales__tabs" role="tablist" aria-label="Explorer direction">
          <button
            type="button"
            role="tab"
            aria-selected={direction === 'chord-to-scale'}
            className={direction === 'chord-to-scale' ? 'chord-scales__tab--active' : ''}
            onClick={() => setDirection('chord-to-scale')}
          >
            Chord → scales
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={direction === 'scale-to-chord'}
            className={direction === 'scale-to-chord' ? 'chord-scales__tab--active' : ''}
            onClick={() => setDirection('scale-to-chord')}
          >
            Scale → chords
          </button>
        </div>

        <div className="chord-scales__picker">
          <label>
            Root
            <select value={root} onChange={event => setRoot(event.target.value)}>
              {ROOTS.map(note => <option key={note}>{note}</option>)}
            </select>
          </label>

          {direction === 'chord-to-scale' ? (
            <label>
              Chord
              <select
                value={chordType.symbol}
                onChange={event => setChordType(CHORD_TYPES.find(type => type.symbol === event.target.value))}
              >
                {CHORD_TYPES.map(type => <option key={type.label} value={type.symbol}>{type.label}</option>)}
              </select>
            </label>
          ) : (
            <label>
              Scale
              <select
                value={scaleType.name}
                onChange={event => setScaleType(SCALE_TYPES.find(type => type.name === event.target.value))}
              >
                {SCALE_TYPES.map(type => <option key={type.name} value={type.name}>{type.label}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="chord-scales__summary">
          <span>{results.length}</span>
          <p>
            {direction === 'chord-to-scale'
              ? `same-root scales containing every note in ${root}${chordType.symbol}`
              : `triads built entirely from ${root} ${scaleType.label}`}
          </p>
        </div>

        <div className="chord-scales__results">
          {current ? (
            <>
              <article className="chord-scales__result">
                <div>
                  <h2>{current.name}</h2>
                  <p className="chord-scales__notes">{current.notes.join(' · ')}</p>
                  <p className="chord-scales__why">
                    {direction === 'chord-to-scale'
                      ? `Contains ${current.sharedNotes.join(', ')}; sounds ${current.character}.`
                      : `A ${current.quality} chord using only notes from the selected scale.`}
                  </p>
                </div>
                <button type="button" onClick={() => hear(current)} aria-label={`Hear ${current.name}`}>
                  Hear
                </button>
              </article>

              {results.length > 1 && (
                <div className="chord-scales__stepper">
                  <button
                    type="button"
                    className="chord-scales__stepper-btn"
                    onClick={goToPrevResult}
                    disabled={resultIndex === 0}
                    aria-label="Previous result"
                  >
                    ‹
                  </button>
                  <span className="chord-scales__stepper-label">{resultIndex + 1} / {results.length}</span>
                  <button
                    type="button"
                    className="chord-scales__stepper-btn"
                    onClick={goToNextResult}
                    disabled={resultIndex === results.length - 1}
                    aria-label="Next result"
                  >
                    ›
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="chord-scales__empty">No matches for this combination yet.</p>
          )}
        </div>
      </section>
      )}
    </ToolShell>
  )
}
