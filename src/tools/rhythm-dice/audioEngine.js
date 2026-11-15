// Browser audio for Rhythm Dice: one AudioContext, the shared lookahead
// scheduler, and the conversion from a tap's DOM timestamp to the audio
// clock, so taps and clicks are compared on the same clock.
import { createLookaheadScheduler } from '../../shared/audio/lookaheadScheduler.js'
import { scheduleClap, scheduleClick } from '../../shared/audio/clickVoices.js'

export function createRhythmAudio() {
  let ctx = null
  let scheduler = null

  async function ensure() {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'
    if (!ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) throw new Error('This browser has no Web Audio support')
      ctx = new AudioContextClass({ latencyHint: 'interactive' })
    }
    if (ctx.state !== 'running') await ctx.resume()
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
    const stamp = typeof event?.timeStamp === 'number' && event.timeStamp > 0 ? event.timeStamp : performance.now()
    if (ctx?.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp()
      if (ts && ts.performanceTime > 0) return ts.contextTime + (stamp - ts.performanceTime) / 1000
    }
    return ctx.currentTime - (performance.now() - stamp) / 1000
  }

  // Plays every event from `source` (see timeline.js) until it runs out or
  // stop() is called.
  function play(source, { onDone } = {}) {
    stop()
    scheduler = createLookaheadScheduler({
      clock: () => ctx.currentTime,
      source,
      schedule: event => {
        if (event.kind === 'click') scheduleClick(ctx, event.time, event.level)
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
  }

  return { ensure, now, eventTime, play, stop, close }
}
