import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ToolShell from '../../app/ToolShell'
import { logEvent } from '../../analytics/events'
import { downloadMidiFile } from '../../utils/midiExport'
import DieTile, { BarStrip, DieFace } from './DieTile'
import Results from './Results'
import { createRhythmAudio } from './audioEngine'
import { AVAILABLE_LEVEL_IDS, LEVELS } from './faces'
import { DEFAULT_DRUM, DRUM_SOUNDS, buildRhythmMidiBytes, phraseFilename, rhythmFilename } from './midi'
import { METRES, SIMPLE_METRE_IDS, blockUnit, isAllRest, resolveTies, rollBar, slotPool } from './rhythm'
import { reflect, scoreBar } from './scoring'
import { KEYS, readKept, readNumber, readPhrase, readString, remove, write, writeKept, writePhrase } from './storage'
import { barBoundaries, barSeconds, calibrationOffset, createPassSource, expectedOnsets, phraseOnsets } from './timeline'
import './RhythmDice.css'

const MIN_BPM = 40
const MAX_BPM = 160
const PHRASE_BARS = 4
const LEVEL_CHOICES = [
  { key: 'L1', label: '1', levelIds: ['L1'] },
  { key: 'L2', label: '2', levelIds: ['L2'] },
  { key: 'L3', label: '3', levelIds: ['L3'] },
  { key: 'mix', label: 'Mix', levelIds: AVAILABLE_LEVEL_IDS },
]
const SUBDIVISIONS = [
  { ticks: 0, label: 'Beats' },
  { ticks: 6, label: 'Quavers' },
  { ticks: 3, label: 'Semis' },
]
// Once: play the bar and see the result. Repeat: the same bar again and
// again, each pass scored. Read ahead: while you play one bar, the next is
// rolled and shown, so you are always reading a bar ahead.
const MODES = [
  { key: 'once', label: 'Once' },
  { key: 'repeat', label: 'Repeat' },
  { key: 'readahead', label: 'Read ahead' },
]
const CALIBRATION_BPM = 100
const CALIBRATION_TAPS = 8
// Taps this long before a bar's first onset still belong to that bar.
const LEAD_IN = 0.1
const FACE_INDEX = new Map(LEVELS.flatMap(l => l.faces).map(f => [f.id, f]))

const clampBpm = v => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(Number(v) || 0)))
const facesFromIds = ids => {
  const faces = ids.map(id => FACE_INDEX.get(id))
  return faces.every(Boolean) ? faces : null
}
const unlockedAll = n => Array.from({ length: n }, () => false)

