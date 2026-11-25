// Chord Dice keeps its settings and kept chords under kyndaTools.chordDice.*
// on the Tools origin. safeStorage falls back to memory when storage is
// blocked, so the tool still works for the visit.
import { safeStorage } from '../../utils/safeStorage.js'
import { L2_ROOTS, QUALITIES, COLOURS, resolveChord } from './faces.js'

const PREFIX = 'kyndaTools.chordDice.'
export const KEYS = {
  level: PREFIX + 'level',
  start: PREFIX + 'start',
  kept: PREFIX + 'keptChords',
}
export const REASON_MAX = 120
export const STARTS = ['name', 'sound']

export function readString(key, fallback, allowed, store = safeStorage) {
  const raw = store.getItem(key)
  return raw !== null && (!allowed || allowed.includes(raw)) ? raw : fallback
}

export function write(key, value, store = safeStorage) {
  store.setItem(key, String(value))
}

// A kept chord:
//   { id, keptAt, root, quality, colour, symbol, start: 'name'|'sound',
//     replays, revealed, reason, levelKey }
// The reason is required and short; everything else comes from the roll.
export function makeKept(chord, { start, replays, revealed, reason, levelKey, now = new Date() }) {
  const trimmed = String(reason ?? '').trim().slice(0, REASON_MAX)
  if (!trimmed) throw new Error('A kept chord needs a reason')
  if (!STARTS.includes(start)) throw new Error(`Unknown start ${start}`)
  return {
    id: String(now.getTime()),
    keptAt: now.toISOString(),
    root: chord.root,
    quality: chord.quality,
    colour: chord.colour,
    symbol: chord.symbol,
    start,
    replays: start === 'sound' ? Math.max(0, Math.floor(Number(replays) || 0)) : 0,
    revealed: Boolean(revealed),
    reason: trimmed,
    levelKey: levelKey ?? null,
  }
}

// Only well-formed items survive a read: a bad or foreign entry is dropped
// rather than breaking the list.
export function parseKept(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(k => k
      && typeof k.id === 'string'
      && L2_ROOTS.includes(k.root)
      && QUALITIES[k.quality]
      && COLOURS[k.colour ?? 'none']
      && STARTS.includes(k.start)
      && typeof k.reason === 'string' && k.reason.trim())
      .map(k => ({
        ...k,
        colour: k.colour ?? 'none',
        replays: Math.max(0, Math.floor(Number(k.replays) || 0)),
        revealed: k.revealed === true,
      }))
  } catch {
    return []
  }
}

export const serialiseKept = list => JSON.stringify(list)
export const readKept = (store = safeStorage) => parseKept(store.getItem(KEYS.kept))
export const writeKept = (list, store = safeStorage) => store.setItem(KEYS.kept, serialiseKept(list))
export const keptChord = k => resolveChord(k)
