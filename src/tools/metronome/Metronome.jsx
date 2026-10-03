import { useRef, useState } from 'react'
import ToolShell from '../../app/ToolShell'
import { useMetronome } from './useMetronome'
import { assessPulseTiming, calculateTapBpm } from './tapTempo'
import './Metronome.css'
import { safeStorage } from '../../utils/safeStorage'

const LESSON_BPM = 80

const SIGNATURES = [
  { label: '2/4', beats: 2, unit: 4 },
  { label: '3/4', beats: 3, unit: 4 },
  { label: '4/4', beats: 4, unit: 4 },
  { label: '6/8', beats: 6, unit: 8 },
]

function initialBpm() {
  const stored = Number(safeStorage.getItem('kyndaTools.metronome.bpm'))
  return Number.isFinite(stored) && stored >= 40 && stored <= 240 ? stored : 100
}

export default function Metronome() {
  const [view, setView] = useState('practice')
  const [bpm, setBpmState] = useState(initialBpm)
  const [signature, setSignature] = useState(SIGNATURES[2])
  const [tapCount, setTapCount] = useState(0)
  const [lessonTaps, setLessonTaps] = useState([])
  const tapsRef = useRef([])
  const activeSignature = view === 'learn' ? SIGNATURES[2] : signature
  const { isPlaying, currentBeat, stop, toggle } = useMetronome({
    bpm: view === 'learn' ? LESSON_BPM : bpm,
    beatsPerMeasure: activeSignature.beats,
    beatUnit: activeSignature.unit,
  })
  const lessonAssessment = assessPulseTiming(lessonTaps, LESSON_BPM)

  function setBpm(next) {
    const clamped = Math.max(40, Math.min(240, Math.round(Number(next))))
    setBpmState(clamped)
    safeStorage.setItem('kyndaTools.metronome.bpm', String(clamped))
  }

  function tapTempo() {
    const now = performance.now()
    const previous = tapsRef.current.at(-1)
    const taps = !previous || now - previous > 2000
      ? [now]
      : [...tapsRef.current, now].slice(-8)

    tapsRef.current = taps
    setTapCount(taps.length)
    if (taps.length < 2) return

    const tappedBpm = calculateTapBpm(taps)
    if (tappedBpm) setBpm(tappedBpm)
  }

  function changeView(nextView) {
    stop()
    setLessonTaps([])
    setView(nextView)
  }

  function tapLessonPulse() {
    const now = performance.now()
    const previous = lessonTaps.at(-1)
    const next = !previous || now - previous > 1800
      ? [now]
      : [...lessonTaps, now].slice(-8)
    setLessonTaps(next)
  }

  function openPractice() {
    stop()
    setBpm(LESSON_BPM)
    setView('practice')
  }

  const lessonFeedback = lessonAssessment && {
    steady: {
      title: 'Steady pulse.',
      text: 'Your taps are landing at an even distance from one another.',
    },
    close: {
      title: 'Nearly there.',
      text: 'Keep the movement continuous and let each click confirm the next tap.',
    },
    drifting: {
      title: 'The spacing is drifting.',
      text: 'Listen for another bar, then move before you tap rather than reacting to each click.',
    },
  }[lessonAssessment.rating]

  return (
    <ToolShell
      title="Metronome"
      eyebrow="Practise with a steady pulse"
      learningAction={{
        label: view === 'learn' ? '← Metronome' : 'Guided learning',
        mobileLabel: view === 'learn' ? '← Practice' : 'Learn',
        ariaLabel: view === 'learn' ? 'Back to metronome practice' : 'Open guided learning',
        onClick: () => changeView(view === 'learn' ? 'practice' : 'learn'),
      }}
    >
      <p className="metronome__lede">
        Learn to feel a steady pulse, then choose a tempo for focused practice.
      </p>

      {view === 'learn' ? (
        <section className="metronome-lesson" aria-labelledby="pulse-lesson-title">
          <div className="metronome-lesson__heading">
            <div>
              <p className="metronome-lesson__number">Lesson 1 · About 2 minutes</p>
              <h2 id="pulse-lesson-title">Find and hold the pulse</h2>
            </div>
            <span className="metronome-lesson__tempo">80 BPM · 4/4</span>
          </div>

          <p className="metronome-lesson__copy">
            Pulse is the evenly spaced beat underneath the music. Listen first, count
            <strong> 1 · 2 · 3 · 4</strong>, then keep that spacing in your body as you tap.
          </p>

          <ol className="metronome-lesson__steps">
            <li><span>1</span>Start the pulse and listen for one full bar.</li>
            <li><span>2</span>Count four evenly, noticing the brighter first beat.</li>
            <li><span>3</span>Tap eight times with the click.</li>
          </ol>

          <div className="metronome-lesson__trainer">
            <div className="metronome__beats" aria-label={`Lesson beat ${currentBeat >= 0 ? currentBeat + 1 : 0} of 4`}>
              {Array.from({ length: 4 }, (_, beat) => (
                <span
                  key={beat}
                  className={`metronome__beat ${currentBeat === beat ? 'metronome__beat--active' : ''} ${beat === 0 ? 'metronome__beat--downbeat' : ''}`}
                />
              ))}
            </div>

            <div className="metronome-lesson__actions">
              <button type="button" className="metronome-lesson__start" onClick={toggle}>
                {isPlaying ? '■ Stop pulse' : '▶ Start pulse'}
              </button>
              <button
                type="button"
                className="metronome-lesson__tap"
                onClick={tapLessonPulse}
                disabled={!isPlaying}
              >
                Tap with pulse
                <span>{isPlaying ? `${lessonTaps.length} of 8 taps` : 'Start the pulse first'}</span>
              </button>
            </div>

            <div className="metronome-lesson__progress" aria-label={`${lessonTaps.length} of 8 lesson taps`}>
              {Array.from({ length: 8 }, (_, index) => (
                <span key={index} className={index < lessonTaps.length ? 'metronome-lesson__progress--filled' : ''} />
              ))}
            </div>

            {lessonFeedback && (
              <div className={`metronome-lesson__feedback metronome-lesson__feedback--${lessonAssessment.rating}`} role="status">
                <div>
                  <strong>{lessonFeedback.title}</strong>
                  <p>{lessonFeedback.text}</p>
                </div>
                <button type="button" onClick={() => setLessonTaps([])}>Try again</button>
              </div>
            )}
          </div>

          <div className="metronome-lesson__footer">
            <p>When the pulse feels comfortable, keep the same tempo and practise freely.</p>
            <button type="button" onClick={openPractice}>Open practice at 80 BPM →</button>
          </div>
        </section>
      ) : (
      <section className="metronome" aria-label="Metronome controls">
        <div className="metronome__display" aria-live="polite">
          <span className="metronome__number">{bpm}</span>
          <span className="metronome__unit">BPM</span>
        </div>

        <div className="metronome__stepper">
          <button type="button" onClick={() => setBpm(bpm - 1)} aria-label="Decrease tempo">−</button>
          <input
            type="range"
            min="40"
            max="240"
            value={bpm}
            onChange={event => setBpm(event.target.value)}
            aria-label="Tempo in beats per minute"
          />
          <button type="button" onClick={() => setBpm(bpm + 1)} aria-label="Increase tempo">+</button>
        </div>

        <div className="metronome__beats" aria-label={`Beat ${currentBeat >= 0 ? currentBeat + 1 : 0} of ${signature.beats}`}>
          {Array.from({ length: signature.beats }, (_, beat) => (
            <span
              key={beat}
              className={`metronome__beat ${currentBeat === beat ? 'metronome__beat--active' : ''} ${beat === 0 ? 'metronome__beat--downbeat' : ''}`}
            />
          ))}
        </div>

        <button
          type="button"
          className={`metronome__play ${isPlaying ? 'metronome__play--active' : ''}`}
          onClick={toggle}
        >
          <span aria-hidden="true">{isPlaying ? '■' : '▶'}</span>
          {isPlaying ? 'Stop' : 'Start'}
        </button>

        <div className="metronome__section">
          <p className="metronome__section-label">Time signature</p>
          <div className="metronome__signatures" role="group" aria-label="Time signature">
            {SIGNATURES.map(option => (
              <button
                type="button"
                key={option.label}
                className={signature.label === option.label ? 'metronome__signature--active' : ''}
                aria-pressed={signature.label === option.label}
                onClick={() => setSignature(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="metronome__tap-panel">
          <div>
            <h2>Find your tempo</h2>
            <p>Tap at least twice. A pause resets the count.</p>
          </div>
          <button type="button" className="metronome__tap" onClick={tapTempo}>
            Tap tempo
            <span>{tapCount > 1 ? `${tapCount} taps` : 'Tap to begin'}</span>
          </button>
        </div>
      </section>
      )}
    </ToolShell>
  )
}