export default function RhythmDice() {
  const audioRef = useRef(null)
  if (!audioRef.current) audioRef.current = createRhythmAudio()
  const audio = audioRef.current

  const [levelKey, setLevelKey] = useState(() => readString(KEYS.levels, 'L1', LEVEL_CHOICES.map(c => c.key)))
  const levelIds = LEVEL_CHOICES.find(c => c.key === levelKey).levelIds
  const pool = useMemo(() => slotPool(levelIds), [levelIds])
  const unit = useMemo(() => blockUnit(slotPool(AVAILABLE_LEVEL_IDS)), [])

  const [metreId, setMetreId] = useState(() => readString(KEYS.metre, '4/4', SIMPLE_METRE_IDS))
  const metre = METRES[metreId]
  const [faces, setFaces] = useState(() => rollBar(pool, METRES[readString(KEYS.metre, '4/4', SIMPLE_METRE_IDS)]))
  const [locked, setLocked] = useState(() => unlockedAll(faces.length))
  const [rolling, setRolling] = useState(false)
  const [view, setView] = useState(() => readString(KEYS.view, 'notes', ['notes', 'blocks']))
  const [bpm, setBpmState] = useState(() => readNumber(KEYS.bpm, 80, { min: MIN_BPM, max: MAX_BPM }))
  const [subdivision, setSubdivision] = useState(() => readNumber(KEYS.subdivision, 0, { min: 0, max: 6 }))
  const [mode, setMode] = useState(() => readString(KEYS.mode, 'once', MODES.map(m => m.key)))
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
  const [phrase, setPhrase] = useState(readPhrase)
  // While a phrase plays, the tray shows the bar being played (`live`), and
  // read-ahead and phrases show the bar after it (`next`).
  const [live, setLive] = useState(null) // { faces, bar, of } | null
  const [nextFaces, setNextFaces] = useState(null)
  // The lower half of the screen shows one thing at a time, so the page never
  // scrolls: the tap pad, the last result, the keep shelf or the phrase.
  const [stage, setStage] = useState('play') // play | result | keep | phrase
  const [keptPage, setKeptPage] = useState(0)
  const [keptPerPage, setKeptPerPage] = useState(3)
  const keptListRef = useRef(null)

  const sessionRef = useRef(null)
  const rafRef = useRef(0)
  const shownFaces = live?.faces ?? faces
  const ties = useMemo(() => resolveTies(shownFaces), [shownFaces])
  const busy = phase !== 'idle'
  const phraseBars = useMemo(() => phrase.bars.map(facesFromIds).filter(Boolean), [phrase])
  const phraseMetre = phrase.metre ? METRES[phrase.metre] : null

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
      const rows = Math.max(1, Math.floor((entry.contentRect.height + 8) / 64))
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
    setFaces(current => rollBar(pool, metre, { current, locked }))
    setOutcome(null)
    setRolling(true)
    window.setTimeout(() => setRolling(false), 460)
    logEvent('rhythm_dice_roll', { levels: levelIds.join('+'), metre: metreId, locked: locked.filter(Boolean).length })
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

  // A new metre is a new number of dice: roll a fresh bar, nothing locked.
  function chooseMetre(id) {
    if (busy || id === metreId || !METRES[id]) return
    const m = METRES[id]
    setMetreId(id)
    write(KEYS.metre, id)
    setFaces(rollBar(pool, m))
    setLocked(unlockedAll(m.dice))
    setOutcome(null)
    logEvent('rhythm_dice_metre', { metre: id })
  }

  function chooseMode(key) {
    setMode(key)
    write(KEYS.mode, key)
  }

  // ----- sessions (hear it / perform / phrase / calibrate) -----

  const stopSession = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    audio.stop()
    sessionRef.current = null
    setPhase('idle')
    setBeatLight({ beat: -1, countIn: false })
    setLive(null)
    setNextFaces(null)
  }, [audio])

  function frame() {
    const s = sessionRef.current
    if (!s) return
    const t = audio.now()
    const beatSec = 60 / s.bpm
    if (t < s.firstBar) {
      setBeatLight({ beat: Math.max(0, Math.floor((t - s.startTime) / beatSec)) % s.beatsPerBar, countIn: true })
    } else {
      const bar = Math.floor((t - s.firstBar) / s.barSec)
      const intoBar = (t - s.firstBar) - bar * s.barSec
      setBeatLight({ beat: Math.floor(intoBar / beatSec) % s.beatsPerBar, countIn: false })
      if (bar !== s.shownBar) {
        s.shownBar = bar
        s.onBar?.(bar)
      }
    }
    s.onFrame?.(t)
    if (sessionRef.current === s) rafRef.current = requestAnimationFrame(frame)
  }

  async function startSession(session, makeSource) {
    try {
      await audio.ensure()
    } catch {
      setNotice('Sound could not start in this browser.')
      return null
    }
    // Space is the tap key during a session; keep it away from any button.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const startTime = audio.now() + 0.12
    const source = makeSource(startTime)
    const s = { beatsPerBar: metre.dice, shownBar: -1, ...session, startTime }
    s.firstBar = source.firstBar ?? startTime
    sessionRef.current = s
    audio.play(source)
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(frame)
    return s
  }

  async function hearIt() {
    if (busy) return
    setNotice('')
    setStage('play')
    setPhase('listening')
    const barSec = barSeconds(metre, bpm)
    const s = await startSession(
      { kind: 'listen', bpm, barSec },
      startTime => createPassSource({ faces, metre, bpm, startTime, subdivision, claps: true, passes: 1 }),
    )
    if (!s) return setPhase('idle')
    s.onFrame = t => { if (t > s.firstBar + barSec + 0.2) stopSession() }
    logEvent('rhythm_dice_hear_it', { bpm, metre: metreId })
  }

  // Per-bar scoring for Once, Repeat and Read ahead. `s.bars[k]` is the bar
  // played on pass k; read-ahead rolls each next bar as the previous starts.
  async function perform() {
    if (busy) return
    setNotice('')
    setOutcome(null)
    setStage('play')
    setPhase('performing')
    const barSec = barSeconds(metre, bpm)
    const passes = mode === 'once' ? 1 : Infinity
    const lockedAtStart = locked
    const roll = prev => rollBar(pool, metre, { current: prev, locked: lockedAtStart })
    const bars = [faces]
    if (mode === 'readahead') {
      bars[1] = roll(faces)
      setNextFaces(bars[1])
    }
    const facesFor = k => (mode === 'readahead' ? bars[k] : faces)
    const expectedFor = k => expectedOnsets(facesFor(k), metre, bpm)
    // Seconds after the first downbeat at which bar k's taps stop counting.
    const endOf = k => (k === passes - 1
      ? k * barSec + barSec + LEAD_IN
      : k * barSec + barBoundaries([expectedFor(k), expectedFor(k + 1)], barSec)[0])

    const s = await startSession(
      { kind: 'perform', bpm, barSec, taps: [], scored: 0, latency: (latencyMs ?? 0) / 1000 },
      startTime => createPassSource({ faces: facesFor, metre, bpm, startTime, subdivision, passes }),
    )
    if (!s) return setPhase('idle')
    if (mode === 'readahead') {
      // As bar k starts it becomes the bar on the dice, and bar k+1 is rolled
      // and shown underneath so it can be read while bar k is played.
      s.onBar = k => {
        if (!bars[k + 1]) bars[k + 1] = roll(bars[k])
        setFaces(bars[k])
        setNextFaces(bars[k + 1])
      }
    }
    s.onFrame = t => {
      while (s.scored < passes && bars[s.scored] && (mode !== 'readahead' || bars[s.scored + 1]) && t > s.firstBar + endOf(s.scored) + 0.03) {
        const k = s.scored
        const barStart = s.firstBar + k * barSec
        const lo = k === 0 ? -LEAD_IN : endOf(k - 1) - k * barSec
        const hi = endOf(k) - k * barSec
        const rel = s.taps.map(tap => tap - barStart).filter(x => x >= lo && x < hi)
        const expected = expectedFor(k)
        const result = scoreBar(expected, rel)
        setOutcome({ result, reflection: reflect(result), expected, barSec, pass: k, loop: passes > 1, beats: metre.dice })
        if (passes === 1) setStage('result')
        logEvent('rhythm_dice_scored', { bpm, metre: metreId, mode, accuracy: Math.round(result.accuracy * 100), allRest: result.allRest })
        s.scored += 1
      }
      if (s.scored >= passes) stopSession()
    }
  }

  // ----- phrase -----

  function addToPhrase(barFaces, barMetreId) {
    if (busy) return
    if (phrase.bars.length >= PHRASE_BARS) return setNotice(`A phrase holds ${PHRASE_BARS} bars. Remove one to add another.`)
    if (phrase.bars.length && phrase.metre !== barMetreId) {
      return setNotice(`This phrase is in ${phrase.metre}. Clear it, or add a ${phrase.metre} bar.`)
    }
    const next = { metre: barMetreId, bars: [...phrase.bars, barFaces.map(f => f.id)] }
    setPhrase(next)
    writePhrase(next)
    setNotice(`Bar ${next.bars.length} of ${PHRASE_BARS} added to the phrase.`)
    logEvent('rhythm_dice_phrase_add', { bars: next.bars.length, metre: barMetreId })
  }

  function removeFromPhrase(i) {
    const bars = phrase.bars.filter((_, j) => j !== i)
    const next = { metre: bars.length ? phrase.metre : null, bars }
    setPhrase(next)
    writePhrase(next)
  }

  function clearPhrase() {
    const next = { metre: null, bars: [] }
    setPhrase(next)
    writePhrase(next)
  }

  async function playPhrase({ listen = false } = {}) {
    if (busy || !phraseBars.length || !phraseMetre) return
    setNotice('')
    setOutcome(null)
    setStage('play')
    setPhase(listen ? 'listening' : 'performing')
    const m = phraseMetre
    const n = phraseBars.length
    const barSec = barSeconds(m, bpm)
    const s = await startSession(
      { kind: listen ? 'listen' : 'phrase', bpm, barSec, beatsPerBar: m.dice, taps: [], latency: (latencyMs ?? 0) / 1000 },
      startTime => createPassSource({ faces: k => phraseBars[k], metre: m, bpm, startTime, subdivision, claps: listen, passes: n }),
    )
    if (!s) return setPhase('idle')
    setLive({ faces: phraseBars[0], bar: 0, of: n, metre: m })
    setNextFaces(phraseBars[1] ?? null)
    s.onBar = k => {
      if (k >= n) return
      setLive({ faces: phraseBars[k], bar: k, of: n, metre: m })
      setNextFaces(phraseBars[k + 1] ?? null)
    }
    const total = n * barSec
    s.onFrame = t => {
      if (t < s.firstBar + total + LEAD_IN + 0.03) return
      if (!listen) {
        // The whole phrase is scored as one sequence.
        const expected = phraseOnsets(phraseBars, m, bpm)
        const rel = s.taps.map(tap => tap - s.firstBar).filter(x => x >= -LEAD_IN && x < total + LEAD_IN)
        const result = scoreBar(expected, rel)
        setOutcome({ result, reflection: reflect(result), expected, barSec: total, pass: 0, loop: false, beats: m.dice * n, beatsPerBar: m.dice, bars: n })
        setStage('result')
        logEvent('rhythm_dice_phrase_scored', { bpm, bars: n, metre: m.id, accuracy: Math.round(result.accuracy * 100) })
      }
      stopSession()
    }
  }

  // ----- calibration -----

  async function calibrate() {
    if (busy) return
    setNotice('')
    setCalTaps(0)
    setStage('play')
    setPhase('calibrating')
    const beatSec = 60 / CALIBRATION_BPM
    const countIn = 4
    const total = countIn + CALIBRATION_TAPS
    let clickTimes = []
    const s = await startSession(
      { kind: 'calibrate', bpm: CALIBRATION_BPM, barSec: beatSec * 4, beatsPerBar: 4, rawTaps: [] },
      startTime => {
        const all = Array.from({ length: total }, (_, i) => ({
          time: startTime + i * beatSec,
          kind: 'click',
          level: i % 4 === 0 ? 'accent' : 'beat',
        }))
        clickTimes = all.slice(countIn).map(e => e.time)
        let i = 0
        return { next: () => all[i++] ?? null, firstBar: startTime + countIn * beatSec }
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
    if (!s || (s.kind !== 'perform' && s.kind !== 'phrase' && s.kind !== 'calibrate')) return
    const t = audio.eventTime(event)
    if (s.kind === 'calibrate') {
      s.rawTaps.push(t)
      setCalTaps(n => n + 1)
    } else {
      s.taps.push(t - s.latency)
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
      metre: metreId,
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
    logEvent('rhythm_dice_kept', { withReason: !!entry.reason, metre: metreId })
  }

  function removeKept(id) {
    const next = kept.filter(k => k.id !== id)
    setKept(next)
    writeKept(next)
  }

  // Kept bars from before PR 2 have no metre: they were all 4/4.
  const keptMetreId = entry => (METRES[entry.metre] ? entry.metre : '4/4')

  function loadKept(entry) {
    const loaded = facesFromIds(entry.faceIds)
    if (!loaded) return setNotice('That kept bar uses faces this version does not have.')
    const id = keptMetreId(entry)
    setMetreId(id)
    write(KEYS.metre, id)
    setFaces(loaded)
    setLocked(loaded.map(() => true))
    setBpm(entry.bpm)
    setOutcome(null)
    setStage('play')
    setNotice('Kept bar loaded and locked. Unlock dice to re-roll them.')
  }

  function download(bytes, filename) {
    try {
      downloadMidiFile(bytes, filename)
      setNotice('MIDI file downloaded.')
      logEvent('rhythm_dice_midi_export', { drum })
    } catch (err) {
      console.error(err)
      setNotice('The MIDI file could not be made. Try again.')
    }
  }

  function exportBar(barFaces, tempo, barMetre) {
    download(buildRhythmMidiBytes({ faces: barFaces, metre: barMetre, bpm: tempo, drum }), rhythmFilename(barFaces, barMetre))
  }

  function exportPhrase() {
    if (!phraseBars.length || !phraseMetre) return
    download(buildRhythmMidiBytes({ bars: phraseBars, metre: phraseMetre, bpm, drum }), phraseFilename(phraseBars, phraseMetre))
  }

  function chooseDrum(v) {
    const n = Number(v)
    setDrum(n)
    write(KEYS.drum, n)
  }

  function cycleSubdivision() {
    const i = SUBDIVISIONS.findIndex(s => s.ticks === subdivision)
    const next = SUBDIVISIONS[(i + 1) % SUBDIVISIONS.length].ticks
    setSubdivision(next)
    write(KEYS.subdivision, next)
  }

  // ----- render -----

  const shownMetre = live?.metre ?? metre
  const allRest = isAllRest(shownFaces)
  const countInLabel = beatLight.countIn ? `Count-in ${beatLight.beat + 1}` : null
  const padLabel = phase === 'calibrating'
    ? (beatLight.countIn ? 'Listen…' : `Tap with each click · ${calTaps} of ${CALIBRATION_TAPS}`)
    : phase === 'performing'
      ? (countInLabel ?? (live ? `Bar ${live.bar + 1} of ${live.of}` : allRest ? 'Hold the silence' : 'Play the bar'))
      : phase === 'listening' ? (live ? `Listening · bar ${live.bar + 1} of ${live.of}` : 'Listening…') : 'Tap here or press Space'

  const keptPages = Math.max(1, Math.ceil(kept.length / keptPerPage))
  const page = Math.min(keptPage, keptPages - 1)
  const keptShown = kept.slice(page * keptPerPage, (page + 1) * keptPerPage)
  const stages = [
    { key: 'play', label: 'Play' },
    { key: 'result', label: 'Result', disabled: !outcome },
    { key: 'keep', label: kept.length ? `Keep · ${kept.length}` : 'Keep' },
    { key: 'phrase', label: phrase.bars.length ? `Phrase · ${phrase.bars.length}` : 'Phrase' },
  ]
  const subLabel = SUBDIVISIONS.find(s => s.ticks === subdivision)?.label ?? 'Beats'

  return (
    <ToolShell>
      <div className="rhythm-dice" style={{ '--rd-dice': shownMetre.dice }}>
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
                  aria-label={c.key === 'mix' ? 'Mix levels 1 to 3' : `Level ${c.label}`}
                  className={levelKey === c.key ? 'is-on' : ''} onClick={() => chooseLevel(c.key)} disabled={busy}>
                  {c.key !== 'mix' && <span className="rd-long" aria-hidden="true">Level </span>}{c.label}
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

        <section className="rd-tray" aria-label={`Dice: one bar of ${shownMetre.id}`}>
          {/* The time signature is the metre control: tap it to choose. */}
          <label className="rd-tray__meter" title="Time signature">
            <span aria-hidden="true"><span>{shownMetre.timeSignature[0]}</span><span>{shownMetre.timeSignature[1]}</span></span>
            <span className="rd-visually-hidden">Time signature</span>
            <select id="rd-metre" value={metreId} onChange={e => chooseMetre(e.target.value)} disabled={busy}>
              {SIMPLE_METRE_IDS.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <div className="rd-tray__dice">
            {shownFaces.map((face, i) => (
              <DieTile
                key={i}
                index={i}
                face={face}
                locked={!live && locked[i]}
                rolling={rolling}
                disabled={busy}
                onToggleLock={() => toggleLock(i)}
                view={view}
                beatTicks={shownMetre.beatTicks}
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

        <section className="rd-stage" aria-label="Play, result, keep and phrase">
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
                <button type="button" className="rd-btn rd-btn--small rd-click" onClick={cycleSubdivision} disabled={busy}
                  aria-label={`Click: ${subLabel}. Tap to change`}>
                  <span aria-hidden="true">Click · </span>{subLabel}
                </button>
                <div className="rd-seg rd-seg--small" role="radiogroup" aria-label="Play">
                  {MODES.map(m => (
                    <button key={m.key} type="button" role="radio" aria-checked={mode === m.key}
                      className={mode === m.key ? 'is-on' : ''} disabled={busy} onClick={() => chooseMode(m.key)}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="rd-lights" aria-hidden="true">
                  {Array.from({ length: shownMetre.dice }, (_, b) => (
                    <span key={b} className={`rd-light${beatLight.beat === b ? (beatLight.countIn ? ' is-count' : ' is-on') : ''}${b === 0 ? ' is-down' : ''}`} />
                  ))}
                </div>
              </div>
              {nextFaces && (
                <div className="rd-next" aria-label={`Next bar: ${nextFaces.map(f => f.name).join(', ')}`}>
                  <span className="rd-next__label">Next</span>
                  <div className="rd-next__dice">
                    {nextFaces.map((f, i) => (
                      <DieFace key={`${i}-${f.id}`} face={f} view={view} beatTicks={shownMetre.beatTicks} unit={unit} size="next"
                        tiedIn={i > 0 && resolveTies(nextFaces)[i - 1]} tieOut={resolveTies(nextFaces)[i]} />
                    ))}
                  </div>
                </div>
              )}
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
              <Results outcome={outcome} beatTicks={metre.beatTicks} beats={outcome.beats} />
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
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => exportBar(faces, bpm, metre)}>Export this bar</button>
              </div>

              <ul className="rd-kept" ref={keptListRef} aria-label="Kept bars">
                {kept.length === 0 && <li className="rd-kept__empty">Bars you keep appear here, with your reason.</li>}
                {keptShown.map(k => {
                  const kf = facesFromIds(k.faceIds)
                  const km = METRES[keptMetreId(k)]
                  return (
                    <li key={k.id} className="rd-kept__item">
                      <span className="rd-kept__metre" aria-label={`${km.id}`}>{km.id}</span>
                      <div className="rd-kept__text">
                        {kf ? <BarStrip faces={kf} beatTicks={km.beatTicks} unit={unit} /> : <span className="rd-kept__missing">Faces missing</span>}
                        <p className="rd-kept__reason">{k.reason || 'No reason written'}</p>
                        <p className="rd-kept__meta">{k.bpm} BPM · {new Date(k.keptAt).toLocaleDateString()}</p>
                      </div>
                      <div className="rd-kept__actions">
                        <button type="button" className="rd-btn rd-btn--small" onClick={() => loadKept(k)} disabled={busy || !kf}>Load</button>
                        <button type="button" className="rd-btn rd-btn--small" onClick={() => addToPhrase(kf, km.id)} disabled={busy || !kf}
                          aria-label={`Add to phrase: ${k.reason || 'kept bar'}`}>+ Phrase</button>
                        <button type="button" className="rd-btn rd-btn--small rd-kept__midi" onClick={() => exportBar(kf, k.bpm, km)} disabled={!kf}>MIDI</button>
                        <button type="button" className="rd-btn rd-btn--small rd-btn--ghost" onClick={() => removeKept(k.id)} aria-label={`Remove kept bar: ${k.reason || 'no reason'}`}>✕</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {stage === 'phrase' && (
            <div className="rd-stage__panel rd-phrase" role="tabpanel" id="rd-panel-phrase" aria-labelledby="rd-tab-phrase">
              <p className="rd-phrase__intro">
                {phrase.bars.length
                  ? <>A {phrase.bars.length}-bar phrase in {phrase.metre}. Play it straight through; it is scored as one line.</>
                  : <>Chain up to {PHRASE_BARS} bars into a phrase: add the bar on the dice, or a kept bar from Keep.</>}
              </p>
              <ol className="rd-phrase__slots">
                {Array.from({ length: PHRASE_BARS }, (_, i) => {
                  const bar = phraseBars[i]
                  return (
                    <li key={i} className={`rd-phrase__slot${bar ? '' : ' is-empty'}`}>
                      <span className="rd-phrase__num">{i + 1}</span>
                      {bar
                        ? <BarStrip faces={bar} beatTicks={phraseMetre.beatTicks} unit={unit} label={`Bar ${i + 1}: ${bar.map(f => f.name).join(', ')}`} />
                        : <span className="rd-phrase__empty">Empty</span>}
                      {bar && (
                        <button type="button" className="rd-btn rd-btn--small rd-btn--ghost" onClick={() => removeFromPhrase(i)} aria-label={`Remove bar ${i + 1}`}>✕</button>
                      )}
                    </li>
                  )
                })}
              </ol>
              <div className="rd-phrase__actions">
                <button type="button" className="rd-btn rd-btn--keep" onClick={() => addToPhrase(faces, metreId)} disabled={phrase.bars.length >= PHRASE_BARS}>Add this bar</button>
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => playPhrase({ listen: true })} disabled={!phraseBars.length}>Hear</button>
                <button type="button" className="rd-btn rd-btn--primary" onClick={() => playPhrase()} disabled={!phraseBars.length}>Play phrase</button>
                <button type="button" className="rd-btn rd-btn--quiet" onClick={exportPhrase} disabled={!phraseBars.length}>MIDI</button>
                <button type="button" className="rd-btn rd-btn--ghost" onClick={clearPhrase} disabled={!phrase.bars.length}>Clear</button>
              </div>
            </div>
          )}
        </section>

        {notice && <p className="rd-notice" role="status">{notice}</p>}
      </div>
    </ToolShell>
  )
}

