// Chord Dice sound: the shared "Keys" synth and effects from
// src/audio/synth.js, used as they are. Chord Dice owns one PolySynth for
// the page and disposes it when the page is left. Every new sound releases
// the last one first, so quick taps and replays never pile up voices.
import * as Tone from 'tone'
import { createKeysSynth, startAudioContext } from '../../audio/synth'

export { targetVoicing, selectionVoicing } from './voicing.js'

// Tells tests (and nothing else) that a sound started. Carries only its kind,
// never the notes, so it can never give an answer away.
const announce = kind => {
  try { window.dispatchEvent(new CustomEvent('chorddice:sound', { detail: { kind } })) } catch { /* no window */ }
}

export function createChordAudio() {
  let synth = null
  const ready = async () => {
    await startAudioContext()
    if (!synth) synth = createKeysSynth()
    return synth
  }
  const hz = midi => Tone.Frequency(midi, 'midi').toFrequency()
  async function play(midis, duration, kind) {
    announce(kind)
    try {
      const s = await ready()
      s.releaseAll()
      s.triggerAttackRelease(midis.map(hz), duration, Tone.now() + 0.02, 0.8)
    } catch (err) {
      console.error('Chord Dice could not play', err)
    }
  }
  return {
    playChord: (midis, kind = 'chord') => play(midis, 1.8, kind),
    playNote: midi => play([midi], 0.6, 'note'),
    stop() { synth?.releaseAll() },
    dispose() {
      try { synth?.dispose() } catch { /* already gone */ }
      synth = null
    },
  }
}
