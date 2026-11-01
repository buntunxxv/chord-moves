// Plays the live demo: runs each chapter's script against the real app inside
// the demo frame, finding controls by the names people see (and screen readers
// hear), so the demo follows the UI as it changes. No DOM access happens here
// except through the `frame` adapter, so the player logic is testable in Node.

export class Cancelled extends Error {
  constructor() { super('cancelled'); this.name = 'Cancelled' }
}

const normalise = text => (text || '').replace(/\s+/g, ' ').trim()

// What a control is called: its aria-label if it has one, else its text.
export function accessibleName(el) {
  return normalise(el.getAttribute?.('aria-label') || el.textContent)
}

export function matchesName(name, matcher) {
  return matcher instanceof RegExp ? matcher.test(name) : name === matcher
}

// Starts at chord-name `chord` and isn't a longer chord name: "G" matches
// "G Moves forward" but not "G7 Tension" or "Gm Darker".
export function chordPattern(chord) {
  const escaped = chord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}(?![a-z0-9♯♭#/])`)
}

/*
 * createPlayer drives a list of chapters. Each chapter is
 *   { id, title, caption, run(d) }
 * and `run` is an async script of steps on `d` (see makeStepper). The player:
 *   play(i)    from chapter i: fresh app, earlier chapters replayed instantly
 *              (fast mode: no pauses, no sound), then i onward at normal pace
 *   pause() / resume()
 *   stop()
 * and reports { chapter, status, error } through onChange, where status is
 * 'playing' | 'paused' | 'ended' | 'error' | 'idle'.
 *
 * `frame` adapts the real page: reset(), find(matcher, opts), tap(el), and
 * showTap(el). `clock` is { now(), sleep(ms) }, swappable in tests.
 */
export function createPlayer({ chapters, frame, onChange = () => {}, clock = realClock }) {
  let token = null
  let paused = false
  let state = { chapter: 0, status: 'idle', error: null }

  const set = patch => {
    state = { ...state, ...patch }
    onChange(state)
  }

  // Sleeps `ms` of playing time: the clock stands still while paused, and a
  // newer play() or stop() cancels the wait.
  async function wait(own, ms) {
    let left = ms
    while (left > 0) {
      if (own.cancelled) throw new Cancelled()
      const step = Math.min(left, 50)
      const before = clock.now()
      await clock.sleep(step)
      if (!paused) left -= clock.now() - before
    }
    if (own.cancelled) throw new Cancelled()
  }

  async function waitUntilPlaying(own) {
    while (paused) {
      if (own.cancelled) throw new Cancelled()
      await clock.sleep(50)
    }
  }

  function makeStepper(own, fast) {
    const d = {
      fast,
      wait: ms => wait(own, fast ? 0 : ms),
      async find(matcher, opts = {}) {
        const deadline = clock.now() + (opts.timeout ?? 4000)
        for (;;) {
          if (own.cancelled) throw new Cancelled()
          const el = frame.find(matcher, opts)
          if (el) return el
          if (clock.now() > deadline) {
            throw new Error(`Demo step could not find ${opts.role || 'button'} “${String(matcher)}”`)
          }
          await clock.sleep(50)
        }
      },
      has: (matcher, opts = {}) => Boolean(frame.find(matcher, opts)),
      // Show where the tap lands, then tap. Steps marked `sound` only make
      // noise, so a fast replay skips them.
      async tap(matcher, opts = {}) {
        if (fast && opts.sound) return
        await waitUntilPlaying(own)
        const el = await d.find(matcher, opts)
        if (!fast) {
          frame.showTap(el)
          await wait(own, 280)
        }
        frame.tap(el)
        await d.wait(opts.after ?? 900)
        if (fast) await clock.sleep(30) // let the app re-render between taps
      },
    }
    return d
  }

  async function play(index) {
    if (token) token.cancelled = true
    const own = { cancelled: false }
    token = own
    paused = false
    try {
      set({ chapter: index, status: 'playing', error: null })
      await frame.reset()
      for (let i = 0; i < index; i++) await chapters[i].run(makeStepper(own, true))
      for (let i = index; i < chapters.length; i++) {
        if (own.cancelled) throw new Cancelled()
        set({ chapter: i, status: paused ? 'paused' : 'playing' })
        await chapters[i].run(makeStepper(own, false))
      }
      await wait(own, 400)
      set({ status: 'ended' })
    } catch (error) {
      if (error instanceof Cancelled) return
      set({ status: 'error', error: error.message })
    }
  }

  return {
    play,
    pause() {
      if (state.status !== 'playing') return
      paused = true
      set({ status: 'paused' })
    },
    resume() {
      if (state.status !== 'paused') return
      paused = false
      set({ status: 'playing' })
    },
    stop() {
      if (token) token.cancelled = true
      paused = false
    },
    get state() { return state },
  }
}

const realClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
}
