import { useCallback, useEffect, useRef, useState } from 'react'
import { watchAudioContext, wakeAudioContext } from '../../shared/audio/wakeAudio.js'

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_SECONDS = 0.1

export function useMetronome({ bpm, beatsPerMeasure, beatUnit }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentBeat, setCurrentBeat] = useState(-1)
  const audioContextRef = useRef(null)
  const timerRef = useRef(null)
  const uiTimersRef = useRef(new Set())
  const nextNoteTimeRef = useRef(0)
  const beatRef = useRef(0)
  const settingsRef = useRef({ bpm, beatsPerMeasure, beatUnit })

  useEffect(() => {
    settingsRef.current = { bpm, beatsPerMeasure, beatUnit }
    beatRef.current %= beatsPerMeasure
  }, [bpm, beatsPerMeasure, beatUnit])

  const clearUiTimers = useCallback(() => {
    uiTimersRef.current.forEach(window.clearTimeout)
    uiTimersRef.current.clear()
  }, [])

  const stop = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    clearUiTimers()
    beatRef.current = 0
    setCurrentBeat(-1)
    setIsPlaying(false)
  }, [clearUiTimers])

  const scheduleClick = useCallback((beat, time) => {
    const context = audioContextRef.current
    if (!context) return

    const isDownbeat = beat === 0
    const isCompoundMidpoint = settingsRef.current.beatsPerMeasure === 6 && beat === 3
    const oscillator = context.createOscillator()
    const gain = context.createGain()

    oscillator.frequency.value = isDownbeat ? 1320 : isCompoundMidpoint ? 980 : 760
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(isDownbeat ? 0.34 : 0.2, time + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(time)
    oscillator.stop(time + 0.05)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }

    const delay = Math.max(0, (time - context.currentTime) * 1000)
    const uiTimer = window.setTimeout(() => {
      setCurrentBeat(beat)
      uiTimersRef.current.delete(uiTimer)
    }, delay)
    uiTimersRef.current.add(uiTimer)
  }, [])

  const runScheduler = useCallback(() => {
    const context = audioContextRef.current
    if (!context) return

    while (nextNoteTimeRef.current < context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const { bpm: liveBpm, beatsPerMeasure: liveBeats, beatUnit: liveBeatUnit } = settingsRef.current
      const beat = beatRef.current
      scheduleClick(beat, nextNoteTimeRef.current)
      beatRef.current = (beat + 1) % liveBeats
      nextNoteTimeRef.current += (60 / liveBpm) * (4 / liveBeatUnit)
    }
  }, [scheduleClick])

  const start = useCallback(async () => {
    if (timerRef.current) return

    if (navigator.audioSession) navigator.audioSession.type = 'playback'
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass()
      watchAudioContext(audioContextRef.current)
    }
    await wakeAudioContext(audioContextRef.current)

    beatRef.current = 0
    nextNoteTimeRef.current = audioContextRef.current.currentTime + 0.05
    setIsPlaying(true)
    runScheduler()
    timerRef.current = window.setInterval(runScheduler, LOOKAHEAD_MS)
  }, [runScheduler])

  const toggle = useCallback(() => {
    if (timerRef.current) stop()
    else start()
  }, [start, stop])

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    clearUiTimers()
    audioContextRef.current?.close()
  }, [clearUiTimers])

  return { isPlaying, currentBeat, start, stop, toggle }
}
