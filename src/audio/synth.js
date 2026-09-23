import * as Tone from 'tone'

// Use the playback audio session on iOS so sound follows the device volume
// rather than the ringer/silent switch (requires iOS 16.4+; no-op elsewhere).
// Must be called from every place that starts audio, not just one -- iOS
// only applies this once a session type has been set at all.
export async function startAudioContext() {
  if (navigator.audioSession) {
    navigator.audioSession.type = 'playback'
  }
  await Tone.start()
}

// Single shared "keys" patch — an FM electric-piano style tone instead of a
// plain oscillator, so chords played by the app don't sound like an 8-bit blip.
//
// harmonicity 1 keeps every partial a clean integer multiple of the
// fundamental (no bell-like inharmonicity), and a low modulation index adds
// just enough overtone to sound like a struck tine rather than a flute. The
// dark lowpass filter and a low-dampening (dark-tailed) reverb roll off the
// top end for warmth; a slow, deep chorus adds body/movement rather than
// shimmer.
export function createKeysSynth() {
  const chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 4, depth: 0.45, wet: 0.28 }).start()
  const filter = new Tone.Filter({ type: 'lowpass', frequency: 3200, rolloff: -12 })
  const reverb = new Tone.Freeverb({ roomSize: 0.55, dampening: 2200, wet: 0.2 })

  // Stacked chord notes sum in the mix; without anything catching that sum,
  // the peaks clip at 0dBFS and that clipping is the crackling on playback.
  // The compressor pulls the average level up (so chords are audible in
  // loud rooms) while the limiter guarantees the combined peak never clips,
  // which is what lets the base volume sit well above the old -9dB fallback.
  const compressor = new Tone.Compressor({ threshold: -24, ratio: 4, attack: 0.003, release: 0.25 })
  const limiter = new Tone.Limiter(-1).toDestination()

  return new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 1,
    modulationIndex: 2,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.008, decay: 1.3, sustain: 0.22, release: 1.8 },
    modulationEnvelope: { attack: 0.004, decay: 0.4, sustain: 0.02, release: 1.1 },
    volume: -3,
  }).chain(filter, chorus, reverb, compressor, limiter)
}
