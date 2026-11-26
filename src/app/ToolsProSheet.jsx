import { useState } from 'react'
import BottomSheet from '../components/BottomSheet'
import { logEvent } from '../analytics/events'
import { CHORD_MOVES_ORIGIN } from './sites'
import { requestCode, verifyCode } from './toolsPro'
import { safeStorage } from '../utils/safeStorage'

// The Tools Pro sheet, shared by Rhythm Dice and Chord Dice (extracted from
// Rhythm Dice in Chord Dice PR 3). Unlock is email -> 6-digit code -> done,
// or "not Pro yet"; when Pro is already on, it shows who it is for and a way
// to remove it. The rules live in toolsPro.js; this is only the sheet.
//
// `prefix` keeps each tool's own class names (rd-…, cd-…), so Rhythm Dice
// renders exactly the markup it always has.
// Each tool supplies its wording and what happens after unlock or removal:
//   lockedTitle  'Unlock Level 4'
//   reason       why the sheet opened (a locked level), or ''
//   doneText     what is open now
//   doneAction   { label, onClick } — e.g. "Try Level 4"
//   onUnlocked() re-read Pro after a successful code
//   onRemove()   sign out and undo anything that needed Pro
export default function ToolsProSheet({
  isOpen, onClose, prefix, toolName, lockedTitle, reason, pro, doneText, doneAction, onUnlocked, onRemove,
}) {
  const [step, setStep] = useState('email') // email | code | done | notPro
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Every opening starts at the first step (the email is remembered).
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setStep('email')
      setCode('')
      setError('')
    }
  }

  const c = name => `${prefix}-${name}`
  const isPro = pro.isPro

  async function submitEmail(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const r = await requestCode(window.fetch.bind(window), email)
    setBusy(false)
    if (r.ok) {
      setStep('code')
      logEvent('tools_pro_code_requested')
    } else setError(r.error)
  }

  async function submitCode(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    const r = await verifyCode(window.fetch.bind(window), safeStorage, email, code)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (!r.isPro) {
      setStep('notPro')
      logEvent('tools_pro_not_found')
      return
    }
    onUnlocked()
    setStep('done')
    logEvent('tools_pro_unlocked')
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} eyebrow={`${toolName} Pro`}
      title={isPro && step !== 'done' ? 'Pro is on for this device' : step === 'done' ? 'Pro is on' : lockedTitle}>
      <div className={c('pro')}>
        {isPro && step !== 'done' ? (
          <>
            <p>Unlocked with <strong>{pro.email}</strong>. It is checked each time you open the tools, so it stays while that email has Chord Moves Pro or current lessons with Kynda.</p>
            <button type="button" className={`${c('btn')} ${c('btn--ghost')} ${c('pro__remove')}`} onClick={onRemove}>Remove Pro from this device</button>
          </>
        ) : step === 'done' ? (
          <>
            <p>{doneText}</p>
            <button type="button" className={`${c('btn')} ${c('btn--primary')}`} onClick={doneAction.onClick}>{doneAction.label}</button>
          </>
        ) : step === 'notPro' ? (
          <>
            <p><strong>{email.trim().toLowerCase()}</strong> doesn't have Pro yet. Check it's the email you bought Chord Moves Pro with, or the one your lessons are booked under (for under-18s that's usually a parent's).</p>
            <div className={c('pro__row')}>
              <button type="button" className={`${c('btn')} ${c('btn--quiet')}`} onClick={() => { setStep('email'); setCode('') }}>Try another email</button>
              <a className={`${c('btn')} ${c('btn--keep')}`} href={`${CHORD_MOVES_ORIGIN}/upgrade`} target="_blank" rel="noopener noreferrer">Get Chord Moves Pro</a>
            </div>
          </>
        ) : (
          <>
            {reason && <p className={c('pro__reason')}>{reason}</p>}
            <p>You already have Pro if you bought <strong>Chord Moves Pro</strong> or you're having <strong>lessons with Kynda</strong>. We'll email you a 6-digit code. The email says Chord Moves: it's the same Pro.</p>
            {step === 'email' ? (
              <form className={c('pro__row')} onSubmit={submitEmail}>
                <label htmlFor={c('pro-email')} className={c('visually-hidden')}>Email</label>
                <input id={c('pro-email')} type="email" autoComplete="email" required value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="Your email" />
                <button type="submit" className={`${c('btn')} ${c('btn--primary')}`} disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
              </form>
            ) : (
              <form className={c('pro__row')} onSubmit={submitCode}>
                <label htmlFor={c('pro-code')} className={c('visually-hidden')}>6-digit code</label>
                <input id={c('pro-code')} inputMode="numeric" autoComplete="one-time-code" required value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" />
                <button type="submit" className={`${c('btn')} ${c('btn--primary')}`} disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button>
              </form>
            )}
            {step === 'code' && (
              <p className={c('pro__hint')}>Sent to {email.trim().toLowerCase()}. It lasts 10 minutes. <button type="button" className={c('link')} onClick={() => setStep('email')}>Change email</button></p>
            )}
            {error && <p className={c('pro__error')} role="alert">{error}</p>}
            <p className={c('pro__hint')}>No Pro yet? <a className={c('link')} href={`${CHORD_MOVES_ORIGIN}/upgrade`} target="_blank" rel="noopener noreferrer">Get Chord Moves Pro</a></p>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
