import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import './FeedbackPanel.css'

// ─── Question data ───────────────────────────────────────────────────────────

const USER_TYPES = [
  {
    value: 'beginner',
    label: 'Beginner / Student',
    description: 'I know some chords and I\'m building confidence.',
  },
  {
    value: 'intermediate',
    label: 'Intermediate Creator',
    description: 'I write music, make beats, or develop song ideas.',
  },
  {
    value: 'advanced',
    label: 'Advanced Musician',
    description: 'I\'m an experienced player, producer, teacher, or professional.',
  },
]

// Feedback Round 2 — the same 10 questions for every user type, plus one
// level-specific question at the end. The task given to testers: "Build a
// 4-chord progression, play it back, then give feedback."
const CORE_QUESTIONS = [
  {
    id: 'q1',
    type: 'choice',
    question: 'What did you think Chord Moves was helping you do?',
    options: [
      'Understand the notes in a chord',
      'Hear how a chord sounds',
      'Find a chord to play next',
      'Build a chord progression for a song',
      "I wasn't sure",
    ],
  },
  {
    id: 'q2',
    type: 'choice',
    question: 'Could you build a 4-chord progression without help?',
    options: ['Yes, easily', 'Yes, but it took some trial and error', 'No, I got stuck', "I didn't try"],
  },
  {
    id: 'q3',
    type: 'choice',
    question: 'Did the suggested chord cards help you decide what to add next?',
    options: ['Yes, a lot', 'A little', 'Not really', "I didn't notice them"],
  },
  {
    id: 'q4',
    type: 'choice',
    question: 'Did the notes shown on each suggested chord help, or was it too much information?',
    options: ['Helped me understand the chord', "Nice to have, didn't change my decision", 'Too much information', "I didn't look at them"],
  },
  {
    id: 'q5',
    type: 'choice',
    question: 'Did the song direction labels (e.g. "Familiar", "Opens out", "Moves forward") make sense?',
    options: ['Yes, immediately', 'Mostly, but not all of them', 'No, they were confusing', "I didn't notice them"],
  },
  {
    id: 'q6',
    type: 'choice',
    question: 'Did hearing the full progression help you understand the chord movement?',
    options: ['Yes, definitely', 'A little', 'Not really', "I didn't play it back"],
  },
  {
    id: 'q7',
    type: 'text',
    question: 'What confused you?',
    placeholder: 'Anything that felt unclear or unexpected…',
  },
  {
    id: 'q8',
    type: 'text',
    question: 'What would make you come back and use this again?',
    placeholder: "Be honest — what's missing?",
  },
  {
    id: 'q9',
    type: 'text',
    question: 'What did you expect Future Pro / locked Pro features to include?',
    placeholder: 'Take a guess — what did the lock icon make you think of?',
  },
  {
    id: 'q10',
    type: 'text',
    question: 'Would you pay for a deeper version of this? If yes, what feature would make it worth paying for?',
    placeholder: "Yes/no, and what would make it worth it…",
  },
]

const LEVEL_QUESTIONS = {
  beginner: {
    id: 'level',
    type: 'text',
    question: 'What helped you learn most?',
    placeholder: 'The specific thing that clicked…',
  },
  intermediate: {
    id: 'level',
    type: 'text',
    question: 'What would make this useful while writing music?',
    placeholder: 'Think about your actual workflow…',
  },
  advanced: {
    id: 'level',
    type: 'text',
    question: 'What would make this credible beyond beginner level?',
    placeholder: "Be specific — what's missing for a serious player?",
  },
}

function getQuestions(userType) {
  return userType ? [...CORE_QUESTIONS, LEVEL_QUESTIONS[userType]] : []
}

const FINAL_QUESTION = {
  id: 'notify',
  type: 'notify',
  question: 'Would you like to hear when the next version is ready?',
}

// ─── Choice component ─────────────────────────────────────────────────────────

