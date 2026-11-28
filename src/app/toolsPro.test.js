import test from 'node:test'
import assert from 'node:assert/strict'
import { readToolsPro, requestCode, verifyCode, recheck, signOut, TOOLS_PRO_KEY, TOOLS_PRO_EMAIL_KEY } from './toolsPro.js'

function memory(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }
}

// A fake server: maps URL -> handler(body) -> { status, json } | throws.
function server(routes) {
  const calls = []
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body })
    const r = routes[url]
    if (!r) return { ok: false, status: 404, json: async () => ({}) }
    const { status = 200, json } = await r(body)
    return { ok: status < 400, status, json: async () => json }
  }
  return { fetchFn, calls }
}

test('a legacy Chord Moves cm_tier on this origin does not unlock Tools Pro', () => {
  const s = memory({ cm_tier: 'pro', cm_pro_email: 'old@example.com' })
  assert.deepEqual(readToolsPro(s), { isPro: false, email: null })
})

test('Pro needs both the flag and an email (so it can always be re-checked)', () => {
  assert.equal(readToolsPro(memory({ [TOOLS_PRO_KEY]: 'pro' })).isPro, false)
  assert.equal(readToolsPro(memory({ [TOOLS_PRO_KEY]: 'pro', [TOOLS_PRO_EMAIL_KEY]: 'a@b.co' })).isPro, true)
})

test('request code: normalises the email and reports server errors', async () => {
  const { fetchFn, calls } = server({
    '/api/request-unlock-code': async ({ email }) => (email === 'busy@b.co'
      ? { status: 429, json: { error: 'Too many requests for this email — try again later.' } }
      : { json: { sent: true } }),
  })
  assert.deepEqual(await requestCode(fetchFn, '  Me@Example.COM '), { ok: true })
  assert.equal(calls[0].body.email, 'me@example.com')
  assert.equal((await requestCode(fetchFn, 'busy@b.co')).error, 'Too many requests for this email — try again later.')
  assert.equal((await requestCode(fetchFn, 'not-an-email')).ok, false)
  const offline = async () => { throw new Error('offline') }
  assert.match((await requestCode(offline, 'a@b.co')).error, /connection/)
})

test('verify code: a purchase or student grant turns Pro on with the email stored', async () => {
  const s = memory()
  const { fetchFn } = server({ '/api/verify-unlock-code': async () => ({ json: { isPro: true } }) })
  assert.deepEqual(await verifyCode(fetchFn, s, 'Student@Kynda.co.uk', '123456'), { ok: true, isPro: true })
  assert.deepEqual(readToolsPro(s), { isPro: true, email: 'student@kynda.co.uk' })
})

test('verify code: a valid code for an email without Pro stores nothing', async () => {
  const s = memory()
  const { fetchFn } = server({ '/api/verify-unlock-code': async () => ({ json: { isPro: false } }) })
  assert.deepEqual(await verifyCode(fetchFn, s, 'a@b.co', '123456'), { ok: true, isPro: false })
  assert.equal(readToolsPro(s).isPro, false)
})

test('verify code: a wrong code shows the server message', async () => {
  const { fetchFn } = server({ '/api/verify-unlock-code': async () => ({ status: 400, json: { error: 'Incorrect code — check the email and try again.' } }) })
  assert.deepEqual(await verifyCode(fetchFn, memory(), 'a@b.co', '000000'), { ok: false, error: 'Incorrect code — check the email and try again.' })
})

test('recheck: lessons ended (definite not Pro) removes Pro from the device', async () => {
  const s = memory({ [TOOLS_PRO_KEY]: 'pro', [TOOLS_PRO_EMAIL_KEY]: 'student@kynda.co.uk' })
  const { fetchFn, calls } = server({ '/api/check-entitlement': async () => ({ json: { isPro: false } }) })
  assert.equal(await recheck(fetchFn, s), 'removed')
  assert.equal(calls[0].body.email, 'student@kynda.co.uk')
  assert.equal(readToolsPro(s).isPro, false)
})

test('recheck: a stale "not Pro" for an old email never signs out a newer login', async () => {
  const s = memory({ cm_tier: 'pro', cm_pro_email: 'old@b.co', [TOOLS_PRO_KEY]: 'pro', [TOOLS_PRO_EMAIL_KEY]: 'old@b.co' })
  let answer
  const pending = new Promise(resolve => { answer = resolve })
  const fetchFn = async () => { await pending; return { ok: true, json: async () => ({ isPro: false }) } }
  const check = recheck(fetchFn, s)
  // The student signs in with their other email while the check is in flight.
  s.setItem('cm_pro_email', 'new@b.co')
  s.setItem(TOOLS_PRO_EMAIL_KEY, 'new@b.co')
  answer()
  assert.equal(await check, 'superseded')
  assert.deepEqual(readToolsPro(s), { isPro: true, email: 'new@b.co' })
  assert.equal(s.getItem('cm_tier'), 'pro', 'Chord Moves keeps the newer login too')
})

test('recheck: a purchase keeps Pro', async () => {
  const s = memory({ [TOOLS_PRO_KEY]: 'pro', [TOOLS_PRO_EMAIL_KEY]: 'buyer@b.co' })
  const { fetchFn } = server({ '/api/check-entitlement': async () => ({ json: { isPro: true } }) })
  assert.equal(await recheck(fetchFn, s), 'kept')
  assert.equal(readToolsPro(s).isPro, true)
})

test('recheck: a server error or no connection never removes Pro', async () => {
  const s = memory({ [TOOLS_PRO_KEY]: 'pro', [TOOLS_PRO_EMAIL_KEY]: 'a@b.co' })
  const { fetchFn } = server({ '/api/check-entitlement': async () => ({ status: 500, json: { error: 'Database error' } }) })
  assert.equal(await recheck(fetchFn, s), 'kept')
  assert.equal(await recheck(async () => { throw new Error('offline') }, s), 'kept')
  assert.equal(readToolsPro(s).isPro, true)
})

test('recheck with nothing stored makes no request', async () => {
  const { fetchFn, calls } = server({})
  assert.equal(await recheck(fetchFn, memory({ cm_tier: 'pro' })), 'unchanged')
  assert.equal(calls.length, 0)
})

test('sign out removes only the Tools Pro keys', () => {
  const s = memory({ [TOOLS_PRO_KEY]: 'pro', [TOOLS_PRO_EMAIL_KEY]: 'a@b.co', 'kyndaTools.rhythmDice.bpm': '90' })
  signOut(s)
  assert.equal(readToolsPro(s).isPro, false)
  assert.equal(s.getItem('kyndaTools.rhythmDice.bpm'), '90')
})
