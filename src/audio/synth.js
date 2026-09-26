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

// Every screen that plays chords (piano taps, progression playback, chord
// audition, learn-path prediction, etc.) calls createKeysSynth() to get its
// own instance, and several of those can legitimately sound at once -- e.g.
// tapping a piano key while a progression plays back. Each instance used to
// carry its own compressor+limiter straight to the shared audio destination,
// which caught clipping *within* one instance's stacked chord notes but not
// the sum of several instances' already-limited signals landing on the same
// destination together, which is what still crackled. Routing every instance
// through one shared bus means the combined peak across all simultaneously
// playing chords -- not just each one's own -- never clips.
let masterBus = null
function getMasterBus() {
  if (!masterBus) {
    const compressor = new Tone.Compressor({ threshold: -24, ratio: 4, attack: 0.003, release: 0.25 })
    const limiter = new Tone.Limiter(-1).toDestination()
    compressor.connect(limiter)
    masterBus = compressor
  }
  return masterBus
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

  return new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 1,
    modulationIndex: 2,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.008, decay: 1.3, sustain: 0.22, release: 1.8 },
    modulationEnvelope: { attack: 0.004, decay: 0.4, sustain: 0.02, release: 1.1 },
    volume: -3,
  }).chain(filter, chorus, reverb, getMasterBus())
}
