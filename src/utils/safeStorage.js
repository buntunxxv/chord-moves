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

export const safeStorage = {
  getItem(key) {
    if (store) {
      try { return store.getItem(key) } catch { /* fall through */ }
    }
    return memory.has(key) ? memory.get(key) : null
  },
  setItem(key, value) {
    if (store) {
      try { store.setItem(key, String(value)); return } catch { /* quota or revoked */ }
    }
    memory.set(key, String(value))
  },
  removeItem(key) {
    if (store) {
      try { store.removeItem(key) } catch { /* ignore */ }
    }
    memory.delete(key)
  },
}
