import test from 'node:test'
import assert from 'node:assert/strict'
import { clearProLogin, setProLogin, shareProLogin } from './proLogin.js'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const BOTH = { cm_tier: 'pro', cm_pro_email: 'a@b.co', 'kyndaTools.pro': 'pro', 'kyndaTools.proEmail': 'a@b.co' }

test('an unlock in either app unlocks both', () => {
  const s = memoryStorage()
  setProLogin(s, 'a@b.co')
  assert.deepEqual(s.dump(), BOTH)
})

test('signing out of either app signs out of both', () => {
  const s = memoryStorage({ ...BOTH, chordMovesSavedProgressions: '[]' })
  clearProLogin(s)
  assert.deepEqual(s.dump(), { chordMovesSavedProgressions: '[]' })
})

test('a Chord Moves login carries to the tools, and back', () => {
  const a = memoryStorage({ cm_tier: 'pro', cm_pro_email: 'a@b.co' })
  assert.equal(shareProLogin(a), 'a@b.co')
  assert.deepEqual(a.dump(), BOTH)
  const b = memoryStorage({ 'kyndaTools.pro': 'pro', 'kyndaTools.proEmail': 'a@b.co' })
  assert.equal(shareProLogin(b), 'a@b.co')
  assert.deepEqual(b.dump(), BOTH)
})

test('a legacy cm_tier with no email is not copied to the tools', () => {
  const s = memoryStorage({ cm_tier: 'pro' })
  assert.equal(shareProLogin(s), null)
  assert.deepEqual(s.dump(), { cm_tier: 'pro' })
})
