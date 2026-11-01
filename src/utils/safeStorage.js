// localStorage that never throws. Browsers can refuse storage outright --
// blocked site data, some private modes, privacy browsers, sandboxed
// WebViews -- and the bare `localStorage` getter (not just setItem) then
// throws, which used to take the whole app down to a blank page. Here every
// call is guarded, and a refused store falls back to memory: preferences
// and progressions last for the visit instead of across visits, but the app
// always renders. Same getItem/setItem/removeItem shape, so it can be passed
// anywhere a Storage is expected.
const memory = new Map()

function backing() {
  try {
    const store = window.localStorage
    const probe = '__cm_storage_probe__'
    store.setItem(probe, probe)
    store.removeItem(probe)
    return store
  } catch {
    return null
  }
}

const store = typeof window === 'undefined' ? null : backing()

// The live demo runs the real app on a throwaway store, so playing it never
// reads or overwrites the viewer's own progressions and settings. Once a
// sandbox starts, every call below goes to it until the page is left.
let sandbox = null

export function startSandbox(seed = {}) {
  sandbox = new Map(Object.entries(seed).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
}

export function inSandbox() {
  return sandbox !== null
}

export const safeStorage = {
  getItem(key) {
    if (sandbox) return sandbox.has(key) ? sandbox.get(key) : null
    if (store) {
      try { return store.getItem(key) } catch { /* fall through */ }
    }
    return memory.has(key) ? memory.get(key) : null
  },
  setItem(key, value) {
    if (sandbox) { sandbox.set(key, String(value)); return }
    if (store) {
      try { store.setItem(key, String(value)); return } catch { /* quota or revoked */ }
    }
    memory.set(key, String(value))
  },
  removeItem(key) {
    if (sandbox) { sandbox.delete(key); return }
    if (store) {
      try { store.removeItem(key) } catch { /* ignore */ }
    }
    memory.delete(key)
  },
}
