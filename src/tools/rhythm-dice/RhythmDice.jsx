import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ToolShell from '../../app/ToolShell'
import { logEvent } from '../../analytics/events'
import { downloadMidiFile } from '../../utils/midiExport'
import DieTile, { BarStrip, DieFace } from './DieTile'
import Results from './Results'
import { DEFAULT_VOLUME, createRhythmAudio } from './audioEngine'
import BottomSheet from '../../components/BottomSheet'
import { readToolsPro, recheck, signOut } from '../../app/toolsPro'
import { PRO_NAME } from '../../app/brand'
import ToolsProSheet from '../../app/ToolsProSheet'
import { safeStorage } from '../../utils/safeStorage'
import { AVAILABLE_LEVEL_IDS, LEVELS, PRO_LEVEL_IDS, needsPro } from './faces'
import { DEFAULT_DRUM, DRUM_SOUNDS, buildRhythmMidiBytes, phraseFilename, rhythmFilename } from './midi'
import { COMPOUND_METRE_IDS, METRES, METRE_IDS, SIMPLE_METRE_IDS, barTicks, dieAt, isAllRest, resolveTies, rollBar, secondsPerTick, slotPool } from './rhythm'
import { buildMusicXml, downloadMusicXml, musicXmlFilename } from './musicxml'
import ClassroomView from './ClassroomView'
import { detectLag, reflect, scoreBar } from './scoring'
import { KEYS, readKept, readNumber, readPhrase, readString, remove, write, writeKept, writePhrase } from './storage'
import { barBoundaries, barReadyToScore, barSeconds, calibrationOffset, createPassSource, expectedOnsets, phraseOnsets } from './timeline'
import './RhythmDice.css'

