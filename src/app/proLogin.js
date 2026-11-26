// One Pro login for every app on tools.kyndalearning.co.uk (26 Nov 2026).
//
// Chord Moves and the companion tools each grew their own Pro keys while
// they lived on different domains:
//   Chord Moves:  cm_tier = 'pro', cm_pro_email
//   Tools:        kyndaTools.pro = 'pro', kyndaTools.proEmail
// Both are unlocked by the same email code and checked by the same server
// entitlement, so now that they share an origin they are one login: an
// unlock writes both, a sign-out (or a definite "not Pro" on re-check)
// clears both, and a load copies an email-backed login across if only one
// side has it. A legacy cm_tier with no email is never copied: it can't be
// re-checked (see toolsPro.js).
//
// Pure apart from the injected `storage` (getItem/setItem/removeItem).

const CM_TIER = 'cm_tier'
const CM_EMAIL = 'cm_pro_email'
const TOOLS_TIER = 'kyndaTools.pro'
const TOOLS_EMAIL = 'kyndaTools.proEmail'

export function setProLogin(storage, email) {
  storage.setItem(CM_TIER, 'pro')
  storage.setItem(CM_EMAIL, email)
  storage.setItem(TOOLS_TIER, 'pro')
  storage.setItem(TOOLS_EMAIL, email)
}

export function clearProLogin(storage) {
  for (const key of [CM_TIER, CM_EMAIL, TOOLS_TIER, TOOLS_EMAIL]) storage.removeItem(key)
}

function login(storage, tierKey, emailKey) {
  const email = storage.getItem(emailKey)
  return storage.getItem(tierKey) === 'pro' && email ? email : null
}

// On load. Returns the email now shared, or null.
export function shareProLogin(storage) {
  const cm = login(storage, CM_TIER, CM_EMAIL)
  const tools = login(storage, TOOLS_TIER, TOOLS_EMAIL)
  if (cm && !tools) { setProLogin(storage, cm); return cm }
  if (tools && !cm) { setProLogin(storage, tools); return tools }
  return cm
}
