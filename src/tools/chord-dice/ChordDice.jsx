import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ToolShell from '../../app/ToolShell'
import { DIE_NAMES, LEVEL_CHOICES, LEVEL_KEYS, changeOneDie, displayNote, feedbackStyle, resolveChord, rollChord } from './faces'
import { compare, finishReflection, keyLabel, keySpoken, nextPrompt, placementFeedback, spelledNotes, submitFeedback } from './answer'
import { createChordAudio, selectionVoicing, targetVoicing } from './audio'
import { KEYS, REASON_MAX, STARTS, makeKept, readKept, readString, write, writeKept } from './storage'
import './ChordDice.css'

// One octave of keys, C to B. Only the note name counts, so one octave is
// every answer there is.
const WHITE = [0, 2, 4, 5, 7, 9, 11]
const BLACK = [{ chroma: 1, after: 0 }, { chroma: 3, after: 1 }, { chroma: 6, after: 3 }, { chroma: 8, after: 4 }, { chroma: 10, after: 5 }]
const START_LABELS = { name: 'From name', sound: 'From sound' }
const KEPT_ROW = 60 // px per kept row, gap included

const times = n => (n === 1 ? '1 replay' : `${n} replays`)
const DIE_FACE = { major: 'major', minor: 'minor', dim: 'dim', aug: 'aug', sus: 'sus' }

// A die. Once a chord is built or revealed, each die becomes a button:
// tap it to change that one die and keep the other two.
function Die({ label, face, hidden, rolling, onChange }) {
  const spoken = hidden ? `${label} die: hidden until you finish` : face ? `${label} die: ${face}` : `${label} die: not rolled yet`
  const className = `cd-die${rolling ? ' cd-die--rolling' : ''}${hidden ? ' cd-die--hidden' : ''}${face === 'none' ? ' cd-die--none' : ''}${onChange ? ' cd-die--button' : ''}`
  const faceEl = <span className="cd-die__face" aria-hidden="true">{hidden ? '?' : face ?? '–'}</span>
  return (
    <div className="cd-slot">
      {onChange
        ? <button type="button" className={className} onClick={onChange} aria-label={`Change the ${label} die. Now ${face}.`}>{faceEl}</button>
        : <span className={className} role="img" aria-label={spoken}>{faceEl}</span>}
      <span className="cd-slot__label" aria-hidden="true">{label}</span>
    </div>
  )
}

function Piano({ selected, onToggle, disabled }) {
  const isOn = c => selected.includes(c)
  const key = (c, black, style) => (
    <button key={c} type="button" style={style}
      className={`cd-key ${black ? 'cd-key--black' : 'cd-key--white'}${isOn(c) ? ' is-on' : ''}`}
      aria-pressed={isOn(c)} aria-label={keySpoken(c)} data-chroma={c}
      onClick={() => onToggle(c)} disabled={disabled}>
      <span className="cd-key__label" aria-hidden="true">
        {black ? keyLabel(c).split('/').map(n => <span key={n}>{n}</span>) : keyLabel(c)}
      </span>
    </button>
  )
  return (
    <div className="cd-piano" role="group" aria-label="Piano, one octave. Tap a key to add or remove a note.">
      {WHITE.map(c => key(c, false))}
      {BLACK.map(({ chroma, after }) => key(chroma, true, { '--cd-after': after + 1 }))}
    </div>
  )
}

