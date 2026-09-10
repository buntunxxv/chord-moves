import { useState } from 'react'
import { Note } from 'tonal'
import ToolShell from '../../app/ToolShell'
import { useKeysPreview } from '../../shared/audio/useKeysPreview'
import IntervalKeyboard from './IntervalKeyboard'
import './EarTrainer.css'

const INTERVALS = [
  { interval: '2m', label: 'Minor 2nd', hint: 'One semitone' },
  { interval: '2M', label: 'Major 2nd', hint: 'Two semitones' },
  { interval: '3m', label: 'Minor 3rd', hint: 'Three semitones' },
  { interval: '3M', label: 'Major 3rd', hint: 'Four semitones' },
  { interval: '4P', label: 'Perfect 4th', hint: 'Five semitones' },
  { interval: '5P', label: 'Perfect 5th', hint: 'Seven semitones' },
  { interval: '6M', label: 'Major 6th', hint: 'Nine semitones' },
  { interval: '8P', label: 'Octave', hint: 'Twelve semitones' },
]

const ROOTS = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4']

function makeQuestion() {
  const answer = INTERVALS[Math.floor(Math.random() * INTERVALS.length)]
  const root = ROOTS[Math.floor(Math.random() * ROOTS.length)]
  const upper = Note.transpose(root, answer.interval)
  const descending = Math.random() < 0.5

  return {
    answer,
    direction: descending ? 'descending' : 'ascending',
    notes: descending ? [upper, root] : [root, upper],
  }
}

export default function EarTrainer() {
  const [question, setQuestion] = useState(null)
  const [selected, setSelected] = useState(null)
  const [score, setScore] = useState({ correct: 0, answered: 0 })
  const { playSequence } = useKeysPreview()

  async function nextQuestion() {
    const next = makeQuestion()
    setQuestion(next)
    setSelected(null)
    await playSequence(next.notes)
  }

  function answer(option) {
    if (!question || selected) return
    setSelected(option.interval)
    setScore(previous => ({
      correct: previous.correct + (option.interval === question.answer.interval ? 1 : 0),
      answered: previous.answered + 1,
    }))
  }

  const isCorrect = selected && selected === question?.answer.interval

  return (
    <ToolShell title="Interval Ear Trainer" eyebrow="Listen, choose, learn">
      <p className="ear-trainer__lede">
        Hear two notes and identify the distance between them. Each round mixes ascending and descending intervals.
      </p>

      <section className="ear-trainer">
        <div className="ear-trainer__status">
          <span>{score.answered ? `${score.correct} / ${score.answered} correct` : 'Ready when you are'}</span>
          {question && <span>{question.direction}</span>}
        </div>

        <div className="ear-trainer__prompt">
          <span className={`ear-trainer__sound-icon ${question && !selected ? 'ear-trainer__sound-icon--live' : ''}`} aria-hidden="true">♪</span>
          <h2>{question ? 'Which interval did you hear?' : 'Start a listening round'}</h2>
          <p>{question ? 'Replay the notes as often as you need.' : 'Your first pair of notes will play when you begin.'}</p>
          <div className="ear-trainer__prompt-actions">
            {question && (
              <button type="button" className="ear-trainer__secondary" onClick={() => playSequence(question.notes)}>
                Replay
              </button>
            )}
            <button type="button" className="ear-trainer__primary" onClick={nextQuestion}>
              {question ? 'New sound' : 'Begin'}
            </button>
          </div>
        </div>

        <div className="ear-trainer__answers" role="group" aria-label="Interval choices">
          {INTERVALS.map(option => {
            const showCorrect = selected && option.interval === question?.answer.interval
            const showIncorrect = selected === option.interval && !showCorrect
            return (
              <button
                type="button"
                key={option.interval}
                disabled={!question || Boolean(selected)}
                className={`${showCorrect ? 'ear-trainer__answer--correct' : ''} ${showIncorrect ? 'ear-trainer__answer--incorrect' : ''}`}
                onClick={() => answer(option)}
              >
                <strong>{option.label}</strong>
                <span>{option.hint}</span>
              </button>
            )
          })}
        </div>

        {selected && (
          <div className={`ear-trainer__feedback ${isCorrect ? 'ear-trainer__feedback--correct' : ''}`} role="status">
            <div className="ear-trainer__feedback-text">
              <strong>{isCorrect ? 'That’s it.' : `That was a ${question.answer.label}.`}</strong>
              <span>{question.notes.join(' → ')} · {question.answer.hint.toLowerCase()}</span>
            </div>
            <IntervalKeyboard notes={question.notes} />
          </div>
        )}
      </section>
    </ToolShell>
  )
}
