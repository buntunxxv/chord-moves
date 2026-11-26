// Browser audio for Rhythm Dice: one AudioContext, the shared lookahead
// scheduler, and the conversion from a tap's DOM timestamp to the audio
// clock, so taps and clicks are compared on the same clock.
import { createLookaheadScheduler } from '../../shared/audio/lookaheadScheduler.js'
import { scheduleClap, scheduleClick } from '../../shared/audio/clickVoices.js'
import { watchAudioContext, wakeAudioContext } from '../../shared/audio/wakeAudio.js'

// Volumes run 0-100 on the Settings sheet; DEFAULT_VOLUME is the level the
// voices were tuned at, so the top of the scale leaves a third more headroom.
export const DEFAULT_VOLUME = 75
export const volumeGain = v => Math.max(0, Math.min(100, Number(v) || 0)) / DEFAULT_VOLUME

export function createRhythmAudio() {
  let ctx = null
  let scheduler = null
  // The metronome click and the student's taps each run through their own
  // gain, so their volumes change live, even mid-bar.
  let clickBus = null
  let tapBus = null
  const volumes = { click: DEFAULT_VOLUME, tap: DEFAULT_VOLUME }

  function bus(kind) {
    const node = ctx.createGain()
    node.gain.value = volumeGain(volumes[kind])
    node.connect(ctx.destination)
    return node
  }

  async function ensure() {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) throw new Error('This browser has no Web Audio support')
      ctx = new AudioContextClass({ latencyHint: 'interactive' })
      clickBus = bus('click')
      tapBus = bus('tap')
      watchAudioContext(ctx)
    }
    await wakeAudioContext(ctx)
    return ctx
  }

  function now() {
    return ctx ? ctx.currentTime : 0
  }

  // The audio-clock time a DOM event happened at. getOutputTimestamp pairs
  // the audio time now reaching the speaker with a performance.now() time,
  // so a tap is placed against what the player was actually hearing. The
  // per-device calibration then removes the rest (touch latency).
  function eventTime(event) {
    const now = ctx.currentTime
    // How long ago the event happened. Older Safari can hand back a
    // timestamp on another clock; anything not a recent past moment means
    // "just now".
    const stamp = typeof event?.timeStamp === 'number' ? event.timeStamp : NaN
    let age = (performance.now() - stamp) / 1000
    if (!(age >= 0 && age < 1)) age = 0
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp()
      if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
        const t = ts.contextTime + (performance.now() - age * 1000 - ts.performanceTime) / 1000
        // Only trusted when it lands where it must: a little behind the
        // clock that is rendering now, never ahead of it.
        if (t <= now + 0.02 && t >= now - 1) return t
      }
    }
    // No usable output timestamp: allow for the output latency the browser
    // reports (Safari reports none), then calibration removes the rest.
    const reported = ctx.outputLatency || ctx.baseLatency || 0
    const latency = reported > 0 && reported < 0.5 ? reported : 0
    return now - latency - age
  }


  // The student's own tap, heard the moment it lands: the same clap the dice
  // play with "Hear it", so they hear their rhythm against the click.
  function tap() {
    if (ctx?.state === 'running') scheduleClap(ctx, ctx.currentTime, tapBus)
  }

  // kind: 'click' | 'tap'; volume 0-100. Applied with a short glide so a
  // change mid-bar never clicks.
  function setVolume(kind, volume) {
    volumes[kind] = volume
    const node = kind === 'click' ? clickBus : tapBus
    if (node) node.gain.setTargetAtTime(volumeGain(volume), ctx.currentTime, 0.015)
  }

  // One sound at the current volume, so a change can be heard straight away.
  async function preview(kind) {
    await ensure()
    if (kind === 'click') scheduleClick(ctx, ctx.currentTime + 0.01, 'beat', clickBus)
    else scheduleClap(ctx, ctx.currentTime, tapBus)
  }

  // Plays every event from `source` (see timeline.js) until it runs out or
  // stop() is called.
  function play(source, { onDone } = {}) {
    stop()
    scheduler = createLookaheadScheduler({
      clock: () => ctx.currentTime,
      source,
      schedule: event => {
        if (event.kind === 'click') scheduleClick(ctx, event.time, event.level, clickBus)
        else if (event.kind === 'clap') scheduleClap(ctx, event.time)
      },
      onDone,
    })
    scheduler.start()
  }

  function stop() {
    scheduler?.stop()
    scheduler = null
  }

  function close() {
    stop()
    ctx?.close()
    ctx = null
    clickBus = null
    tapBus = null
  }

  return { ensure, now, eventTime, tap, setVolume, preview, play, stop, close }
}
