// Pro on the Kynda Tools site (tools.kyndalearning.co.uk).
//
// Decided 15 Nov 2026 (Rhythm Dice, Phase 0):
// - The same entitlement as Chord Moves Pro unlocks it: a Founder Access
//   purchase, or an active student grant. It reuses the email-code flow and
//   the server check (api/request-unlock-code, api/verify-unlock-code,
//   api/check-entitlement). No new Stripe product, webhook or single sign-on.
// - It has its own keys. Chord Moves lived on this origin until 31 Oct, so
//   a legacy `cm_tier=pro` can still sit here -- often with no email, so it
//   could never be re-checked. That flag is deliberately not trusted: Pro on
//   Tools is only ever set by a code sent to the email.
// - Every load re-checks the stored email. A definite "not Pro" (a student
//   whose lessons ended) removes it from this device; a failed or offline
//   check keeps it, so a bad connection never takes Pro away.
//
// Pure apart from the injected `storage` (getItem/setItem/removeItem) and
// `fetchFn`, so the rules are unit-tested without a browser.

export const TOOLS_PRO_KEY = 'kyndaTools.pro'
export const TOOLS_PRO_EMAIL_KEY = 'kyndaTools.proEmail'

export function readToolsPro(storage) {
  const on = storage.getItem(TOOLS_PRO_KEY) === 'pro'
  const email = storage.getItem(TOOLS_PRO_EMAIL_KEY)
  return { isPro: on && !!email, email: on ? email : null }
}

export function normaliseEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

async function post(fetchFn, url, body) {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data = {}
  try { data = await res.json() } catch { /* empty or not JSON */ }
  return { ok: res.ok, data }
}

// Step 1: email a six-digit code. Returns { ok } or { ok: false, error }.
export async function requestCode(fetchFn, email) {
  const e = normaliseEmail(email)
  if (!e.includes('@')) return { ok: false, error: 'Enter the email you use for Chord Moves Pro or your lessons.' }
  try {
    const { ok, data } = await post(fetchFn, '/api/request-unlock-code', { email: e })
    return ok ? { ok: true } : { ok: false, error: data.error || 'The code could not be sent. Try again.' }
  } catch {
    return { ok: false, error: 'The code could not be sent. Check your connection and try again.' }
  }
}

// Step 2: check the code. On success with Pro, stores the flag and email.
// Returns { ok: true, isPro } or { ok: false, error }.
export async function verifyCode(fetchFn, storage, email, code) {
  const e = normaliseEmail(email)
  try {
    const { ok, data } = await post(fetchFn, '/api/verify-unlock-code', { email: e, code: String(code ?? '').trim() })
    if (!ok) return { ok: false, error: data.error || 'That code did not work. Try again.' }
    if (data.isPro) {
      storage.setItem(TOOLS_PRO_KEY, 'pro')
      storage.setItem(TOOLS_PRO_EMAIL_KEY, e)
      return { ok: true, isPro: true }
    }
    return { ok: true, isPro: false }
  } catch {
    return { ok: false, error: 'The code could not be checked. Check your connection and try again.' }
  }
}

// On load. Returns 'kept' | 'removed' | 'unchanged' (nothing stored).
export async function recheck(fetchFn, storage) {
  const { isPro, email } = readToolsPro(storage)
  if (!isPro) return 'unchanged'
  try {
    const { ok, data } = await post(fetchFn, '/api/check-entitlement', { email })
    if (ok && data.isPro === false) {
      signOut(storage)
      return 'removed'
    }
  } catch { /* offline: keep */ }
  return 'kept'
}

export function signOut(storage) {
  storage.removeItem(TOOLS_PRO_KEY)
  storage.removeItem(TOOLS_PRO_EMAIL_KEY)
}
