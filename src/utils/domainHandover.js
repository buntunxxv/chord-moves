// Moving Chord Moves from tools.kyndalearning.co.uk to www.chordmoves.co.uk.
//
// localStorage belongs to one origin, so a plain server redirect would leave
// every returning user's saved progressions, Pro unlock, theme and learn
// progress stranded on the old host. Instead the old host keeps serving the
// app, and on load this hands the app's own keys across:
//
//   old host:  collect app keys -> location.replace(new origin + #cm-handover=<data>)
//   new host:  read the fragment -> write keys that are not already set -> strip it
//
// The data rides in the URL fragment, which browsers never send to a server,
// so it does not reach request logs. Keys already present on the new origin
// win: a handover link can fill gaps but never overwrite someone's work.
//
// Once the old host has been handing over long enough that returning users
// have passed through, it can become a plain 308 redirect in Vercel.

export const CANONICAL_ORIGIN = 'https://www.chordmoves.co.uk'
export const LEGACY_HOSTS = ['tools.kyndalearning.co.uk']

const HASH_PREFIX = '#cm-handover='
// Every key the app writes starts with one of these (see safeStorage callers).
const APP_KEY_PREFIXES = ['cm_', 'chordMoves', 'kyndaTools.']

export function isAppKey(key) {
  return typeof key === 'string' && APP_KEY_PREFIXES.some(p => key.startsWith(p))
}

// `storage` must be a real Storage (needs length/key), not safeStorage.
export function collectAppState(storage) {
  const state = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!isAppKey(key)) continue
    const value = storage.getItem(key)
    if (value !== null) state[key] = value
  }
  return state
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded) {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)))
}

export function buildHandoverUrl({ pathname = '/', search = '' }, state) {
  const base = CANONICAL_ORIGIN + pathname + search
  if (!state || Object.keys(state).length === 0) return base
  return base + HASH_PREFIX + toBase64Url(JSON.stringify(state))
}

// Returns the handed-over key/value map, or null if the hash is not a
// (valid) handover. Never throws.
export function readHandover(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(HASH_PREFIX)) return null
  try {
    const parsed = JSON.parse(fromBase64Url(hash.slice(HASH_PREFIX.length)))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

// Writes app keys that are missing here; returns the keys written.
export function applyHandover(storage, state) {
  const written = []
  for (const [key, value] of Object.entries(state || {})) {
    if (!isAppKey(key) || typeof value !== 'string') continue
    if (storage.getItem(key) !== null) continue
    storage.setItem(key, value)
    written.push(key)
  }
  return written
}

// Startup hook. Returns true when the page is navigating away (old host),
// in which case the caller should not render.
export function runDomainHandover(win, storage) {
  const { location, history } = win
  if (LEGACY_HOSTS.includes(location.hostname)) {
    let state = {}
    try { state = collectAppState(win.localStorage) } catch { /* storage blocked: move without data */ }
    location.replace(buildHandoverUrl(location, state))
    return true
  }
  const state = readHandover(location.hash)
  if (location.hash.startsWith(HASH_PREFIX)) {
    if (state) applyHandover(storage, state)
    try { history.replaceState(history.state, '', location.pathname + location.search) } catch { /* ignore */ }
  }
  return false
}