function ChoiceInput({ value, onChange, options }) {
  return (
    <div className="fp-choice">
      {options.map(opt => (
        <button
          key={opt}
          className={`fp-choice__option ${value === opt ? 'fp-choice__option--active' : ''}`}
          onClick={() => onChange(opt)}
          type="button"
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

// ─── Notify question component ────────────────────────────────────────────────

function NotifyQuestion({ answer, onChange }) {
  const wantsNotify = answer?.wants === true
  const declinedNotify = answer?.wants === false
  return (
    <div className="fp-notify">
      <div className="fp-choice">
        {[
          { label: "Yes, I'll leave my email", yes: true },
          { label: 'No thanks', yes: false },
        ].map(({ label, yes }) => (
          <button
            key={label}
            className={`fp-choice__option ${(yes ? wantsNotify : declinedNotify) ? 'fp-choice__option--active' : ''}`}
            onClick={() => onChange(yes ? { wants: true } : { wants: false })}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {wantsNotify && (
        <div className="fp-notify__fields">
          <input
            className="fp-input"
            type="text"
            placeholder="Name"
            value={answer?.name || ''}
            onChange={e => onChange({ ...answer, name: e.target.value })}
          />
          <input
            className="fp-input"
            type="email"
            placeholder="Email"
            value={answer?.email || ''}
            onChange={e => onChange({ ...answer, email: e.target.value })}
          />
          <input
            className="fp-input"
            type="text"
            placeholder="Instrument or role"
            value={answer?.role || ''}
            onChange={e => onChange({ ...answer, role: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function FeedbackPanel({ isOpen, onClose, theme }) {
  const [stage, setStage] = useState('type') // 'type' | 'questions' | 'final' | 'done'
  const [userType, setUserType] = useState(null)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [direction, setDirection] = useState(1)
  const [animating, setAnimating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const textareaRef = useRef(null)
  // Every step transition (picking a profile card, answering a choice
  // question, footer Back/Next) delays its actual stage/questionIndex
  // update until its exit animation finishes, so the old screen stays
  // visible while it animates out. That's fine while the panel is open --
  // but this component never unmounts (see the render below), so closing
  // mid-animation used to leave that update still pending: reopening
  // moments later could land back on the stage from BEFORE the answer that
  // was just given (e.g. still 'type' even though a profile card was
  // already picked). Tracking the pending update here lets it be flushed
  // immediately the moment the panel closes, while it's invisible anyway,
  // so a reopen always reflects the settled, post-answer position.
  const pendingTransitionRef = useRef(null)

  useEffect(() => {
    return () => { if (pendingTransitionRef.current) clearTimeout(pendingTransitionRef.current.timerId) }
  }, [])

  function scheduleTransition(apply, delay) {
    if (pendingTransitionRef.current) clearTimeout(pendingTransitionRef.current.timerId)
    const timerId = setTimeout(() => {
      pendingTransitionRef.current = null
      apply()
    }, delay)
    pendingTransitionRef.current = { timerId, apply }
  }

  function flushPendingTransition() {
    if (!pendingTransitionRef.current) return
    clearTimeout(pendingTransitionRef.current.timerId)
    const { apply } = pendingTransitionRef.current
    pendingTransitionRef.current = null
    apply()
  }

  function handleClose() {
    flushPendingTransition()
    onClose?.()
  }

  const questions = getQuestions(userType)
  const isFinal = stage === 'final'
  const currentQ = isFinal ? FINAL_QUESTION : questions[questionIndex]
  const currentAnswer = currentQ ? answers[currentQ.id] : undefined

  const totalSteps = questions.length + 1 // +1 for the notify question
  const currentStep = stage === 'questions' ? questionIndex + 1 : stage === 'final' ? totalSteps : 0
  const progress = (stage === 'questions' || stage === 'final') ? currentStep / totalSteps : 0

  useEffect(() => {
    if (currentQ?.type === 'text' && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 320)
    }
  }, [questionIndex, stage, currentQ])

  function setAnswer(value) {
    setAnswers(prev => ({ ...prev, [currentQ.id]: value }))
  }

  function canAdvance() {
    if (stage === 'type') return !!userType
    if (!currentQ) return false
    if (currentQ.type === 'text') return true
    if (currentQ.type === 'notify') return true
    return currentAnswer !== undefined
  }

  function navigate(step) {
    if (animating || submitting) return
    setSubmitError(null)
    // Submitting waits for the save before moving on, so a failed insert
    // keeps the tester on this screen with their answers intact instead of
    // thanking them for feedback that never arrived.
    if (stage === 'final' && step === 1) {
      submitFeedback()
      return
    }
    setDirection(step)
    setAnimating(true)
    scheduleTransition(() => {
      if (stage === 'type' && step === 1) {
        setStage('questions')
        setQuestionIndex(0)
      } else if (stage === 'questions') {
        if (step === -1 && questionIndex === 0) {
          setStage('type')
        } else if (step === 1 && questionIndex === questions.length - 1) {
          setStage('final')
        } else {
          setQuestionIndex(i => i + step)
        }
      } else if (stage === 'final') {
        if (step === -1) {
          setStage('questions')
          setQuestionIndex(questions.length - 1)
        }
      }
      setAnimating(false)
    }, 260)
  }

  // supabase-js reports insert failures in the returned { error } rather
  // than throwing, so both paths have to be checked.
  async function submitFeedback() {
    setSubmitting(true)
    setSubmitError(null)
    let failure = null
    try {
      const { error } = await supabase.from('chord_moves_feedback').insert({
        user_type: userType,
        answers,
      })
      failure = error
    } catch (err) {
      failure = err
    }
    setSubmitting(false)
    if (failure) {
      console.error('[Chord Moves Feedback] submit failed', failure)
      setSubmitError("Your feedback didn't send. Check your connection and try again. Your answers are still here.")
      return
    }
    setDirection(1)
    setStage('done')
  }

  function startOver() {
    setSubmitError(null)
    setStage('type')
    setUserType(null)
    setQuestionIndex(0)
    setAnswers({})
  }

  return (
    <>
      <div
        className={`fp-backdrop ${isOpen ? 'fp-backdrop--open' : ''}`}
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        className={`fp-panel ${isOpen ? 'fp-panel--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Feedback questionnaire"
        inert={!isOpen}
        aria-hidden={!isOpen ? 'true' : undefined}
      >
        {/* Header */}
        <div className="fp-header">
          <div className="fp-header__brand">
            <img src={theme === 'dark' ? '/kynda-logo-white.png' : '/kynda-logo-full.png'} alt="Kynda Learning" className="fp-header__logo" />
          </div>
          <div className="fp-header__actions">
            {(stage === 'questions' || stage === 'type' || stage === 'final') && (
              <button
                className="fp-header__restart"
                onClick={startOver}
                aria-label="Start over"
                title="Clear all answers and start again"
              >
                ↺ Start over
              </button>
            )}
            <button className="fp-header__close" onClick={handleClose} aria-label="Close feedback and return to tool">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span>Back to tool</span>
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {(stage === 'questions' || stage === 'final') && (
          <div className="fp-progress">
            <div className="fp-progress__bar" style={{ width: `${progress * 100}%` }} />
          </div>
        )}

        {/* Content */}
        <div className={`fp-content fp-content--${animating ? (direction > 0 ? 'exit-left' : 'exit-right') : 'visible'}`}>

          {/* Stage: user type selection */}
          {stage === 'type' && (
            <div className="fp-screen">
              <div className="fp-screen__eyebrow">Early feedback</div>
              <h2 className="fp-screen__heading">Which best describes you?</h2>
              <p className="fp-screen__sub">
                This is an early prototype. The task: build a 4-chord progression, play it back, then tell us what you thought.
              </p>
              <p className="fp-screen__hint">Tap anywhere outside this panel anytime to pause and keep using the tool — your answers are saved.</p>
              <div className="fp-typecards">
                {USER_TYPES.map(t => (
                  <button
                    key={t.value}
                    className={`fp-typecard ${userType === t.value ? 'fp-typecard--active' : ''}`}
                    onClick={() => {
                      setUserType(t.value)
                      scheduleTransition(() => {
                        setStage('questions')
                        setQuestionIndex(0)
                      }, 320)
                    }}
                    type="button"
                  >
                    <span className="fp-typecard__label">{t.label}</span>
                    <span className="fp-typecard__desc">{t.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Stage: questions or final notify */}
          {(stage === 'questions' || stage === 'final') && currentQ && (
            <div className="fp-screen">
              <div className="fp-screen__eyebrow">
                {currentStep} of {totalSteps}
              </div>
              <h2 className="fp-screen__heading">{currentQ.question}</h2>
              {currentQ.hint && <p className="fp-screen__sub">{currentQ.hint}</p>}

              <div className="fp-answer">
                {currentQ.type === 'text' && (
                  <textarea
                    ref={textareaRef}
                    className="fp-textarea"
                    placeholder={currentQ.placeholder}
                    value={currentAnswer || ''}
                    onChange={e => setAnswer(e.target.value)}
                    rows={4}
                  />
                )}
                {currentQ.type === 'choice' && (
                  <ChoiceInput
                    value={currentAnswer}
                    onChange={v => { setAnswer(v); scheduleTransition(() => navigate(1), 320) }}
                    options={currentQ.options}
                  />
                )}
                {currentQ.type === 'notify' && (
                  <NotifyQuestion
                    answer={currentAnswer}
                    onChange={setAnswer}
                  />
                )}
              </div>
            </div>
          )}

          {/* Stage: done */}
          {stage === 'done' && (
            <div className="fp-screen fp-screen--center">
              <div className="fp-done__icon">✓</div>
              <h2 className="fp-screen__heading">Thank you.</h2>
              <p className="fp-screen__sub">
                This feedback genuinely shapes what gets built next. We appreciate you taking the time.
              </p>
              <button className="fp-btn fp-btn--primary" onClick={() => { onClose(); startOver() }}>
                Back to Chord Moves
              </button>
              <button className="fp-btn fp-btn--ghost" onClick={startOver}>
                Submit another response
              </button>
            </div>
          )}
        </div>

        {/* Footer nav */}
        {stage === 'final' && submitError && (
          <p className="fp-error" role="alert">{submitError}</p>
        )}

        {stage !== 'done' && (
          <div className="fp-footer">
            {(stage === 'questions' || stage === 'final') && (
              <button className="fp-btn fp-btn--ghost" onClick={() => navigate(-1)} type="button">
                ← Back
              </button>
            )}
            {stage === 'type' && <div />}
            <button
              className="fp-btn fp-btn--primary"
              onClick={() => navigate(1)}
              disabled={!canAdvance() || submitting}
              type="button"
            >
              {stage === 'type'
                ? 'Start →'
                : stage === 'final'
                ? (submitting ? 'Sending…' : submitError ? 'Try again' : 'Submit')
                : 'Next →'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
