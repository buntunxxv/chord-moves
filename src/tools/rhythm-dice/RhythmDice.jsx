import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ToolShell from '../../app/ToolShell'
import { logEvent } from '../../analytics/events'
import { downloadMidiFile } from '../../utils/midiExport'
import DieTile, { DieFace } from './DieTile'
import Results from './Results'
import { createRhythmAudio } from './audioEngine'
import { AVAILABLE_LEVEL_IDS, LEVELS } from './faces'
import { DEFAULT_DRUM, DRUM_SOUNDS, buildRhythmMidiBytes, rhythmFilename } from './midi'
import { METRES, blockUnit, isAllRest, resolveTies, rollBar, slotPool } from './rhythm'
import { reflect, scoreBar } from './scoring'
import { KEYS, readKept, readNumber, readString, remove, write, writeKept } from './storage'
import { barSeconds, calibrationOffset, createPassSource, expectedOnsets } from './timeline'
import './RhythmDice.css'

const METRE = METRES['4/4']
const MIN_BPM = 40
const MAX_BPM = 160
const LEVEL_CHOICES = [
  { key: 'L1', label: 'Level 1', levelIds: ['L1'] },
  { key: 'L2', label: 'Level 2', levelIds: ['L2'] },
  { key: 'mix', label: 'Mix 1 + 2', levelIds: AVAILABLE_LEVEL_IDS },
]
const SUBDIVISIONS = [
  { ticks: 0, label: 'Beats' },
  { ticks: 6, label: 'Quavers' },
  { ticks: 3, label: 'Semis' },
]
const CALIBRATION_BPM = 100
const CALIBRATION_TAPS = 8
// Taps this long before a bar's first onset still belong to that bar.
const LEAD_IN = 0.1
const FACE_INDEX = new Map(LEVELS.flatMap(l => l.faces).map(f => [f.id, f]))

const clampBpm = v => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(Number(v) || 0)))

