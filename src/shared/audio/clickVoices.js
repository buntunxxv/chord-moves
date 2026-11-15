// Short percussive voices booked at an exact audio-clock time. Each works on
// a live AudioContext or an OfflineAudioContext, which is how the click
// precision check renders them without speakers.

// The Metronome's click: a 2 ms attack to the peak, so the sound starts on
// the scheduled sample. `level`: 'accent' (downbeat), 'beat', or 'sub'
// (subdivision, quieter and lower).
export function scheduleClick(context, time, level = 'beat', destination = context.destination) {
  const freq = level === 'accent' ? 1320 : level === 'sub' ? 620 : 760
  const peak = level === 'accent' ? 0.34 : level === 'sub' ? 0.08 : 0.2
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045)
  oscillator.connect(gain)
  gain.connect(destination)
  oscillator.start(time)
  oscillator.stop(time + 0.05)
  oscillator.onended = () => {
    oscillator.disconnect()
    gain.disconnect()
  }
}

const noiseBuffers = new WeakMap()

function noiseBuffer(context) {
  let buffer = noiseBuffers.get(context)
  if (!buffer) {
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.25), context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    noiseBuffers.set(context, buffer)
  }
  return buffer
}

// A hand clap: three quick band-passed noise bursts and a short tail, so
// "hear it first" sounds like the clap the student is about to play.
export function scheduleClap(context, time, destination = context.destination) {
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1400
  filter.Q.value = 0.9
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, time)
  for (const [at, peak] of [[0, 0.9], [0.011, 0.7], [0.022, 0.8]]) {
    gain.gain.exponentialRampToValueAtTime(peak, time + at + 0.001)
    gain.gain.exponentialRampToValueAtTime(0.15, time + at + 0.009)
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16)
  const src = context.createBufferSource()
  src.buffer = noiseBuffer(context)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(destination)
  src.start(time)
  src.stop(time + 0.17)
  src.onended = () => {
    src.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
}
