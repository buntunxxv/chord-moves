// The Web Audio lookahead pattern from the Metronome (src/tools/metronome/
// useMetronome.js), pulled out of React so other tools can share it and so
// it can be tested without a browser.
//
// Every LOOKAHEAD_MS, anything due within the next SCHEDULE_AHEAD_SECONDS
// is handed to `schedule`, which books it on the audio clock. Timing comes
// from the audio clock, never from the timer, so a late timer tick costs
// nothing as long as it lands inside the horizon.
//
// `source` is a pull iterator: next() returns the next event ({ time, ... },
// time in audio-clock seconds) or null when there is nothing more. Events
// must come out in time order. Looping sources can generate forever.
//
// The Metronome still runs its own copy of this loop; moving it onto this
// module is left for a later change so PR 1 leaves it untouched.

export const LOOKAHEAD_MS = 25
export const SCHEDULE_AHEAD_SECONDS = 0.1

export function createLookaheadScheduler({
  clock,
  source,
  schedule,
  onDone,
  lookaheadMs = LOOKAHEAD_MS,
  aheadSeconds = SCHEDULE_AHEAD_SECONDS,
  setIntervalFn = (fn, ms) => setInterval(fn, ms),
  clearIntervalFn = id => clearInterval(id),
}) {
  let timer = null
  let pending = null
  let finished = false

  function pump() {
    const horizon = clock() + aheadSeconds
    for (;;) {
      if (!pending && !finished) {
        pending = source.next()
        if (!pending) finished = true
      }
      if (!pending || pending.time >= horizon) break
      schedule(pending)
      pending = null
    }
    if (finished && !pending) {
      stop()
      onDone?.()
    }
  }

  function start() {
    if (timer !== null) return
    finished = false
    pending = null
    timer = setIntervalFn(pump, lookaheadMs)
    pump()
  }

  function stop() {
    if (timer === null) return
    clearIntervalFn(timer)
    timer = null
  }

  return { start, stop, pump, get running() { return timer !== null } }
}

// Grid time of every click: `count` clicks, `interval` seconds apart, from
// `startTime`. Computed by multiplication, not repeated addition, so error
// never accumulates over a long run.
export function gridTimes(startTime, interval, count) {
  return Array.from({ length: count }, (_, i) => startTime + i * interval)
}