export default function RhythmDice() {
  const audioRef = useRef(null)
  if (!audioRef.current) audioRef.current = createRhythmAudio()
  const audio = audioRef.current

  const [levelKey, setLevelKey] = useState(() => readString(KEYS.levels, 'L1', LEVEL_CHOICES.map(c => c.key)))
  const levelIds = LEVEL_CHOICES.find(c => c.key === levelKey).levelIds
  const pool = useMemo(() => slotPool(levelIds), [levelIds])
  const unit = useMemo(() => blockUnit(slotPool(AVAILABLE_LEVEL_IDS)), [])

  const [faces, setFaces] = useState(() => rollBar(pool, METRE))
  const [locked, setLocked] = useState([false, false, false, false])
  const [rolling, setRolling] = useState(false)
  const [view, setView] = useState(() => readString(KEYS.view, 'notes', ['notes', 'blocks']))
  const [bpm, setBpmState] = useState(() => readNumber(KEYS.bpm, 80, { min: MIN_BPM, max: MAX_BPM }))
  const [subdivision, setSubdivision] = useState(() => readNumber(KEYS.subdivision, 0, { min: 0, max: 6 }))
  const [loop, setLoop] = useState(false)
  const [latencyMs, setLatencyMs] = useState(() => {
    const v = readNumber(KEYS.latency, NaN, { min: -100, max: 400 })
    return Number.isFinite(v) ? v : null
  })
  const [phase, setPhase] = useState('idle') // idle | listening | performing | calibrating
  const [beatLight, setBeatLight] = useState({ beat: -1, countIn: false })
  const [padFlash, setPadFlash] = useState(0)
  const [calTaps, setCalTaps] = useState(0)
  const [outcome, setOutcome] = useState(null)
  const [notice, setNotice] = useState('')
  const [kept, setKept] = useState(readKept)
  const [reason, setReason] = useState('')
  const [drum, setDrum] = useState(() => readNumber(KEYS.drum, DEFAULT_DRUM))
  // The lower half of the screen shows one thing at a time, so the page never
  // scrolls: the tap pad, the last result, or the keep shelf.
  const [stage, setStage] = useState('play') // play | result | keep
  const [keptPage, setKeptPage] = useState(0)
  const [keptPerPage, setKeptPerPage] = useState(3)
  const keptListRef = useRef(null)

  const sessionRef = useRef(null)
  const rafRef = useRef(0)
  const ties = useMemo(() => resolveTies(faces), [faces])
  const busy = phase !== 'idle'

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    audio.close()
  }, [audio])

  // Notices float over the bottom edge and clear themselves, so they never
  // push the layout.
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(''), 4500)
    return () => window.clearTimeout(id)
  }, [notice])

  // The kept list pages instead of growing: as many rows as fit the space.
  useEffect(() => {
    const el = keptListRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const rows = Math.max(1, Math.floor((entry.contentRect.height + 8) / 72))
      setKeptPerPage(rows)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [stage])

  function setBpm(v) {
    const next = clampBpm(v)
    setBpmState(next)
    write(KEYS.bpm, next)
  }

  // ----- dice -----

  function reroll() {
    if (busy) return
    if (locked.every(Boolean)) {
      setNotice('Every die is locked. Unlock one to re-roll it.')
      return
    }
    setNotice('')
    setFaces(current => rollBar(pool, METRE, { current, locked }))
    setOutcome(null)
    setRolling(true)
    window.setTimeout(() => setRolling(false), 460)
    logEvent('rhythm_dice_roll', { levels: levelIds.join('+'), locked: locked.filter(Boolean).length })
  }

  function toggleLock(i) {
    setLocked(prev => prev.map((v, j) => (j === i ? !v : v)))
  }

  function chooseLevel(key) {
    setLevelKey(key)
    write(KEYS.levels, key)
  }

  function chooseView(next) {
    setView(next)
    write(KEYS.view, next)
  }

  // ----- sessions (hear it / perform / calibrate) -----

  const stopSession = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    audio.stop()
    sessionRef.current = null
    setPhase('idle')
    setBeatLight({ beat: -1, countIn: false })
  }, [audio])

  function frame() {
    const s = sessionRef.current
    if (!s) return
    const t = audio.now()
    const beatSec = 60 / s.bpm
    if (t < s.firstBar) {
      setBeatLight({ beat: Math.max(0, Math.floor((t - s.startTime) / beatSec)) % s.beatsPerBar, countIn: true })
    } else {
      const intoBar = (t - s.firstBar) % s.barSec
      setBeatLight({ beat: Math.floor(intoBar / beatSec) % s.beatsPerBar, countIn: false })
    }
    s.onFrame?.(t)
    if (sessionRef.current === s) rafRef.current = requestAnimationFrame(frame)
  }

  async function startSession(session, source) {
    try {
      await audio.ensure()
    } catch {
      setNotice('Sound could not start in this browser.')
      return null
    }
    // Space is the tap key during a session; keep it away from any button.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const startTime = audio.now() + 0.12
    const s = { ...session, startTime, beatsPerBar: METRE.dice }
    s.firstBar = startTime + (s.countInSec ?? 0)
    sessionRef.current = s
    audio.play(source(startTime))
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(frame)
    return s
  }

  async function hearIt() {
    if (busy) return
    setNotice('')
    setStage('play')
    setPhase('listening')
    const barSec = barSeconds(METRE, bpm)
    const s = await startSession(
      { kind: 'listen', bpm, barSec, countInSec: barSec },
      startTime => createPassSource({ faces, metre: METRE, bpm, startTime, subdivision, claps: true, passes: 1 }),
    )
    if (!s) return setPhase('idle')
    s.onFrame = t => { if (t > s.firstBar + barSec + 0.2) stopSession() }
    logEvent('rhythm_dice_hear_it', { bpm })
  }

  async function perform() {
    if (busy) return
    setNotice('')
    setOutcome(null)
    setStage('play')
    setPhase('performing')
    const barSec = barSeconds(METRE, bpm)
    const expected = expectedOnsets(faces, METRE, bpm)
    const passes = loop ? Infinity : 1
    // Where one bar's taps end and the next bar's begin. In a loop, halfway
    // between this bar's last onset and the next bar's first; otherwise a
    // short tail after the barline.
    const end = loop && expected.length
      ? (expected.at(-1).time + barSec + expected[0].time) / 2
      : barSec + LEAD_IN
    const facesAtStart = faces
    const s = await startSession(
      { kind: 'perform', bpm, barSec, countInSec: barSec, taps: [], scored: 0, latency: (latencyMs ?? 0) / 1000 },
      startTime => createPassSource({ faces: facesAtStart, metre: METRE, bpm, startTime, subdivision, passes }),
    )
    if (!s) return setPhase('idle')
    s.onFrame = t => {
      while (s.scored < passes && t > s.firstBar + s.scored * barSec + end + 0.03) {
        const barStart = s.firstBar + s.scored * barSec
        const lo = s.scored === 0 ? -LEAD_IN : end - barSec
        const rel = s.taps.map(tap => tap - barStart).filter(x => x >= lo && x < end)
        const result = scoreBar(expected, rel)
        setOutcome({ result, reflection: reflect(result), expected, barSec, pass: s.scored, loop: passes > 1 })
        // In a loop the pad stays up so the next pass can be played; the
        // latest result is one tap away on the Result tab.
        if (passes === 1) setStage('result')
        logEvent('rhythm_dice_scored', { bpm, accuracy: Math.round(result.accuracy * 100), allRest: result.allRest })
        s.scored += 1
      }
      if (s.scored >= passes) stopSession()
    }
  }

  async function calibrate() {
    if (busy) return
    setNotice('')
    setCalTaps(0)
    setStage('play')
    setPhase('calibrating')
    const beatSec = 60 / CALIBRATION_BPM
    const total = METRE.dice + CALIBRATION_TAPS
    let clickTimes = []
    const s = await startSession(
      { kind: 'calibrate', bpm: CALIBRATION_BPM, barSec: beatSec * METRE.dice, countInSec: beatSec * METRE.dice, rawTaps: [] },
      startTime => {
        const all = Array.from({ length: total }, (_, i) => ({
          time: startTime + i * beatSec,
          kind: 'click',
          level: i % METRE.dice === 0 ? 'accent' : 'beat',
        }))
        clickTimes = all.slice(METRE.dice).map(e => e.time)
        let i = 0
        return { next: () => all[i++] ?? null }
      },
    )
    if (!s) return setPhase('idle')
    s.onFrame = t => {
      if (t < clickTimes.at(-1) + 0.45) return
      const taps = s.rawTaps.filter(x => x > clickTimes[0] - 0.25)
      stopSession()
      if (taps.length < CALIBRATION_TAPS - 2) {
        setNotice(`Only ${taps.length} taps reached the clicks. Calibrate again and tap all ${CALIBRATION_TAPS}.`)
        return
      }
      const offset = calibrationOffset(taps, clickTimes)
      const ms = Math.round(Math.max(-100, Math.min(400, offset * 1000)))
      setLatencyMs(ms)
      write(KEYS.latency, ms)
      setNotice(`Calibrated: taps on this device register ${Math.abs(ms)} ms ${ms >= 0 ? 'late' : 'early'}. Scoring now allows for that.`)
      logEvent('rhythm_dice_calibrated', { ms })
    }
  }

  function resetCalibration() {
    remove(KEYS.latency)
    setLatencyMs(null)
    setNotice('Calibration cleared.')
  }

  // ----- taps -----

  const registerTap = useCallback(event => {
    const s = sessionRef.current
    if (!s || (s.kind !== 'perform' && s.kind !== 'calibrate')) return
    const t = audio.eventTime(event)
    if (s.kind === 'perform') s.taps.push(t - s.latency)
    else {
      s.rawTaps.push(t)
      setCalTaps(n => n + 1)
    }
    setPadFlash(n => n + 1)
  }, [audio])

  useEffect(() => {
    if (phase !== 'performing' && phase !== 'calibrating') return
    function onKey(e) {
      if (e.code !== 'Space' && e.key !== ' ') return
      e.preventDefault()
      if (!e.repeat) registerTap(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, registerTap])

  // ----- keep & export -----

  function keepBar() {
    const entry = {
      id: `${Date.now()}`,
      keptAt: new Date().toISOString(),
      faceIds: faces.map(f => f.id),
      bpm,
      levelIds,
      reason: reason.trim(),
    }
    const next = [entry, ...kept].slice(0, 50)
    setKept(next)
    writeKept(next)
    setReason('')
    setKeptPage(0)
    setNotice('Bar kept on this device.')
    logEvent('rhythm_dice_kept', { withReason: !!entry.reason })
  }

  function removeKept(id) {
    const next = kept.filter(k => k.id !== id)
    setKept(next)
    writeKept(next)
  }

  function loadKept(entry) {
    const loaded = entry.faceIds.map(id => FACE_INDEX.get(id))
    if (loaded.some(f => !f)) return setNotice('That kept bar uses faces this version does not have.')
    setFaces(loaded)
    setLocked([true, true, true, true])
    setBpm(entry.bpm)
    setOutcome(null)
    setStage('play')
    setNotice('Kept bar loaded and locked. Unlock dice to re-roll them.')
  }

  function exportMidi(facesToExport, tempo) {
    try {
      const bytes = buildRhythmMidiBytes({ faces: facesToExport, metre: METRE, bpm: tempo, drum })
      downloadMidiFile(bytes, rhythmFilename(facesToExport))
      setNotice('MIDI file downloaded.')
      logEvent('rhythm_dice_midi_export', { drum })
    } catch (err) {
      console.error(err)
      setNotice('The MIDI file could not be made. Try again.')
    }
  }

  function chooseDrum(v) {
    const n = Number(v)
    setDrum(n)
    write(KEYS.drum, n)
  }

  const allRest = isAllRest(faces)
  const padLabel = phase === 'calibrating'
    ? (beatLight.countIn ? 'Listen…' : `Tap with each click · ${calTaps} of ${CALIBRATION_TAPS}`)
    : phase === 'performing'
      ? (beatLight.countIn ? `Count-in ${beatLight.beat + 1}` : allRest ? 'Hold the silence' : 'Play the bar')
      : phase === 'listening' ? 'Listening…' : 'Tap here or press Space'

  const keptPages = Math.max(1, Math.ceil(kept.length / keptPerPage))
  const page = Math.min(keptPage, keptPages - 1)
  const keptShown = kept.slice(page * keptPerPage, (page + 1) * keptPerPage)
  const stages = [
    { key: 'play', label: 'Play' },
    { key: 'result', label: 'Result', disabled: !outcome },
    { key: 'keep', label: kept.length ? `Keep · ${kept.length}` : 'Keep' },
  ]

  return (
    <ToolShell>
      <div className="rhythm-dice">
        {/* Same page header as Chord Moves: a teal eyebrow naming the tool,
            then one line saying what you do here; controls sit to the right,
            where Chord Moves puts Upgrade. */}
        <header className="rd-head">
          <div className="rd-head__copy">
            <p className="rd-head__eyebrow">Rhythm Dice</p>
            <h1 className="rd-head__title">Roll, play and keep a bar</h1>
          </div>
          <div className="rd-head__controls">
          <div className="rd-seg rd-head__levels" role="radiogroup" aria-label="Dice level">
            {LEVEL_CHOICES.map(c => (
              <button key={c.key} type="button" role="radio" aria-checked={levelKey === c.key}
                className={levelKey === c.key ? 'is-on' : ''} onClick={() => chooseLevel(c.key)} disabled={busy}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="rd-seg rd-head__view" role="radiogroup" aria-label="Show dice as">
            {[['notes', 'Notes'], ['blocks', 'Blocks']].map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={view === v}
                className={view === v ? 'is-on' : ''} onClick={() => chooseView(v)}>
                {label}
              </button>
            ))}
          </div>
          </div>
        </header>

        <section className="rd-tray" aria-label="Dice: one bar of 4/4">
          <div className="rd-tray__meter" aria-hidden="true"><span>4</span><span>4</span></div>
          <div className="rd-tray__dice">
            {faces.map((face, i) => (
              <DieTile
                key={i}
                index={i}
                face={face}
                locked={locked[i]}
                rolling={rolling}
                disabled={busy}
                onToggleLock={() => toggleLock(i)}
                view={view}
                beatTicks={METRE.beatTicks}
                unit={unit}
                tiedIn={i > 0 && ties[i - 1]}
                tieOut={ties[i]}
                beatLit={beatLight.beat === i && !beatLight.countIn}
              />
            ))}
          </div>
        </section>

        <section className="rd-controls" aria-label="Tempo and practice">
          <div className="rd-tempo">
            <label htmlFor="rd-bpm" className="rd-visually-hidden">Tempo, crotchet beats per minute</label>
            <button type="button" className="rd-step" onClick={() => setBpm(bpm - 1)} aria-label="Slower" disabled={busy}>−</button>
            <input id="rd-bpm" type="range" min={MIN_BPM} max={MAX_BPM} value={bpm}
              onChange={e => setBpm(e.target.value)} disabled={busy} aria-valuetext={`${bpm} beats per minute`} />
            <button type="button" className="rd-step" onClick={() => setBpm(bpm + 1)} aria-label="Faster" disabled={busy}>+</button>
            <output className="rd-tempo__value" htmlFor="rd-bpm">{bpm}<small>BPM</small></output>
          </div>
          <div className="rd-actions">
            <button type="button" className="rd-btn rd-btn--roll" onClick={reroll} disabled={busy}>
              {locked.some(Boolean) ? 'Re-roll' : 'Roll'}
            </button>
            <button type="button" className="rd-btn rd-btn--quiet" onClick={hearIt} disabled={busy}>Hear it</button>
            {busy ? (
              <button type="button" className="rd-btn rd-btn--stop" onClick={stopSession}>Stop</button>
            ) : (
              <button type="button" className="rd-btn rd-btn--primary" onClick={perform}>Perform</button>
            )}
          </div>
        </section>

        <section className="rd-stage" aria-label="Play, result and keep">
          <div className="rd-stage__tabs" role="tablist" aria-label="Show">
            {stages.map(t => (
              <button key={t.key} type="button" role="tab" id={`rd-tab-${t.key}`} aria-controls={`rd-panel-${t.key}`}
                aria-selected={stage === t.key} className={stage === t.key ? 'is-on' : ''}
                disabled={t.disabled || (busy && t.key !== 'play')} onClick={() => setStage(t.key)}>
                {t.label}
              </button>
            ))}
            {stage === 'keep' && keptPages > 1 && (
              <div className="rd-pager">
                <button type="button" className="rd-btn rd-btn--small" onClick={() => setKeptPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Newer kept bars">←</button>
                <span>{page + 1} / {keptPages}</span>
                <button type="button" className="rd-btn rd-btn--small" onClick={() => setKeptPage(Math.min(keptPages - 1, page + 1))} disabled={page >= keptPages - 1} aria-label="Older kept bars">→</button>
              </div>
            )}
          </div>

          {stage === 'play' && (
            <div className={`rd-stage__panel rd-play${busy ? ' is-live' : ''}`} role="tabpanel" id="rd-panel-play" aria-labelledby="rd-tab-play">
              <div className="rd-play__bar">
                <div className="rd-seg rd-seg--small" role="radiogroup" aria-label="Click">
                  {SUBDIVISIONS.map(s => (
                    <button key={s.ticks} type="button" role="radio" aria-checked={subdivision === s.ticks}
                      className={subdivision === s.ticks ? 'is-on' : ''} disabled={busy}
                      onClick={() => { setSubdivision(s.ticks); write(KEYS.subdivision, s.ticks) }}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <label className="rd-switch">
                  <input id="rd-loop" type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} disabled={busy} />
                  <span>Repeat</span>
                </label>
                <div className="rd-lights" aria-hidden="true">
                  {Array.from({ length: METRE.dice }, (_, b) => (
                    <span key={b} className={`rd-light${beatLight.beat === b ? (beatLight.countIn ? ' is-count' : ' is-on') : ''}${b === 0 ? ' is-down' : ''}`} />
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="rd-pad"
                data-flash={padFlash % 2}
                onPointerDown={e => { e.preventDefault(); registerTap(e) }}
                aria-label={padLabel}
                aria-describedby="rd-pad-hint"
              >
                <span className="rd-pad__label">{padLabel}</span>
              </button>
              <p id="rd-pad-hint" className="rd-pad__hint">
                {latencyMs === null
                  ? <>Not calibrated. <button type="button" className="rd-link" onClick={calibrate} disabled={busy}>Calibrate this device</button></>
                  : <>Calibrated {Math.abs(latencyMs)} ms · <button type="button" className="rd-link" onClick={calibrate} disabled={busy}>Again</button> · <button type="button" className="rd-link" onClick={resetCalibration} disabled={busy}>Clear</button></>}
              </p>
            </div>
          )}

          {stage === 'result' && outcome && (
            <div className="rd-stage__panel" role="tabpanel" id="rd-panel-result" aria-labelledby="rd-tab-result">
              <Results outcome={outcome} beatTicks={METRE.beatTicks} beats={METRE.dice} />
            </div>
          )}

          {stage === 'keep' && (
            <div className="rd-stage__panel rd-keep" role="tabpanel" id="rd-panel-keep" aria-labelledby="rd-tab-keep">
              <div className="rd-keep__row">
                <label htmlFor="rd-reason" className="rd-visually-hidden">Why I kept this</label>
                <input id="rd-reason" type="text" maxLength={140} value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Why I kept this (optional)" />
                <button type="button" className="rd-btn rd-btn--keep" onClick={keepBar}>Keep bar</button>
              </div>
              <div className="rd-keep__row rd-keep__export">
                <label htmlFor="rd-drum">MIDI sound</label>
                <select id="rd-drum" value={drum} onChange={e => chooseDrum(e.target.value)}>
                  {DRUM_SOUNDS.map(d => <option key={d.midi} value={d.midi}>{d.label} ({d.midi})</option>)}
                </select>
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => exportMidi(faces, bpm)}>Export this bar</button>
              </div>

              <ul className="rd-kept" ref={keptListRef} aria-label="Kept bars">
                {kept.length === 0 && <li className="rd-kept__empty">Bars you keep appear here, with your reason.</li>}
                {keptShown.map(k => {
                  const kf = k.faceIds.map(id => FACE_INDEX.get(id)).filter(Boolean)
                  return (
                    <li key={k.id} className="rd-kept__item">
                      <div className="rd-kept__dice" aria-label={kf.map(f => f.name).join(', ')}>
                        {kf.map((f, i) => <DieFace key={i} face={f} view="blocks" beatTicks={METRE.beatTicks} unit={unit} size="small" />)}
                      </div>
                      <div className="rd-kept__text">
                        <p className="rd-kept__reason">{k.reason || 'No reason written'}</p>
                        <p className="rd-kept__meta">{k.bpm} BPM · {new Date(k.keptAt).toLocaleDateString()}</p>
                      </div>
                      <div className="rd-kept__actions">
                        <button type="button" className="rd-btn rd-btn--small" onClick={() => loadKept(k)} disabled={busy || kf.length !== 4}>Load</button>
                        <button type="button" className="rd-btn rd-btn--small" onClick={() => exportMidi(kf, k.bpm)} disabled={kf.length !== 4}>MIDI</button>
                        <button type="button" className="rd-btn rd-btn--small rd-btn--ghost" onClick={() => removeKept(k.id)} aria-label={`Remove kept bar: ${k.reason || 'no reason'}`}>✕</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>

        {notice && <p className="rd-notice" role="status">{notice}</p>}
      </div>
    </ToolShell>
  )
}
