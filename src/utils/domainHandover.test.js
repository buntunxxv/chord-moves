import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_ORIGIN,
  HANDED_OVER_KEY,
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
const appKeys = dump => Object.fromEntries(Object.entries(dump).filter(([k]) => k !== HANDED_OVER_KEY))

test('the new home is the tools domain', () => {
  assert.equal(CANONICAL_ORIGIN, 'https://tools.kyndalearning.co.uk')
})

test('collects only the app\'s own keys', () => {
  const s = memoryStorage({ cm_tier: 'pro', chordMovesSavedProgressions: SAVED, 'kyndaTools.metronome.bpm': '96', other_site: 'x', [HANDED_OVER_KEY]: 'x' })
  assert.deepEqual(collectAppState(s), { cm_tier: 'pro', chordMovesSavedProgressions: SAVED, 'kyndaTools.metronome.bpm': '96' })
})

test('round-trips state, including non-ASCII chord names, and maps the old path', () => {
  const state = { chordMovesSavedProgressions: SAVED, cm_pro_email: 'a@b.co' }
  const url = buildHandoverUrl({ pathname: '/upgrade', search: '?x=1' }, state, { prefer: true })
  assert.ok(url.startsWith(`${CANONICAL_ORIGIN}/chordmoves/upgrade?x=1#cm-handover=`))
  assert.deepEqual(readHandover(new URL(url).hash), { prefer: true, state })
})

test('no state means a clean URL with no fragment', () => {
  assert.equal(buildHandoverUrl({ pathname: '/', search: '' }, {}), `${CANONICAL_ORIGIN}/chordmoves`)
})

test('malformed handover is ignored, never throws', () => {
  assert.equal(readHandover('#cm-handover=%%%not-base64'), null)
  assert.equal(readHandover('#cm-handover=' + btoa('[1,2]')), null)
  assert.equal(readHandover('#something-else'), null)
})

test('fill-only never overwrites existing data or writes foreign keys', () => {
  const s = memoryStorage({ chordMovesSavedProgressions: '[]' })
  const written = applyHandover(s, { chordMovesSavedProgressions: SAVED, cm_tier: 'pro', evil: 'x', cm_path: 5 })
  assert.deepEqual(written, ['cm_tier'])
  assert.deepEqual(s.dump(), { chordMovesSavedProgressions: '[]', cm_tier: 'pro' })
})

test('prefer overwrites stale Chord Moves keys but never companion tool keys', () => {
  const s = memoryStorage({ chordMovesSavedProgressions: '[]', 'kyndaTools.metronome.bpm': '120' })
  applyHandover(s, { chordMovesSavedProgressions: SAVED, 'kyndaTools.metronome.bpm': '60' }, { prefer: true })
  assert.deepEqual(s.dump(), { chordMovesSavedProgressions: SAVED, 'kyndaTools.metronome.bpm': '120' })
})

test('first visit to the old host carries newer work across, overwriting the stale copy', () => {
  const old = memoryStorage({ cm_tier: 'pro', cm_pro_email: 'a@b.co', chordMovesSavedProgressions: SAVED })
  const oldWin = fakeWindow('https://www.chordmoves.co.uk/', old)
  assert.equal(runDomainHandover(oldWin, old), true)
  assert.ok(oldWin.calls.replace.startsWith(`${CANONICAL_ORIGIN}/chordmoves#cm-handover=`))
  assert.notEqual(old.getItem(HANDED_OVER_KEY), null)

  const stale = memoryStorage({ chordMovesSavedProgressions: '[]', 'kyndaTools.pro': 'pro' })
  const newWin = fakeWindow(oldWin.calls.replace, stale)
  assert.equal(runDomainHandover(newWin, stale), false)
  assert.deepEqual(stale.dump(), { ...appKeys(old.dump()), 'kyndaTools.pro': 'pro' })
  assert.equal(newWin.calls.replaceState, '/chordmoves')
})

test('a later visit to the old host only fills gaps', () => {
  const old = memoryStorage({ chordMovesSavedProgressions: SAVED, [HANDED_OVER_KEY]: '2026-11-26' })
  const oldWin = fakeWindow('https://chordmoves.co.uk/upgrade', old)
  runDomainHandover(oldWin, old)
  const fresh = memoryStorage({ chordMovesSavedProgressions: '[{"name":"newer"}]' })
  runDomainHandover(fakeWindow(oldWin.calls.replace, fresh), fresh)
  assert.equal(fresh.getItem('chordMovesSavedProgressions'), '[{"name":"newer"}]')
})

test('every old-host path moves, tools paths keep their path', () => {
  for (const [from, to] of [['/', '/chordmoves'], ['/upgrade', '/chordmoves/upgrade'], ['/demo', '/chordmoves/demo'], ['/tools', '/'], ['/metronome', '/metronome']]) {
    const s = memoryStorage()
    const win = fakeWindow(`https://www.chordmoves.co.uk${from}`, s)
    assert.equal(runDomainHandover(win, s), true, from)
    assert.equal(win.calls.replace, CANONICAL_ORIGIN + to, from)
  }
})

test('old host with blocked storage still moves, without data', () => {
  const win = fakeWindow('https://www.chordmoves.co.uk/upgrade', null)
  Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError') } })
  assert.equal(runDomainHandover(win, memoryStorage()), true)
  assert.equal(win.calls.replace, `${CANONICAL_ORIGIN}/chordmoves/upgrade`)
})

test('new host without a handover does nothing', () => {
  const s = memoryStorage({ cm_tier: 'pro' })
  const win = fakeWindow('https://tools.kyndalearning.co.uk/chordmoves#top', s)
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