const MIN_BPM = 40
const MAX_BPM = 160
const PHRASE_BARS = 4
// Mix pools every level you can use: Levels 1–3, plus Level 4 with Pro.
const LEVEL_CHOICES = [
  { key: 'L1', label: '1', levelIds: ['L1'] },
  { key: 'L2', label: '2', levelIds: ['L2'] },
  { key: 'L3', label: '3', levelIds: ['L3'] },
  { key: 'L4', label: '4', levelIds: ['L4'], pro: true, name: 'Level 4 (triplets)' },
  { key: 'L5', label: '5', levelIds: ['L5'], pro: true, compound: true, name: 'Level 5 (compound time)' },
  { key: 'mix', label: 'Mix', levelIds: AVAILABLE_LEVEL_IDS, proLevelIds: PRO_LEVEL_IDS },
]
const levelIdsFor = (choice, isPro) => (isPro && choice.proLevelIds ? [...choice.levelIds, ...choice.proLevelIds] : choice.levelIds)
const SUBDIVISIONS = [
  { ticks: 0, label: 'Beats' },
  { ticks: 6, label: 'Quavers' },
  { ticks: 4, label: 'Triplets' },
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

  // Pro on the Tools site (src/app/toolsPro.js): its own keys, set only by an
  // emailed code, re-checked against the server on every load.
  const [pro, setPro] = useState(() => readToolsPro(safeStorage))
  const isPro = pro.isPro
  const [levelKey, setLevelKey] = useState(() => {
    const stored = readString(KEYS.levels, 'L1', LEVEL_CHOICES.map(c => c.key))
    return LEVEL_CHOICES.find(c => c.key === stored)?.pro && !readToolsPro(safeStorage).isPro ? 'L1' : stored
  })
  const levelChoice = LEVEL_CHOICES.find(c => c.key === levelKey)
  const levelIds = useMemo(() => levelIdsFor(levelChoice, isPro), [levelChoice, isPro])
  // Which faces each die can roll. Dotted-crotchet dice (compound metres, and
  // the 3-group of 7/8) roll Level 5. Crotchet dice roll the chosen level; in
  // 7/8 that is Level 1, 2 or 3, or all three together (decided 15 Nov).
  const simpleLevelIds = useMemo(() => {
    if (levelChoice.compound) return AVAILABLE_LEVEL_IDS
    return levelIds
  }, [levelChoice, levelIds])
  const poolsFor = useCallback(m => {
    const simplePool = slotPool(m.id === '7/8' && !['L1', 'L2', 'L3'].includes(levelKey) ? AVAILABLE_LEVEL_IDS : simpleLevelIds)
    const compoundPool = slotPool(['L5'])
    return i => (m.dieTicks[i] === 18 ? compoundPool : simplePool)
  }, [levelKey, simpleLevelIds])

  const [metreId, setMetreId] = useState(() => {
    const stored = readString(KEYS.metre, '4/4', METRE_IDS)
    return METRES[stored].pro && !readToolsPro(safeStorage).isPro ? '4/4' : stored
  })
  const metre = METRES[metreId]
  const pool = useMemo(() => poolsFor(metre), [poolsFor, metre])
  const [faces, setFaces] = useState(() => rollBar(pool, metre))
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
  // The Pro sheet: unlock (email, then code) or manage.
  const [proSheet, setProSheet] = useState(null) // null | { reason }
  // Settings: whether taps make a sound, and how loud taps and the
  // metronome click are (0-100).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tapSound, setTapSound] = useState(() => readString(KEYS.tapSound, 'on', ['on', 'off']) === 'on')
  const [tapVolume, setTapVolume] = useState(() => readNumber(KEYS.tapVolume, DEFAULT_VOLUME, { min: 0, max: 100 }))
  const [clickVolume, setClickVolume] = useState(() => readNumber(KEYS.clickVolume, DEFAULT_VOLUME, { min: 0, max: 100 }))
  const tapSoundRef = useRef(tapSound)
  tapSoundRef.current = tapSound
  const [classroom, setClassroom] = useState(false)

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

  // Re-check Pro once per visit. Only a definite "not Pro" removes it (a
  // student whose lessons have ended); an offline or failed check keeps it.
  useEffect(() => {
    let live = true
    recheck(window.fetch.bind(window), safeStorage).then(outcome => {
      if (!live || outcome !== 'removed') return
      setPro(readToolsPro(safeStorage))
      setLevelKey(k => (LEVEL_CHOICES.find(c => c.key === k)?.pro ? 'L1' : k))
      setMetreId(id => {
        if (!METRES[id].pro) return id
        setFaces(rollBar(slotPool(['L1']), METRES['4/4']))
        setLocked(unlockedAll(4))
        return '4/4'
      })
      setNotice(`Pro is no longer on this device: that email no longer has ${PRO_NAME} or current lessons.`)
      logEvent('tools_pro_removed_on_recheck')
    })
    return () => { live = false }
  }, [])

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
      // Rows are 52px with an 8px gap.
      const rows = Math.max(1, Math.floor((entry.contentRect.height + 8) / 60))
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
    const choice = LEVEL_CHOICES.find(c => c.key === key)
    if (choice?.pro && !isPro) return openPro(`${choice.name} is part of Pro.`)
    setLevelKey(key)
    write(KEYS.levels, key)
    // Level 5 is compound time: it brings 6/8 with it. Leaving it from a
    // compound metre goes back to 4/4. 7/8 keeps both kinds of dice.
    if (choice.compound && !metre.compound && metre.id !== '7/8') switchMetre('6/8', key)
    else if (!choice.compound && metre.compound) switchMetre('4/4', key)
  }

  // ----- Pro -----

  function openPro(reason = '') {
    setProSheet({ reason })
    logEvent('tools_pro_sheet_open', { reason: reason ? 'gate' : 'manage' })
  }

  const closePro = useCallback(() => setProSheet(null), [])

  function removePro() {
    signOut(safeStorage)
    setPro(readToolsPro(safeStorage))
    if (levelChoice.pro) {
      setLevelKey('L1')
      write(KEYS.levels, 'L1')
    }
    if (metre.pro) {
      setMetreId('4/4')
      write(KEYS.metre, '4/4')
      setFaces(rollBar(slotPool(['L1']), METRES['4/4']))
      setLocked(unlockedAll(4))
    }
    setProSheet(null)
    setNotice('Pro removed from this device.')
    logEvent('tools_pro_removed')
  }

  // Bars that use Level 4 faces need Pro to load, add or play.
  function proGate(barFaces) {
    if (isPro || !barFaces || !needsPro(barFaces)) return false
    openPro('This bar uses Level 4, which is part of Pro.')
    return true
  }

  function chooseView(next) {
    setView(next)
    write(KEYS.view, next)
  }

  // A new metre is a new set of dice: roll a fresh bar, nothing locked.
  // Compound and 7/8 need Pro. A compound metre selects Level 5.
  function chooseMetre(id) {
    if (busy || id === metreId || !METRES[id]) return
    if (METRES[id].pro && !isPro) return openPro(`${id} is part of Pro, with compound time and Level 5.`)
    let level = levelKey
    if (METRES[id].compound) level = 'L5'
    else if (levelChoice.compound && id !== '7/8') level = 'L1'
    if (level !== levelKey) {
      setLevelKey(level)
      write(KEYS.levels, level)
    }
    switchMetre(id, level)
  }

  function switchMetre(id, level = levelKey) {
    const m = METRES[id]
    const choice = LEVEL_CHOICES.find(c => c.key === level)
    const simple = choice.compound ? AVAILABLE_LEVEL_IDS : levelIdsFor(choice, isPro)
    const simplePool = slotPool(id === '7/8' && !['L1', 'L2', 'L3'].includes(level) ? AVAILABLE_LEVEL_IDS : simple)
    const compoundPool = slotPool(['L5'])
    setMetreId(id)
    write(KEYS.metre, id)
    setFaces(rollBar(i => (m.dieTicks[i] === 18 ? compoundPool : simplePool), m))
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
    // Which die is sounding: by tick, so uneven groups (7/8) light correctly.
    const spt = secondsPerTick(s.metre, s.bpm)
    const dieFor = intoBar => dieAt(s.metre, Math.max(0, Math.floor(intoBar / spt + 1e-6)) % barTicks(s.metre)).die
    if (t < s.firstBar) {
      setBeatLight({ beat: dieFor(Math.max(0, t - s.startTime) % s.barSec), countIn: true })
    } else {
      const bar = Math.floor((t - s.firstBar) / s.barSec)
      const intoBar = (t - s.firstBar) - bar * s.barSec
      setBeatLight({ beat: dieFor(intoBar), countIn: false })
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
    const s = { metre, shownBar: -1, ...session, startTime }
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

  // Per-bar scoring for Once, Repeat and Read ahead. Once and Repeat replay
  // `bars[0]` every pass; in Read ahead `bars[k]` is the bar played on pass k,
  // each next bar rolled as the previous starts.
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
      while (s.scored < passes && barReadyToScore(mode, bars, s.scored) && t > s.firstBar + endOf(s.scored) + 0.03) {
        const k = s.scored
        const barStart = s.firstBar + k * barSec
        const lo = k === 0 ? -LEAD_IN : endOf(k - 1) - k * barSec
        const hi = endOf(k) - k * barSec
        const rel = s.taps.map(tap => tap - barStart).filter(x => x >= lo && x < hi)
        const expected = expectedFor(k)
        const result = scoreBar(expected, rel)
        setOutcome({ result, reflection: reflect(result), expected, barSec, pass: k, loop: passes > 1, metre, bars: 1, taps: rel, lag: detectLag(expected, rel) })
        if (passes === 1) setStage('result')
        logEvent('rhythm_dice_scored', { bpm, metre: metreId, mode, accuracy: Math.round(result.accuracy * 100), allRest: result.allRest })
        s.scored += 1
      }
      if (s.scored >= passes) stopSession()
    }
  }

  // ----- phrase -----

  function addToPhrase(barFaces, barMetreId) {
    if (busy || proGate(barFaces)) return
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
    if (!isPro && phraseBars.some(needsPro)) return void openPro('This phrase uses Level 4, which is part of Pro.')
    setNotice('')
    setOutcome(null)
    setStage('play')
    setPhase(listen ? 'listening' : 'performing')
    const m = phraseMetre
    const n = phraseBars.length
    const barSec = barSeconds(m, bpm)
    const s = await startSession(
      { kind: listen ? 'listen' : 'phrase', bpm, barSec, metre: m, taps: [], latency: (latencyMs ?? 0) / 1000 },
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
        setOutcome({ result, reflection: reflect(result), expected, barSec: total, pass: 0, loop: false, metre: m, bars: n, taps: rel, lag: detectLag(expected, rel) })
        setStage('result')
        logEvent('rhythm_dice_phrase_scored', { bpm, bars: n, metre: m.id, accuracy: Math.round(result.accuracy * 100) })
      }
      stopSession()
    }
  }

  // ----- classroom -----

  // Projector view: one big die per group. Play counts in, then loops the bar
  // with clicks while each group's die lights on its beat.
  async function classroomPlay() {
    if (busy) return
    setPhase('listening')
    const barSec = barSeconds(metre, bpm)
    const s = await startSession(
      { kind: 'listen', bpm, barSec },
      startTime => createPassSource({ faces, metre, bpm, startTime, subdivision, passes: Infinity }),
    )
    if (!s) setPhase('idle')
    logEvent('rhythm_dice_classroom_play', { metre: metreId, bpm })
  }

  function openClassroom() {
    setClassroom(true)
    logEvent('rhythm_dice_classroom_open', { metre: metreId })
  }

  const closeClassroom = useCallback(() => {
    stopSession()
    setClassroom(false)
  }, [stopSession])

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
      { kind: 'calibrate', bpm: CALIBRATION_BPM, barSec: beatSec * 4, metre: METRES['4/4'], rawTaps: [] },
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

  // The device's delay, spotted in a take (see detectLag): fold it into this
  // device's calibration and re-score the take with it.
  function allowForLag() {
    const o = outcome
    if (!o?.lag) return
    const ms = Math.round(Math.max(-100, Math.min(400, (latencyMs ?? 0) + o.lag * 1000)))
    const applied = (ms - (latencyMs ?? 0)) / 1000
    setLatencyMs(ms)
    write(KEYS.latency, ms)
    if (sessionRef.current) sessionRef.current.latency = ms / 1000
    const taps = o.taps.map(t => t - applied)
    const result = scoreBar(o.expected, taps)
    setOutcome({ ...o, taps, result, reflection: reflect(result), lag: null })
    setNotice(`This device now allows for ${Math.abs(ms)} ms. Calibrate any time to fine-tune it.`)
    logEvent('rhythm_dice_lag_allowed', { ms })
  }

  function resetCalibration() {
    remove(KEYS.latency)
    setLatencyMs(null)
    setNotice('Calibration cleared.')
  }

  // ----- settings -----

  useEffect(() => { audio.setVolume('tap', tapVolume) }, [audio, tapVolume])
  useEffect(() => { audio.setVolume('click', clickVolume) }, [audio, clickVolume])

  function chooseTapSound(on) {
    setTapSound(on)
    write(KEYS.tapSound, on ? 'on' : 'off')
    if (on) audio.preview('tap').catch(() => {})
  }

  function chooseVolume(kind, value, { preview = false } = {}) {
    const v = Math.max(0, Math.min(100, Math.round(Number(value))))
    if (kind === 'tap') { setTapVolume(v); write(KEYS.tapVolume, v) } else { setClickVolume(v); write(KEYS.clickVolume, v) }
    audio.setVolume(kind, v)
    if (preview) audio.preview(kind).catch(() => {})
  }

  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  // ----- taps -----

  const registerTap = useCallback(event => {
    const s = sessionRef.current
    if (!s || (s.kind !== 'perform' && s.kind !== 'phrase' && s.kind !== 'calibrate')) {
      // Before Perform the pad is an instrument: try a rhythm out, hear it,
      // nothing is scored. The first tap also starts the audio.
      if (tapSoundRef.current) audio.ensure().then(() => audio.tap()).catch(() => {})
      setPadFlash(n => n + 1)
      return
    }
    // Timed from the event's own timestamp, so sounding it first costs nothing.
    if (tapSoundRef.current) audio.tap()
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
    const live = phase === 'performing' || phase === 'calibrating'
    if (!live && stage !== 'play') return
    function onKey(e) {
      if (e.code !== 'Space' && e.key !== ' ') return
      // Off the clock, Space still works its usual way on any other control.
      if (!live && e.target instanceof Element && !e.target.closest('.rd-pad') &&
        e.target.closest('input, textarea, select, button, a, [contenteditable]')) return
      e.preventDefault()
      if (!e.repeat) registerTap(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, stage, registerTap])

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
    if (proGate(loaded)) return
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

  // MusicXML for worksheets and notation apps: free, like MIDI.
  function exportXml(bars, barMetre) {
    try {
      downloadMusicXml(buildMusicXml({ bars, metre: barMetre, bpm }), musicXmlFilename(bars, barMetre))
      setNotice('MusicXML file downloaded. Open it in MuseScore, Sibelius, Dorico or Logic.')
      logEvent('rhythm_dice_musicxml_export', { bars: bars.length, metre: barMetre.id })
    } catch (err) {
      console.error(err)
      setNotice('The MusicXML file could not be made. Try again.')
    }
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
                  aria-label={c.key === 'mix' ? `Mix levels 1 to ${isPro ? 4 : 3}` : c.pro ? `${c.name}${isPro ? '' : ', Pro'}` : `Level ${c.label}`}
                  className={`${levelKey === c.key ? 'is-on' : ''}${c.pro && !isPro ? ' is-pro-locked' : ''}`} onClick={() => chooseLevel(c.key)} disabled={busy}>
                  {c.key !== 'mix' && <span className="rd-long" aria-hidden="true">Level </span>}{c.label}
                </button>
              ))}
            </div>
            {/* Phones: one compact picker instead of six buttons. */}
            <label className="rd-level-pick">
              <span className="rd-visually-hidden">Dice level</span>
              <select value={levelKey} onChange={e => chooseLevel(e.target.value)} disabled={busy}>
                {LEVEL_CHOICES.map(c => (
                  <option key={c.key} value={c.key}>
                    {c.key === 'mix' ? 'Mix levels' : `Level ${c.label}`}{c.pro && !isPro ? ' · Pro' : ''}
                  </option>
                ))}
              </select>
            </label>
            {isPro && (
              <button type="button" className="rd-pro-chip" onClick={() => openPro()} aria-label="Pro is on for this device. Manage">Pro</button>
            )}
            <button type="button" className="rd-classroom-btn" onClick={openClassroom} disabled={busy}>Classroom</button>
            <button type="button" className="rd-view-toggle" onClick={() => chooseView(view === 'notes' ? 'blocks' : 'notes')}
              aria-label={`Showing ${view === 'notes' ? 'notes' : 'blocks'}. Show ${view === 'notes' ? 'blocks' : 'notes'}`}>
              {view === 'notes' ? 'Notes' : 'Blocks'}
            </button>
            <div className="rd-seg rd-head__view" role="radiogroup" aria-label="Show dice as">
              {[['notes', 'Notes'], ['blocks', 'Blocks']].map(([v, label]) => (
                <button key={v} type="button" role="radio" aria-checked={view === v}
                  className={view === v ? 'is-on' : ''} onClick={() => chooseView(v)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="rd-settings-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings: tap sound and volume">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)" />
              </svg>
            </button>
          </div>
        </header>

        <section className="rd-tray" aria-label={`Dice: one bar of ${shownMetre.id}`}>
          {/* The time signature is the metre control: tap it to choose. */}
          <label className="rd-tray__meter" title="Time signature">
            <span aria-hidden="true"><span>{shownMetre.timeSignature[0]}</span><span>{shownMetre.timeSignature[1]}</span></span>
            {shownMetre.grouping && <span className="rd-tray__grouping">{shownMetre.grouping}</span>}
            <span className="rd-visually-hidden">Time signature</span>
            <select id="rd-metre" value={metreId} onChange={e => chooseMetre(e.target.value)} disabled={busy}>
              <optgroup label="Simple time">
                {SIMPLE_METRE_IDS.map(id => <option key={id} value={id}>{id}</option>)}
              </optgroup>
              <optgroup label={isPro ? 'Compound and odd time' : 'Compound and odd time · Pro'}>
                {[...COMPOUND_METRE_IDS, '7/8'].map(id => <option key={id} value={id}>{id}{isPro ? '' : ' · Pro'}</option>)}
              </optgroup>
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
                      <DieFace key={`${i}-${f.id}`} face={f} view={view} size="next"
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
              <Results outcome={outcome} onAllowLag={allowForLag} />
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
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => exportBar(faces, bpm, metre)}>MIDI</button>
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => exportXml([faces], metre)}>MusicXML</button>
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
                        {kf ? <BarStrip faces={kf} /> : <span className="rd-kept__missing">Faces missing</span>}
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
                        ? <BarStrip faces={bar} label={`Bar ${i + 1}: ${bar.map(f => f.name).join(', ')}`} />
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
                <button type="button" className="rd-btn rd-btn--quiet" onClick={() => exportXml(phraseBars, phraseMetre)} disabled={!phraseBars.length}>MusicXML</button>
                <button type="button" className="rd-btn rd-btn--ghost" onClick={clearPhrase} disabled={!phrase.bars.length}>Clear</button>
              </div>
            </div>
          )}
        </section>

        {notice && <p className="rd-notice" role="status">{notice}</p>}

        {classroom && (
          <ClassroomView
            faces={faces}
            metre={metre}
            view={view}
            bpm={bpm}
            busy={busy}
            playing={phase === 'listening'}
            beatLight={beatLight}
            onRoll={reroll}
            onHear={hearIt}
            onPlay={classroomPlay}
            onStop={stopSession}
            onTempo={setBpm}
            onClose={closeClassroom}
          />
        )}

        <BottomSheet isOpen={settingsOpen} onClose={closeSettings} eyebrow="Rhythm Dice" title="Settings">
          <div className="rd-settings">
            <div className="rd-settings__row">
              <div>
                <p className="rd-settings__label" id="rd-set-tap">Tap sound</p>
                <p className="rd-settings__hint">A clap each time you tap the pad or press Space.</p>
              </div>
              <div className="rd-seg rd-seg--small" role="radiogroup" aria-labelledby="rd-set-tap">
                {[[true, 'On'], [false, 'Off']].map(([on, label]) => (
                  <button key={label} type="button" role="radio" aria-checked={tapSound === on}
                    className={tapSound === on ? 'is-on' : ''} onClick={() => chooseTapSound(on)}>{label}</button>
                ))}
              </div>
            </div>
            {[
              ['tap', 'Tap volume', tapVolume, !tapSound],
              ['click', 'Metronome volume', clickVolume, false],
            ].map(([kind, label, value, off]) => (
              <div key={kind} className={`rd-settings__volume${off ? ' is-off' : ''}`}>
                <label className="rd-settings__label" htmlFor={`rd-vol-${kind}`}>{label}</label>
                <div className="rd-tempo">
                  <button type="button" className="rd-step" disabled={off || value <= 0}
                    onClick={() => chooseVolume(kind, value - 10, { preview: true })} aria-label={`${label} down`}>−</button>
                  <input id={`rd-vol-${kind}`} type="range" min="0" max="100" step="1" value={value} disabled={off}
                    onChange={e => chooseVolume(kind, e.target.value)}
                    onPointerUp={() => audio.preview(kind).catch(() => {})}
                    onKeyUp={e => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') audio.preview(kind).catch(() => {}) }}
                    aria-valuetext={value === 0 ? 'Muted' : `${value} percent`} />
                  <button type="button" className="rd-step" disabled={off || value >= 100}
                    onClick={() => chooseVolume(kind, value + 10, { preview: true })} aria-label={`${label} up`}>+</button>
                  <output className="rd-tempo__value rd-settings__value" htmlFor={`rd-vol-${kind}`}>{value === 0 ? 'Mute' : value}</output>
                </div>
              </div>
            ))}
            <button type="button" className="rd-link rd-settings__reset"
              disabled={tapSound && tapVolume === DEFAULT_VOLUME && clickVolume === DEFAULT_VOLUME}
              onClick={() => { chooseTapSound(true); chooseVolume('tap', DEFAULT_VOLUME); chooseVolume('click', DEFAULT_VOLUME) }}>
              Reset to defaults
            </button>
          </div>
        </BottomSheet>

        <ToolsProSheet isOpen={!!proSheet} onClose={closePro} prefix="rd" toolName="Rhythm Dice" lockedTitle="Unlock Level 4"
          reason={proSheet?.reason ?? ''} pro={pro} onUnlocked={() => setPro(readToolsPro(safeStorage))} onRemove={removePro}
          doneText="Level 4 (triplets) is open, and Mix now includes it. Kept bars and phrases that use it play as normal."
          doneAction={{ label: 'Try Level 4', onClick: () => { closePro(); setLevelKey('L4'); write(KEYS.levels, 'L4') } }} />
      </div>
    </ToolShell>
  )
}

