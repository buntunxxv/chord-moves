import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ToolShell from '../../app/ToolShell'
import { LEVEL_CHOICES, LEVEL_KEYS, displayNote, resolveChord, rollChord } from './faces'
import { compare, finishReflection, keyLabel, keySpoken, nextPrompt, placementFeedback, spelledNotes } from './answer'
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

function Die({ label, face, hidden, rolling }) {
  const spoken = hidden ? `${label} die: hidden until you finish` : face ? `${label} die: ${face}` : `${label} die: not rolled yet`
  return (
    <div className="cd-slot">
      <span className={`cd-die${rolling ? ' cd-die--rolling' : ''}${hidden ? ' cd-die--hidden' : ''}${face === 'none' ? ' cd-die--none' : ''}`}
        role="img" aria-label={spoken}>
        <span className="cd-die__face" aria-hidden="true">{hidden ? '?' : face ?? '–'}</span>
      </span>
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
  const [round, setRound] = useState(null) // { chord, start, levelKey } | null
  const [selected, setSelected] = useState([])
  const [feedback, setFeedback] = useState('')
  const [replays, setReplays] = useState(0)
  const [status, setStatus] = useState('building') // building | done | revealed
  const [stage, setStage] = useState('build') // build | result | keep
  const [rolling, setRolling] = useState(false)
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

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(''), 2600)
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

  const roll = useCallback(() => {
    const next = resolveChord(rollChord(levelKey, { avoid: chord }))
    const nextRound = { chord: next, start, levelKey }
    setRound(nextRound)
    setSelected([])
    setReplays(0)
    setStatus('building')
    setStage('build')
    setKeptThis(false)
    setReason('')
    setFeedback('')
    setRolling(true)
    window.setTimeout(() => setRolling(false), 460)
    // From sound, the chord plays from the Roll tap itself (which also
    // unlocks audio on iOS).
    if (start === 'sound') audio.playChord(targetVoicing(next), 'target')
  }, [audio, chord, levelKey, start])

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
    if (finished) return
    if (adding) setFeedback(placementFeedback(chord, chroma, next, round.start))
    else setFeedback(`You took away ${keyLabel(chroma)}.`)
    if (compare(chord, next).complete) finish('done')
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
    const item = makeKept(chord, { start: round.start, replays, revealed: status === 'revealed', reason, levelKey: round.levelKey })
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
    const next = nextPrompt(chord, selected, round.start)
    if (selected.length === 0) {
      return round.start === 'sound' ? `Listen, then build what you hear. ${next}` : `Build ${chord.name}. ${next}`
    }
    return next
  }, [chord, finished, round, selected])

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
          <Die label="Root" face={chord ? displayNote(chord.root) : null} hidden={concealed} rolling={rolling} />
          <Die label="Quality" face={chord ? chord.quality : null} hidden={concealed} rolling={rolling} />
          {/* Levels 1–2 have no colour: the die is on the table and reads
              "none", so the tray looks the same at every level. */}
          <Die label="Colour" face={chord ? chord.colour : null} hidden={concealed} rolling={rolling} />
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
                {feedback && <p className="cd-feedback__line">{feedback}</p>}
                {prompt && <p className="cd-feedback__prompt">{prompt}</p>}
                {finished && <p className="cd-feedback__prompt">{status === 'revealed' ? 'Revealed.' : 'Built.'} See Result.</p>}
              </div>
              <Piano selected={selected} onToggle={toggleKey} disabled={!chord} />
              <div className="cd-build__actions">
                <button type="button" className="cd-btn cd-btn--quiet" disabled={!selected.length}
                  onClick={() => audio.playChord(selectionVoicing(selected), 'selection')}>Hear my chord</button>
                <button type="button" className="cd-btn cd-btn--ghost" disabled={!selected.length || finished}
                  onClick={() => { setSelected([]); setFeedback('You cleared the keyboard.') }}>Clear</button>
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
              </p>
              <p className="cd-result__reflection">{finishReflection(chord, { start: round.start, replays, revealed: status === 'revealed' })}</p>
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
                  const meta = [k.start === 'sound' ? `From sound · ${times(k.replays)}` : 'From name', new Date(k.keptAt).toLocaleDateString()]
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

