// Per-device settings and kept bars. Keys live under kyndaTools.rhythmDice.*
// on the Tools origin (safeStorage falls back to memory when storage is
// blocked, so the tool still works for the visit).
import { safeStorage } from '../../utils/safeStorage.js'

const PREFIX = 'kyndaTools.rhythmDice.'
export const KEYS = {
  bpm: PREFIX + 'bpm',
  latency: PREFIX + 'latencyMs',
  kept: PREFIX + 'keptBars',
  view: PREFIX + 'view',
  levels: PREFIX + 'levels',
  drum: PREFIX + 'drum',
  subdivision: PREFIX + 'subdivision',
}

export function readNumber(key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = safeStorage.getItem(key)
  if (raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export function readString(key, fallback, allowed) {
  const raw = safeStorage.getItem(key)
  return raw !== null && (!allowed || allowed.includes(raw)) ? raw : fallback
}

export function write(key, value) {
  safeStorage.setItem(key, String(value))
}

export function remove(key) {
  safeStorage.removeItem(key)
}

// A kept bar: { id, keptAt, faceIds, bpm, levelIds, reason }
export function readKept() {
  try {
    const parsed = JSON.parse(safeStorage.getItem(KEYS.kept) || '[]')
    return Array.isArray(parsed) ? parsed.filter(k => k && Array.isArray(k.faceIds)) : []
  } catch {
    return []
  }
}

export function writeKept(list) {
  safeStorage.setItem(KEYS.kept, JSON.stringify(list))
}
