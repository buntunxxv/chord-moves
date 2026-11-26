import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { logEvent } from './analytics/events'
import { useTheme } from './hooks/useTheme'
import ThemeToggle from './components/ThemeToggle'
import './UpgradePage.css'
import { safeStorage } from './utils/safeStorage'
import { LIBRARY_PATH } from './app/sites'
import { PRO_NAME } from './app/brand'
import { clearProLogin, setProLogin } from './app/proLogin'

// The Stripe payment link for Founder Access (GBP 9, one-time). It is the
// same link api/stripe-webhook.js gates on: only checkout sessions whose
// payment_link is plink_1TtvPlLfFLqligjkwk3HdZKE grant an entitlement, so
// this URL and that ID have to stay a matched pair. Sending buyers anywhere
// else takes their money and unlocks nothing.
const CHECKOUT_URL = 'https://buy.stripe.com/14A7sMgxD0qLaWm1wgbAs0o'

export default function UpgradePage() {
  // People arrive from whichever tool sent them; going back returns there.
  // A direct visit (no in-app history) goes to the tools directory.
  // React Router numbers in-app history entries (idx); 0 means this page
  // was the first one opened here, including after an old-path redirect.
  const navigate = useNavigate()
  const cameFromApp = (window.history.state?.idx ?? 0) > 0
  function goBack(e) {
    if (!cameFromApp) return
    e.preventDefault()
    navigate(-1)
  }
  const { preference: themePreference, resolvedTheme, setPreference: setThemePreference } = useTheme()
  const [unlockEmail, setUnlockEmail] = useState('')
  const [unlockCode, setUnlockCode] = useState('')
  // email: enter the address to get a code. code: enter the code that was
  // sent. success: unlocked. Replaces the old single-step "enter any email
  // that matches" check -- a code proves the visitor actually owns the inbox.
  const [unlockStep, setUnlockStep] = useState('email')
  const [unlockStatus, setUnlockStatus] = useState('idle') // idle | loading | error
  const [unlockError, setUnlockError] = useState('')
  // There is no account or session -- "logged in" means this browser holds
  // the cm_tier flag that App.jsx reads to gate every Pro feature. So
  // logging out is removing that flag, and it is per device and per browser.
  const [isPro, setIsPro] = useState(() => safeStorage.getItem('cm_tier') === 'pro')

  useEffect(() => {
    logEvent('upgrade_page_view')
  }, [])

  async function handleRequestCode(e) {
    e.preventDefault()
    if (!unlockEmail.trim() || unlockStatus === 'loading') return
    setUnlockStatus('loading')
    setUnlockError('')
    try {
      const res = await fetch('/api/request-unlock-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: unlockEmail.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setUnlockStep('code')
        setUnlockStatus('idle')
        logEvent('pro_unlock_code_requested')
      } else {
        setUnlockStatus('error')
        setUnlockError(data.error || 'Something went wrong — try again.')
      }
    } catch {
      setUnlockStatus('error')
      setUnlockError('Something went wrong — try again.')
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault()
    if (!unlockCode.trim() || unlockStatus === 'loading') return
    setUnlockStatus('loading')
    setUnlockError('')
    try {
      const res = await fetch('/api/verify-unlock-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: unlockEmail.trim(), code: unlockCode.trim() }),
      })
      const data = await res.json()
      if (res.ok && data.isPro) {
        // One login for every Kynda tool (src/app/proLogin.js). The email
        // lets App.jsx re-check it on later visits, so access granted for
        // lessons ends on this device once the lessons do.
        setProLogin(safeStorage, unlockEmail.trim().toLowerCase())
        setUnlockStep('success')
        setUnlockStatus('idle')
        logEvent('pro_unlock_success')
      } else if (res.ok) {
        // Code was valid but this email has no Pro entitlement -- most
        // likely a typo against the address used at checkout.
        setUnlockStatus('error')
        setUnlockError("That email doesn't have Pro yet — check it matches the one you paid with.")
        logEvent('pro_unlock_not_found')
      } else {
        setUnlockStatus('error')
        setUnlockError(data.error || 'Something went wrong — try again.')
      }
    } catch {
      setUnlockStatus('error')
      setUnlockError('Something went wrong — try again.')
    }
  }

  function handleChangeEmail() {
    setUnlockStep('email')
    setUnlockStatus('idle')
    setUnlockError('')
    setUnlockCode('')
  }

  function handleLogOut() {
    clearProLogin(safeStorage)
    setIsPro(false)
    // A fresh unlock in this same visit leaves unlockStep on 'success';
    // without this reset the page would keep showing "Pro unlocked" after
    // logging back out.
    setUnlockStep('email')
    setUnlockStatus('idle')
    setUnlockError('')
    setUnlockEmail('')
    setUnlockCode('')
    logEvent('pro_logout')
  }

  return (
    <div className="upgrade-page">
      <header className="upgrade-page__header">
        <div className="upgrade-page__header-inner">
          <div className="upgrade-page__logo">
            <a href="https://www.kyndalearning.co.uk">
              <img src={resolvedTheme === 'dark' ? '/kynda-logo-white.png' : '/kynda-logo-full.png'} alt="Kynda Learning" />
            </a>
          </div>
          <div className="upgrade-page__header-tool">
            <div className="upgrade-page__header-divider" />
            <span className="upgrade-page__header-tool-name">Tools</span>
            <ThemeToggle preference={themePreference} onChange={setThemePreference} />
          </div>
        </div>
      </header>

      <main className="upgrade-page__main">
        <div className="upgrade-page__hero">
          <h1 className="upgrade-page__title">{PRO_NAME}</h1>
          <p className="upgrade-page__subtitle">One unlock for every Kynda Learning tool.</p>
        </div>

        {/* No buy button for someone who already paid -- they keep the
            feature list below, which now reads as what they have. */}
        {!isPro && (
        <div className="upgrade-page__plans">
          <div className="upgrade-page__plan upgrade-page__plan--highlight">
            <div className="upgrade-page__plan-badge">Founder Access</div>
            <div className="upgrade-page__plan-price">
              <span className="upgrade-page__plan-amount">£9</span>
            </div>
            <p className="upgrade-page__plan-note">One-time payment — £9</p>
            <p className="upgrade-page__plan-blurb">You're backing the Kynda Learning tools as they're built, not paying for a finished product.</p>
            {/* A link, not a button: this navigates to Stripe's hosted
                checkout rather than doing anything in the app. New tab so
                this page stays open behind it -- unlocking Pro means coming
                back here and entering the purchase email, and a same-tab
                checkout would leave the buyer with nowhere obvious to
                return to. */}
            <a
              className="upgrade-page__cta-btn"
              href={CHECKOUT_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => logEvent('upgrade_checkout_click')}
            >
              Back the build — £9
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            {/* Stripe's own confirmation screen says to check your email,
                but the unlock actually happens below, in this app. Without
                this line a buyer pays and then waits for something that
                never arrives. */}
            <p className="upgrade-page__plan-after">
              Then come back to this page and unlock with the email you paid with.
            </p>
          </div>
        </div>
        )}

        {/* Live vs. not yet built is checked against the app, not aspiration:
            move an item up only once it actually ships. */}
        <div className="upgrade-page__features">
          <h2 className="upgrade-page__features-heading">Live now</h2>
          <h3 className="upgrade-page__features-tool">Chord Moves</h3>
          <ul className="upgrade-page__feature-list">
            <li>5 next-chord suggestions per chord</li>
            <li>Extended chord types — 9th, 11th, 13th, altered</li>
            <li>Slash chords and inversions</li>
            <li>Longer progressions — no 4-chord limit</li>
            <li>Save and export progressions</li>
            <li>Multiple piano voicings</li>
          </ul>
          <h3 className="upgrade-page__features-tool">Rhythm Dice</h3>
          <ul className="upgrade-page__feature-list">
            <li>Level 4 rhythms</li>
            <li>Compound time and 7/8, with Level 5</li>
          </ul>
          <h3 className="upgrade-page__features-tool">Chord Dice</h3>
          <ul className="upgrade-page__feature-list">
            <li>Level 4: sevenths</li>
            <li>Level 5: bass notes and ninths</li>
          </ul>
          <h2 className="upgrade-page__features-heading upgrade-page__features-heading--planned">Still being built</h2>
          <ul className="upgrade-page__feature-list upgrade-page__feature-list--planned">
            <li>Chord Moves: "Explain this like I'm writing a song" mode</li>
          </ul>
        </div>

        {/* Below the feature list rather than above the price: the list
            already marks what is live and what is not, and this line states
            the general caveat once, quietly. Shown to Pro users too, since it
            stays true for them. */}
        <p className="upgrade-page__dev-notice" role="note">
          The Kynda Learning tools are still in development. Some features are unfinished or missing, and things
          will change as they grow. Pro includes everything live today, and each new Pro feature, in any tool, as it
          arrives.
        </p>

        <div className="upgrade-page__unlock">
          <h2 className="upgrade-page__unlock-title">
            {isPro ? 'Pro is unlocked on this device' : 'Already have Pro?'}
          </h2>
          <p className="upgrade-page__unlock-hint">
            {isPro
              ? 'Unlocking is stored per device and per browser, so logging out here only affects this one.'
              : unlockStep === 'code'
              ? `We sent a code to ${unlockEmail.trim()}. Enter it below to unlock Pro.`
              : 'Bought Pro, or a Kynda Learning student? Enter the email you paid with, or the one on your lessons.'}
          </p>
          {unlockStep === 'success' ? (
            <div className="upgrade-page__unlock-success" role="status">
              Pro unlocked across every Kynda tool. <Link to={LIBRARY_PATH} onClick={goBack}>{cameFromApp ? 'Go back to your tool →' : 'Open the tools →'}</Link>
            </div>
          ) : isPro ? (
            <>
              <button type="button" className="upgrade-page__logout-btn" onClick={handleLogOut}>
                Log out of Pro
              </button>
              {/* Logging out is not meant to be scary or lossy: it drops one
                  flag. Saying so up front stops it reading like "delete my
                  account", which it is not -- there is no account. */}
              <p className="upgrade-page__logout-note">
                This logs out of Pro in every Kynda tool on this device. You can
                unlock again any time with the same email, and your saved work
                stays either way.
              </p>
            </>
          ) : unlockStep === 'code' ? (
            <form className="upgrade-page__unlock-form" onSubmit={handleVerifyCode}>
              <label htmlFor="upgrade-unlock-code" className="upgrade-page__unlock-label">
                6-digit code
              </label>
              <input
                id="upgrade-unlock-code"
                className="upgrade-page__unlock-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={unlockCode}
                onChange={e => { setUnlockCode(e.target.value); if (unlockStatus === 'error') setUnlockStatus('idle') }}
                required
                autoComplete="one-time-code"
                autoFocus
              />
              <button
                className="upgrade-page__unlock-btn"
                type="submit"
                disabled={unlockStatus === 'loading'}
              >
                {unlockStatus === 'loading' ? 'Checking…' : 'Unlock Pro'}
              </button>
              <button type="button" className="upgrade-page__unlock-secondary" onClick={handleChangeEmail}>
                Use a different email or resend the code
              </button>
              {/* Same role="status" pattern ProgressionStrip's save/export
                  toasts use -- announced to screen readers rather than only
                  a silent visual change. */}
              {unlockStatus === 'error' && (
                <p className="upgrade-page__unlock-error" role="status">
                  {unlockError}
                </p>
              )}
            </form>
          ) : (
            <form className="upgrade-page__unlock-form" onSubmit={handleRequestCode}>
              <label htmlFor="upgrade-unlock-email" className="upgrade-page__unlock-label">
                Email
              </label>
              <input
                id="upgrade-unlock-email"
                className="upgrade-page__unlock-input"
                type="email"
                placeholder="you@example.com"
                value={unlockEmail}
                onChange={e => { setUnlockEmail(e.target.value); if (unlockStatus === 'error') setUnlockStatus('idle') }}
                required
                autoComplete="email"
              />
              <button
                className="upgrade-page__unlock-btn"
                type="submit"
                disabled={unlockStatus === 'loading'}
              >
                {unlockStatus === 'loading' ? 'Sending…' : 'Send unlock code'}
              </button>
              {unlockStatus === 'error' && (
                <p className="upgrade-page__unlock-error" role="status">
                  {unlockError}
                </p>
              )}
            </form>
          )}
        </div>

        <Link to={LIBRARY_PATH} onClick={goBack} className="upgrade-page__back">{cameFromApp ? '← Back' : '← All tools'}</Link>
      </main>
    </div>
  )
}
