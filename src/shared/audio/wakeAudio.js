// Keeps a page's AudioContext sounding on iPad and iPhone Safari.
//
// After the screen locks, the app is switched away from, another app takes
// the audio (a call, Siri, music), or the tab is hidden, Safari can leave an
// AudioContext "interrupted" -- or worse, report "running" while it plays
// nothing. Code that only resumes a context that isn't "running" then never
// recovers, and the page needs a reload. So every context the tools use is
// watched: once anything may have interrupted it, the next user gesture
// restarts it fully (suspend, then resume), even if it claims to be running.
//
// watchAudioContext(ctx) once per context; wakeAudioContext(ctx) from every
// path that is about to play. A tap or key press anywhere on the page also
// wakes every watched context, inside the gesture Safari requires.

const watched = new Map() // ctx -> { stale: boolean }
let pageListeners = false

export function markAudioInterrupted() {
  for (const state of watched.values()) state.stale = true
}

function onGesture() {
  for (const ctx of watched.keys()) wakeAudioContext(ctx).catch(() => {})
}

function listenToPage() {
  if (pageListeners || typeof document === 'undefined') return
  pageListeners = true
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') markAudioInterrupted() })
  window.addEventListener('pagehide', markAudioInterrupted)
  window.addEventListener('pageshow', markAudioInterrupted)
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(type, onGesture, { capture: true, passive: true })
  }
}

export function watchAudioContext(ctx) {
  if (!ctx || watched.has(ctx)) return
  const state = { stale: false, waking: null }
  watched.set(ctx, state)
  listenToPage()
  ctx.addEventListener?.('statechange', () => {
    // 'interrupted' is Safari's; a suspend we didn't ask for counts too.
    if (ctx.state === 'interrupted' || (ctx.state === 'suspended' && !state.waking)) state.stale = true
    if (ctx.state === 'closed') watched.delete(ctx)
  })
}

export async function wakeAudioContext(ctx) {
  if (!ctx) return
  const state = watched.get(ctx)
  if (!state) {
    if (ctx.state !== 'running') await ctx.resume()
    return
  }
  if (state.waking) return state.waking
  if (!state.stale && ctx.state === 'running') return
  state.waking = (async () => {
    try {
      // "running" after an interruption can be silent: cycle it.
      if (ctx.state === 'running' && state.stale) await ctx.suspend()
      if (ctx.state !== 'closed') await ctx.resume()
      state.stale = ctx.state !== 'running'
    } finally {
      state.waking = null
    }
  })()
  return state.waking
}

// For tests only.
export function _resetWakeAudio() {
  watched.clear()
}
