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

// The crackle on playback was the audio thread missing its deadline, not the
// signal clipping (an offline render of the old chain had no clipping and no
// discontinuities). Every screen that plays chords used to build its own
// filter/chorus/reverb chain, and the reverb was Tone.Freeverb -- 8
// AudioWorklet comb filters that run continuously even in silence. With the
// handful of screens that keep a synth alive, that alone pushed rendering
// below realtime on ordinary hardware. So the effects exist exactly once and
// every synth feeds them, and the reverb is Tone.Reverb, a native convolver
// that costs almost nothing while idle. Measured on the same machine with 8
// synths alive: old design 0.8x realtime (guaranteed dropouts), this 2.2x.
let sharedEffects = null
function getSharedEffects() {
  if (!sharedEffects) {
    const filter = new Tone.Filter({ type: 'lowpass', frequency: 3200, rolloff: -12 })
    const chorus = new Tone.Chorus({ frequency: 0.8, delayTime: 4, depth: 0.45, wet: 0.28 }).start()
    const reverb = new Tone.Reverb({ decay: 1.6, preDelay: 0.01, wet: 0.2 })
    // Compressor lifts average level so chords carry in a loud room; the
    // limiter keeps the summed peak of everything playing under 0dBFS.
    const compressor = new Tone.Compressor({ threshold: -24, ratio: 4, attack: 0.003, release: 0.25 })
    const limiter = new Tone.Limiter(-1).toDestination()
    filter.chain(chorus, reverb, compressor, limiter)
    sharedEffects = filter
  }
  return sharedEffects
}

// "Keys" patch -- an FM electric-piano style tone instead of a plain
// oscillator, so chords played by the app don't sound like an 8-bit blip.
//
// harmonicity 1 keeps every partial a clean integer multiple of the
// fundamental (no bell-like inharmonicity), and a low modulation index adds
// just enough overtone to sound like a struck tine rather than a flute. The
// shared chain's dark lowpass rolls off the top end for warmth, and a slow,
// deep chorus adds body/movement rather than shimmer.
//
// Each caller gets its own PolySynth (so one screen's releaseAll() never cuts
// off another's notes); dispose() on it frees only its voices, and the shared
// effects stay up for the life of the page.
export function createKeysSynth() {
  return new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 1,
    modulationIndex: 2,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.008, decay: 1.3, sustain: 0.22, release: 1.8 },
    modulationEnvelope: { attack: 0.004, decay: 0.4, sustain: 0.02, release: 1.1 },
    volume: -3,
  }).connect(getSharedEffects())
}
