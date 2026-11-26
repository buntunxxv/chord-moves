// Moving Chord Moves from www.chordmoves.co.uk to
// tools.kyndalearning.co.uk/chordmoves (26 Nov 2026).
//
// localStorage belongs to one origin, so a plain server redirect would leave
// every returning user's saved progressions, Pro unlock, theme and learn
// progress stranded on chordmoves.co.uk. Instead that host keeps serving
// the app's files, and on load this hands the app's own keys across:
//
//   old host:  collect app keys -> location.replace(new URL + #cm-handover=<data>)
//   new host:  read the fragment -> write the keys -> strip it
//
// The data rides in the URL fragment, which browsers never send to a server,
// so it does not reach request logs.
//
// Who wins when a key exists on both origins:
// - The first handover from a browser: chordmoves.co.uk wins for Chord
//   Moves' own keys. Chord Moves lived there from 31 Oct to 26 Nov, so any
//   Chord Moves copy on tools.kyndalearning.co.uk is from before that and
//   older. The old host then marks itself as handed over.
// - Every later handover (an old bookmark): it only fills gaps, so it never
//   overwrites work done since on the new address.
// - Companion tool keys (kyndaTools.*) always only fill gaps: they have
//   always lived on tools.kyndalearning.co.uk.

import { LEGACY_CHORD_MOVES_HOSTS, TOOLS_ORIGIN, currentPathFor } from '../app/sites.js'

export const CANONICAL_ORIGIN = TOOLS_ORIGIN
export const LEGACY_HOSTS = LEGACY_CHORD_MOVES_HOSTS
// Not an app key, so it is never collected or handed over itself.
export const HANDED_OVER_KEY = 'kynda.handover.done'

const HASH_PREFIX = '#cm-handover='
// Every key the app writes starts with one of these (see safeStorage callers).
const APP_KEY_PREFIXES = ['cm_', 'chordMoves', 'kyndaTools.']
const CHORD_MOVES_PREFIXES = ['cm_', 'chordMoves']

export function isAppKey(key) {
  return typeof key === 'string' && APP_KEY_PREFIXES.some(p => key.startsWith(p))
}

function isChordMovesKey(key) {
  return CHORD_MOVES_PREFIXES.some(p => key.startsWith(p))
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

// `pathname` is the old host's path; it is mapped to where it lives now.
export function buildHandoverUrl({ pathname = '/', search = '' }, state, { prefer = false } = {}) {
  const base = CANONICAL_ORIGIN + currentPathFor(pathname) + search
  if (!state || Object.keys(state).length === 0) return base
  return base + HASH_PREFIX + toBase64Url(JSON.stringify({ prefer: !!prefer, state }))
}

// Returns { prefer, state }, or null if the hash is not a (valid) handover.
// Never throws.
export function readHandover(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(HASH_PREFIX)) return null
  try {
    const parsed = JSON.parse(fromBase64Url(hash.slice(HASH_PREFIX.length)))
    const state = parsed?.state
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null
    return { prefer: parsed.prefer === true, state }
  } catch {
    return null
  }
}

// Writes app keys; returns the keys written. Existing keys are kept unless
// `prefer` is set and the key is one of Chord Moves' own.
export function applyHandover(storage, state, { prefer = false } = {}) {
  const written = []
  for (const [key, value] of Object.entries(state || {})) {
    if (!isAppKey(key) || typeof value !== 'string') continue
    const existing = storage.getItem(key)
    if (existing !== null && !(prefer && isChordMovesKey(key))) continue
    if (existing === value) continue
    storage.setItem(key, value)
    written.push(key)
  }
  return written
}

// Startup hook. Returns true when the page is navigating away (any path on
// an old Chord Moves host), in which case the caller should not render.
export function runDomainHandover(win, storage) {
  const { location, history } = win
  if (LEGACY_HOSTS.includes(location.hostname)) {
    let state = {}
    let prefer = false
    try {
      const local = win.localStorage
      state = collectAppState(local)
      prefer = local.getItem(HANDED_OVER_KEY) === null
      local.setItem(HANDED_OVER_KEY, new Date().toISOString())
    } catch { /* storage blocked: move without data */ }
    location.replace(buildHandoverUrl(location, state, { prefer }))
    return true
  }
  const handover = readHandover(location.hash)
  if (location.hash.startsWith(HASH_PREFIX)) {
    if (handover) applyHandover(storage, handover.state, { prefer: handover.prefer })
    try { history.replaceState(history.state, '', location.pathname + location.search) } catch { /* ignore */ }
  }
  return false
}
