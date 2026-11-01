import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_ORIGIN,
  applyHandover,
  buildHandoverUrl,
  collectAppState,
  readHandover,
  runDomainHandover,
} from './domainHandover.js'

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    get length() { return map.size },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

function fakeWindow(url, storage) {
  const u = new URL(url)
  const calls = { replace: null, replaceState: null }
  return {
    calls,
    localStorage: storage,
    history: { state: null, replaceState: (_s, _t, path) => { calls.replaceState = path } },
    location: {
      hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash,
      replace: to => { calls.replace = to },
    },
  }
}

const SAVED = JSON.stringify([{ name: 'Verse ♭VI', chords: ['A♭', 'B♭', 'Cm'] }])

test('collects only the app\'s own keys', () => {
  const s = memoryStorage({ cm_tier: 'pro', chordMovesSavedProgressions: SAVED, 'kyndaTools.metronome.bpm': '96', other_site: 'x' })
  assert.deepEqual(collectAppState(s), { cm_tier: 'pro', chordMovesSavedProgressions: SAVED, 'kyndaTools.metronome.bpm': '96' })
})

test('round-trips state, including non-ASCII chord names, through the URL', () => {
  const state = { chordMovesSavedProgressions: SAVED, cm_pro_email: 'a@b.co' }
  const url = buildHandoverUrl({ pathname: '/upgrade', search: '?x=1' }, state)
  assert.ok(url.startsWith(`${CANONICAL_ORIGIN}/upgrade?x=1#cm-handover=`))
  assert.deepEqual(readHandover(new URL(url).hash), state)
})

test('no state means a clean URL with no fragment', () => {
  assert.equal(buildHandoverUrl({ pathname: '/', search: '' }, {}), `${CANONICAL_ORIGIN}/`)
})

test('malformed handover is ignored, never throws', () => {
  assert.equal(readHandover('#cm-handover=%%%not-base64'), null)
  assert.equal(readHandover('#cm-handover=' + btoa('[1,2]')), null)
  assert.equal(readHandover('#something-else'), null)
})

test('never overwrites existing data or writes foreign keys', () => {
  const s = memoryStorage({ chordMovesSavedProgressions: '[]' })
  const written = applyHandover(s, { chordMovesSavedProgressions: SAVED, cm_tier: 'pro', evil: 'x', cm_path: 5 })
  assert.deepEqual(written, ['cm_tier'])
  assert.deepEqual(s.dump(), { chordMovesSavedProgressions: '[]', cm_tier: 'pro' })
})

test('old host hands a Chord Moves deep link to the new origin and stops rendering', () => {
  const old = memoryStorage({ cm_tier: 'pro', cm_pro_email: 'a@b.co', chordMovesSavedProgressions: SAVED })
  const oldWin = fakeWindow('https://tools.kyndalearning.co.uk/upgrade', old)
  assert.equal(runDomainHandover(oldWin, old), true)
  assert.ok(oldWin.calls.replace.startsWith(`${CANONICAL_ORIGIN}/upgrade#cm-handover=`))

  const fresh = memoryStorage()
  const newWin = fakeWindow(oldWin.calls.replace, fresh)
  assert.equal(runDomainHandover(newWin, fresh), false)
  assert.deepEqual(fresh.dump(), old.dump())
  assert.equal(newWin.calls.replaceState, '/upgrade')
})

test('old host with blocked storage still moves, without data', () => {
  const win = fakeWindow('https://tools.kyndalearning.co.uk/upgrade', null)
  Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError') } })
  assert.equal(runDomainHandover(win, memoryStorage()), true)
  assert.equal(win.calls.replace, `${CANONICAL_ORIGIN}/upgrade`)
})

test('old host serves the library: root and tools render in place', () => {
  for (const path of ['/', '/tools', '/metronome', '/ear-trainer', '/chord-scales']) {
    const s = memoryStorage({ cm_tier: 'pro' })
    const win = fakeWindow(`https://tools.kyndalearning.co.uk${path}`, s)
    assert.equal(runDomainHandover(win, s), false, path)
    assert.equal(win.calls.replace, null, path)
  }
})

test('new host without a handover does nothing', () => {
  const s = memoryStorage({ cm_tier: 'pro' })
  const win = fakeWindow('https://www.chordmoves.co.uk/#top', s)
  assert.equal(runDomainHandover(win, s), false)
  assert.equal(win.calls.replaceState, null)
  assert.deepEqual(s.dump(), { cm_tier: 'pro' })
})

test('link previews and canonical point at the canonical domain', async () => {
  const { readFileSync } = await import('node:fs')
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const urls = [...html.matchAll(/(?:content|href)="(https:\/\/[^"]+)"/g)].map(m => m[1])
    .filter(u => !u.startsWith('https://fonts.'))
  assert.ok(urls.length >= 4)
  for (const u of urls) assert.ok(u.startsWith(CANONICAL_ORIGIN + '/'), `${u} is not on ${CANONICAL_ORIGIN}`)
})