export default function ChordDice() {
  const audioRef = useRef(null)
  if (!audioRef.current) audioRef.current = createChordAudio()
  const audio = audioRef.current
  useEffect(() => () => audio.dispose(), [audio])

  const [levelKey, setLevelKey] = useState(() => readString(KEYS.level, 'L1', LEVEL_KEYS))
  const [start, setStart] = useState(() => readString(KEYS.start, 'name', STARTS))
  // The chord on the table and how this round started.
  //   { chord, outcome, start, levelKey, feedback: 'note'|'submit', changedFrom: { die, chord }|null }
  const [round, setRound] = useState(null)
  // Levels 3 and Mix: what the last Submit said ({ extra, missing }).
  const [submitted, setSubmitted] = useState(null)
  const [selected, setSelected] = useState([])
  const [feedback, setFeedback] = useState('')
  const [replays, setReplays] = useState(0)
  const [status, setStatus] = useState('building') // building | done | revealed
  const [stage, setStage] = useState('build') // build | result | keep
  const [rolling, setRolling] = useState([]) // which dice are tumbling
  const [kept, setKept] = useState(readKept)
  const [keptThis, setKeptThis] = useState(false)
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState('')
  const [keptPage, setKeptPage] = useState(0)
  const [keptPerPage, setKeptPerPage] = useState(3)
  const keptListRef = useRef(null)

  const chord = round?.chord ?? null
  const finished = status !== 'building'
  // From sound, nothing on the page may give the chord away until it is
  // built or revealed: not the dice, not the name, not the notes.
  const concealed = Boolean(chord) && round.start === 'sound' && !finished
  // After Change one die, the two dice that stayed are already known; only
  // the changed one is hidden.
  const hiddenDie = die => concealed && (!round.changedFrom || round.changedFrom.die === die)
  const submitMode = round?.feedback === 'submit'

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(''), notice.length > 60 ? 5000 : 2600)
    return () => window.clearTimeout(id)
  }, [notice])

  // Kept chords page instead of scrolling: as many rows as the list has room for.
  useLayoutEffect(() => {
    const el = keptListRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setKeptPerPage(Math.max(1, Math.floor((el.clientHeight + 8) / KEPT_ROW))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [stage])

  // A new round: from a roll, or from changing one die of the last chord.
  const startRound = useCallback((outcome, { changedFrom = null, dice = ['root', 'quality', 'colour'] } = {}) => {
    const next = resolveChord(outcome)
    setRound({ chord: next, outcome, start, levelKey: outcome.levelKey, feedback: feedbackStyle(outcome.levelKey), changedFrom })
    setSubmitted(null)
    setNotice('')
    setSelected([])
    setReplays(0)
    setStatus('building')
    setStage('build')
    setKeptThis(false)
    setReason('')
    setFeedback('')
    setRolling(dice)
    window.setTimeout(() => setRolling([]), 460)
    // From sound, the chord plays from the tap itself (which also unlocks
    // audio on iOS).
    if (start === 'sound') audio.playChord(targetVoicing(next), 'target')
  }, [audio, start])

  const roll = () => startRound(rollChord(levelKey, { avoid: chord }))

  // Change one die: the other two stay. When nothing else fits, say which
  // die to change first.
  const changeDie = die => {
    if (!chord || !finished) return
    const res = changeOneDie(round.outcome, die, round.levelKey)
    if (res.blocked) { setNotice(res.blocked); return }
    startRound(res.outcome, { changedFrom: { die, chord }, dice: [die] })
  }

  const replay = () => {
    if (!chord) return
    if (round.start === 'sound' && !finished) setReplays(n => n + 1)
    audio.playChord(targetVoicing(chord), 'target')
  }

  const finish = useCallback(how => {
    setStatus(how)
    setStage('result')
  }, [])

  const toggleKey = chroma => {
    if (!chord) return
    const adding = !selected.includes(chroma)
    const next = adding ? [...selected, chroma] : selected.filter(c => c !== chroma)
    setSelected(next)
    if (adding) audio.playNote(60 + chroma)
    // From Level 3 the keyboard is neutral until Submit: no words, no
    // finishing by itself.
    if (finished || round.feedback === 'submit') return
    if (adding) setFeedback(placementFeedback(chord, chroma, next, round.start))
    else setFeedback(`You took away ${keyLabel(chroma)}.`)
    if (compare(chord, next).complete) finish('done')
  }

  const submit = () => {
    if (!chord || finished || !selected.length) return
    const res = submitFeedback(chord, selected, round.start)
    if (res.complete) finish('done')
    else setSubmitted(res)
  }

  const reveal = () => {
    if (!chord || finished) return
    finish('revealed')
  }

  const chooseLevel = key => {
    setLevelKey(key)
    write(KEYS.level, key)
    if (chord && !finished) setNotice('The new level applies to your next roll.')
  }

  const chooseStart = key => {
    setStart(key)
    write(KEYS.start, key)
    if (chord && !finished && key !== round.start) setNotice(`${START_LABELS[key]} applies to your next roll.`)
  }

  const keep = () => {
    if (!chord || !finished || keptThis || !reason.trim()) return
    const changedFrom = round.changedFrom ? { die: round.changedFrom.die, symbol: round.changedFrom.chord.symbol } : null
    const item = makeKept(chord, { start: round.start, replays, revealed: status === 'revealed', reason, levelKey: round.levelKey, changedFrom })
    const list = [item, ...kept]
    setKept(list)
    writeKept(list)
    setKeptThis(true)
    setReason('')
    setKeptPage(0)
    setNotice(`Kept ${chord.name}.`)
  }

  const removeKept = id => {
    const list = kept.filter(k => k.id !== id)
    setKept(list)
    writeKept(list)
  }

  const keptPages = Math.max(1, Math.ceil(kept.length / keptPerPage))
  const page = Math.min(keptPage, keptPages - 1)
  const keptShown = kept.slice(page * keptPerPage, (page + 1) * keptPerPage)

  const prompt = useMemo(() => {
    if (!chord) return 'Choose a start, then roll the dice.'
    if (finished) return null
    if (round.feedback === 'submit') {
      // The same words whatever is on the keyboard: nothing here may hint
      // at whether the notes are right before Submit.
      if (submitted) return null
      if (round.start === 'sound') {
        return round.changedFrom
          ? `You changed the ${DIE_NAMES[round.changedFrom.die]}. Listen, then build the new chord. Submit when you’re ready.`
          : 'Listen, then build what you hear. Submit when you’re ready.'
      }
      return `Build ${chord.name}. Choose all its notes, then Submit.`
    }
    const next = nextPrompt(chord, selected, round.start)
    if (selected.length === 0) {
      return round.start === 'sound' ? `Listen, then build what you hear. ${next}` : `Build ${chord.name}. ${next}`
    }
    return next
  }, [chord, finished, round, selected, submitted])

  const stages = [
    { key: 'build', label: 'Build' },
    { key: 'result', label: 'Result', disabled: !finished },
    // Kept chords stay out of sight while a chord is being found by ear.
    { key: 'keep', label: 'Keep', disabled: concealed },
  ]
  const startedFrom = round?.start === 'sound' ? 'From the sound' : 'From the name'

  return (
    <ToolShell>
      <div className="chord-dice">
        <header className="cd-head">
          <div className="cd-head__copy">
            <p className="cd-head__eyebrow">Chord Dice</p>
            <h1 className="cd-head__title">Roll, build and keep a chord</h1>
          </div>
          <div className="cd-seg cd-head__levels" role="radiogroup" aria-label="Dice level">
            {LEVEL_CHOICES.map(c => (
              <button key={c.key} type="button" role="radio" aria-checked={levelKey === c.key} aria-label={c.name}
                className={levelKey === c.key ? 'is-on' : ''} onClick={() => chooseLevel(c.key)}>
                {c.key !== 'mix' && <span className="cd-long" aria-hidden="true">Level </span>}{c.label}
              </button>
            ))}
          </div>
        </header>

        <section className="cd-tray" aria-label="Dice">
          <Die label="Root" face={chord ? displayNote(chord.root) : null} hidden={hiddenDie('root')} rolling={rolling.includes('root')}
            onChange={finished ? () => changeDie('root') : null} />
          <Die label="Quality" face={chord ? DIE_FACE[chord.quality] : null} hidden={hiddenDie('quality')} rolling={rolling.includes('quality')}
            onChange={finished ? () => changeDie('quality') : null} />
          {/* Levels 1–2 have no colour: the die is on the table and reads
              "none", so the tray looks the same at every level. */}
          <Die label="Colour" face={chord ? chord.colour : null} hidden={hiddenDie('colour')} rolling={rolling.includes('colour')}
            onChange={finished ? () => changeDie('colour') : null} />
        </section>

        <section className="cd-controls" aria-label="Start and roll">
          <div className="cd-seg" role="radiogroup" aria-label="Start from">
            {STARTS.map(s => (
              <button key={s} type="button" role="radio" aria-checked={start === s} aria-label={START_LABELS[s]}
                className={start === s ? 'is-on' : ''} onClick={() => chooseStart(s)}>
                <span className="cd-long" aria-hidden="true">{START_LABELS[s]}</span>
                <span className="cd-short" aria-hidden="true">{s === 'name' ? 'Name' : 'Sound'}</span>
              </button>
            ))}
          </div>
          <div className="cd-actions">
            <button type="button" className="cd-btn cd-btn--primary cd-roll" onClick={roll}>
              Roll{chord && <span className="cd-long"> again</span>}
            </button>
            <button type="button" className="cd-btn cd-btn--quiet cd-replay" onClick={replay}
              disabled={!chord || (round.start === 'name' && !finished)}
              aria-label={round?.start === 'sound' ? `Play the chord again. ${times(replays)} so far` : 'Play chord'}>
              {round?.start === 'sound'
                ? <><span className="cd-long" aria-hidden="true">Play again</span><span className="cd-short" aria-hidden="true">Replay</span><span className="cd-count" aria-hidden="true">{replays}</span></>
                : <><span className="cd-long" aria-hidden="true">Play chord</span><span className="cd-short" aria-hidden="true">Play</span></>}
            </button>
          </div>
        </section>

        <section className="cd-stage" aria-label="Build, result and keep">
          <div className="cd-stage__tabs" role="tablist" aria-label="Show">
            {stages.map(t => (
              <button key={t.key} type="button" role="tab" id={`cd-tab-${t.key}`} aria-controls={`cd-panel-${t.key}`}
                aria-selected={stage === t.key} className={stage === t.key ? 'is-on' : ''}
                disabled={t.disabled} onClick={() => setStage(t.key)}>
                {t.label}
              </button>
            ))}
            {stage === 'keep' && keptPages > 1 && (
              <div className="cd-pager">
                <button type="button" className="cd-btn cd-btn--small" onClick={() => setKeptPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Newer kept chords">←</button>
                <span>{page + 1} / {keptPages}</span>
                <button type="button" className="cd-btn cd-btn--small" onClick={() => setKeptPage(Math.min(keptPages - 1, page + 1))} disabled={page >= keptPages - 1} aria-label="Older kept chords">→</button>
              </div>
            )}
          </div>

          {stage === 'build' && (
            <div className="cd-stage__panel cd-build" role="tabpanel" id="cd-panel-build" aria-labelledby="cd-tab-build">
              <div className="cd-feedback" role="status">
                {!submitMode && feedback && <p className="cd-feedback__line">{feedback}</p>}
                {submitMode && submitted && !finished && (
                  <>
                    <p className="cd-feedback__label">Your last Submit</p>
                    {submitted.extra && <p className="cd-feedback__line">{submitted.extra}</p>}
                    {submitted.missing && <p className="cd-feedback__line">{submitted.missing}</p>}
                  </>
                )}
                {prompt && <p className="cd-feedback__prompt">{prompt}</p>}
                {finished && <p className="cd-feedback__prompt">{status === 'revealed' ? 'Revealed.' : 'Built.'} See Result.</p>}
              </div>
              <Piano selected={selected} onToggle={toggleKey} disabled={!chord} />
              <div className="cd-build__actions">
                <button type="button" className="cd-btn cd-btn--quiet" disabled={!selected.length} aria-label="Hear my chord"
                  onClick={() => audio.playChord(selectionVoicing(selected), 'selection')}>
                  <span className="cd-long" aria-hidden="true">Hear my chord</span><span className="cd-short" aria-hidden="true">Hear</span>
                </button>
                <button type="button" className="cd-btn cd-btn--ghost" disabled={!selected.length || finished}
                  onClick={() => { setSelected([]); if (!submitMode) setFeedback('You cleared the keyboard.') }}>Clear</button>
                {submitMode && (
                  <button type="button" className="cd-btn cd-btn--submit" disabled={!selected.length || finished} onClick={submit}>Submit</button>
                )}
                <button type="button" className="cd-btn cd-btn--ghost cd-reveal" disabled={!chord || finished} onClick={reveal}>Reveal</button>
              </div>
            </div>
          )}

          {stage === 'result' && finished && (
            <div className="cd-stage__panel cd-result" role="tabpanel" id="cd-panel-result" aria-labelledby="cd-tab-result">
              <div className="cd-result__answer">
                <p className="cd-result__name">{chord.name}</p>
                <p className="cd-result__notes">{spelledNotes(chord)}</p>
              </div>
              <p className="cd-result__meta">
                <span>{startedFrom}</span>
                {round.start === 'sound' && <span>{times(replays)}</span>}
                {status === 'revealed' && <span className="cd-flag">Revealed</span>}
                {round.changedFrom && <span>Changed {DIE_NAMES[round.changedFrom.die]} from {round.changedFrom.chord.name}</span>}
              </p>
              <p className="cd-result__reflection">{finishReflection(chord, { start: round.start, replays, revealed: status === 'revealed', changedFrom: round.changedFrom })}</p>
              <p className="cd-result__hint">Change one die: tap Root, Quality or Colour above. The other two stay.</p>
              <div className="cd-result__actions">
                <button type="button" className="cd-btn cd-btn--quiet" onClick={() => audio.playChord(targetVoicing(chord), 'target')}>Hear it</button>
                <button type="button" className="cd-btn cd-btn--keep" onClick={() => setStage('keep')} disabled={keptThis}>
                  {keptThis ? 'Kept' : 'Keep this chord'}
                </button>
              </div>
            </div>
          )}

          {stage === 'keep' && (
            <div className="cd-stage__panel cd-keep" role="tabpanel" id="cd-panel-keep" aria-labelledby="cd-tab-keep">
              {finished && !keptThis ? (
                <form className="cd-keep__row" onSubmit={e => { e.preventDefault(); keep() }}>
                  <label htmlFor="cd-reason" className="cd-visually-hidden">Why I’m keeping {chord.name}</label>
                  <span className="cd-keep__chord" aria-hidden="true">{chord.name}</span>
                  <input id="cd-reason" type="text" required maxLength={REASON_MAX} value={reason} autoComplete="off"
                    onChange={e => setReason(e.target.value)} placeholder="Why I’m keeping it (required)" />
                  <button type="submit" className="cd-btn cd-btn--keep" disabled={!reason.trim()}>Keep</button>
                </form>
              ) : (
                <p className="cd-keep__hint">
                  {keptThis ? `${chord.name} is kept. Roll again for the next chord.` : 'Build or reveal a chord, then keep it here with a reason.'}
                </p>
              )}
              <ul className="cd-kept" ref={keptListRef} aria-label="Kept chords">
                {kept.length === 0 && <li className="cd-kept__empty">Chords you keep appear here, with your reason.</li>}
                {keptShown.map(k => {
                  const kc = resolveChord(k)
                  const meta = [
                    k.start === 'sound' ? `From sound · ${times(k.replays)}` : 'From name',
                    ...(k.changedFrom ? [`Changed ${DIE_NAMES[k.changedFrom.die]}`] : []),
                    new Date(k.keptAt).toLocaleDateString(),
                  ]
                  return (
                    <li key={k.id} className="cd-kept__item" data-revealed={k.revealed}>
                      <span className="cd-kept__name">{kc.name}</span>
                      <div className="cd-kept__text">
                        <p className="cd-kept__reason">{k.reason}</p>
                        <p className="cd-kept__meta">
                          {k.revealed && <span className="cd-flag">Revealed</span>}{meta.join(' · ')}
                        </p>
                      </div>
                      <div className="cd-kept__actions">
                        <button type="button" className="cd-btn cd-btn--small" onClick={() => audio.playChord(targetVoicing(kc), 'kept')}
                          aria-label={`Hear ${kc.name}`}>Hear</button>
                        <button type="button" className="cd-btn cd-btn--small cd-btn--ghost" onClick={() => removeKept(k.id)}
                          aria-label={`Remove kept ${kc.name}: ${k.reason}`}>✕</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>

        {notice && <p className="cd-notice" role="status">{notice}</p>}
      </div>
    </ToolShell>
  )
}

