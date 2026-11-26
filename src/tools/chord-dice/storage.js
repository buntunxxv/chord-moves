// Chord Dice keeps its settings and kept chords under kyndaTools.chordDice.*
// on the Tools origin. safeStorage falls back to memory when storage is
// blocked, so the tool still works for the visit.
import { safeStorage } from '../../utils/safeStorage.js'
import { DICE, L2_ROOTS, resolveChord } from './faces.js'

const PREFIX = 'kyndaTools.chordDice.'
export const KEYS = {
  level: PREFIX + 'level',
  start: PREFIX + 'start',
  kept: PREFIX + 'keptChords',
}
export const REASON_MAX = 120
// How a round starts: build it from the name or the sound (PR 1), or hear
// it and choose the dice, or read its notes and name it (PR 5).
export const STARTS = ['name', 'sound', 'hear', 'read']

export function readString(key, fallback, allowed, store = safeStorage) {
  const raw = store.getItem(key)
  return raw !== null && (!allowed || allowed.includes(raw)) ? raw : fallback
}

export function write(key, value, store = safeStorage) {
  store.setItem(key, String(value))
}

// A kept chord:
//   { id, keptAt, root, quality, colour, symbol, start: 'name'|'sound',
//     replays, revealed, reason, levelKey, changedFrom: { die, symbol }|null,
//     bass: 'root'|'3'|'5'|'2' }
// The reason is required and short; everything else comes from the roll.
export function makeKept(chord, { start, replays, revealed, reason, levelKey, changedFrom = null, now = new Date() }) {
  const trimmed = String(reason ?? '').trim().slice(0, REASON_MAX)
  if (!trimmed) throw new Error('A kept chord needs a reason')
  if (!STARTS.includes(start)) throw new Error(`Unknown start ${start}`)
  return {
    id: String(now.getTime()),
    keptAt: now.toISOString(),
    root: chord.root,
    quality: chord.quality,
    colour: chord.colour,
    bass: chord.bass?.degree ?? 'root',
    symbol: chord.symbol,
    start,
    replays: start === 'sound' || start === 'hear' ? Math.max(0, Math.floor(Number(replays) || 0)) : 0,
    revealed: Boolean(revealed),
    reason: trimmed,
    levelKey: levelKey ?? null,
    changedFrom: changedFrom ? { die: changedFrom.die, symbol: changedFrom.symbol } : null,
  }
}

// Older shapes, read as today's dice:
// - before 25 Nov (PR 2 review) sus chords were quality "sus" with the
//   suspension on the Colour die;
// - before 26 Nov, sevenths and ninths were major + 7 (a dominant seventh)
//   and major + maj7. Now major + 7 is a major seventh and dominant is a
//   quality; the stored symbol says which chord was meant.
function migrate(k) {
  if (!k) return k
  if (k.quality === 'sus' && (k.colour === 'sus2' || k.colour === 'sus4')) return { ...k, quality: k.colour, colour: 'none' }
  if (k.quality === 'major' && (k.colour === 'maj7' || k.colour === 'maj9')) return { ...k, colour: k.colour.slice(3) }
  if (k.quality === 'major' && (k.colour === '7' || k.colour === '9') && typeof k.symbol === 'string' && !k.symbol.includes('maj')) return { ...k, quality: 'dom' }
  return k
}

// A face combination that makes a real chord.
function exists(k) {
  try { resolveChord({ root: k.root, quality: k.quality, colour: k.colour ?? 'none', bass: k.bass ?? 'root' }); return true } catch { return false }
}

// Only well-formed items survive a read: a bad or foreign entry is dropped
// rather than breaking the list.
export function parseKept(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.map(migrate).filter(k => k
      && typeof k.id === 'string'
      && L2_ROOTS.includes(k.root)
      && exists(k)
      && STARTS.includes(k.start)
      && typeof k.reason === 'string' && k.reason.trim())
      .map(k => ({
        ...k,
        colour: k.colour ?? 'none',
        bass: k.bass ?? 'root',
        replays: Math.max(0, Math.floor(Number(k.replays) || 0)),
        revealed: k.revealed === true,
        changedFrom: k.changedFrom && DICE.includes(k.changedFrom.die) && typeof k.changedFrom.symbol === 'string'
          ? { die: k.changedFrom.die, symbol: k.changedFrom.symbol }
          : null,
      }))
  } catch {
    return []
  }
}

export const serialiseKept = list => JSON.stringify(list)
export const readKept = (store = safeStorage) => parseKept(store.getItem(KEYS.kept))
export const writeKept = (list, store = safeStorage) => store.setItem(KEYS.kept, serialiseKept(list))
export const keptChord = k => resolveChord(k)
