import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { WALKTHROUGH_CONFIGS } from '../utils/walkthroughs'
import './WalkthroughOverlay.css'

const PAD = 6
// Guess used for the very first paint of a step, before the tooltip has
// rendered and we can measure its real height -- refined immediately after.
const TOOLTIP_HEIGHT_GUESS = 200

export default function WalkthroughOverlay({ isOpen, onClose, flow = 'build' }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const [tooltipHeight, setTooltipHeight] = useState(TOOLTIP_HEIGHT_GUESS)
  const tooltipRef = useRef(null)
  const config = WALKTHROUGH_CONFIGS[flow] ?? WALKTHROUGH_CONFIGS.build
  const steps = config.steps

  useEffect(() => {
    if (isOpen) setStep(0)
    else setRect(null)
  }, [isOpen, flow])

  useEffect(() => {
    if (!isOpen) return

    const stepDef = steps[step]
    let frameId = null

    function updateRect() {
      frameId = null
      const el = document.querySelector(stepDef.selector)
      setRect(el ? el.getBoundingClientRect() : null)
    }

    function scheduleRectUpdate() {
      if (frameId === null) frameId = requestAnimationFrame(updateRect)
    }

    const el = document.querySelector(stepDef.selector)
    if (el) {
      const pos = getComputedStyle(el).position
      if (pos !== 'fixed' && pos !== 'sticky') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }

    scheduleRectUpdate()

    window.addEventListener('resize', scheduleRectUpdate)
    window.addEventListener('scroll', scheduleRectUpdate, { passive: true })
    // Scroll events do not bubble. Capture them at document level so the
    // spotlight also follows nested/mobile scroll containers, not only the
    // main window viewport.
    document.addEventListener('scroll', scheduleRectUpdate, { passive: true, capture: true })
    window.visualViewport?.addEventListener('resize', scheduleRectUpdate)
    window.visualViewport?.addEventListener('scroll', scheduleRectUpdate)
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId)
      window.removeEventListener('resize', scheduleRectUpdate)
      window.removeEventListener('scroll', scheduleRectUpdate)
      document.removeEventListener('scroll', scheduleRectUpdate, true)
      window.visualViewport?.removeEventListener('resize', scheduleRectUpdate)
      window.visualViewport?.removeEventListener('scroll', scheduleRectUpdate)
    }
  }, [isOpen, step, flow])

  // Auto-advance when user taps the spotlighted element on action steps
  useEffect(() => {
    const stepDef = steps[step]
    if (!isOpen || !stepDef?.action) return
    const elements = document.querySelectorAll(stepDef.actionSelector ?? stepDef.selector)
    if (elements.length === 0) return

    let done = false
    function onAction() {
      if (done) return
      done = true
      // advance() (not a raw setStep(s => s + 1)) so clicking the
      // spotlighted element on the FINAL step closes the walkthrough
      // instead of pushing step past the end of the current step list -- the last step is
      // itself action-gated now (Add to progression), which the original
      // 8-step version never had to handle since its last step was always
      // a plain narration screen.
      setTimeout(() => advance(), 350)
    }
    elements.forEach(el => el.addEventListener('click', onAction))
    return () => elements.forEach(el => el.removeEventListener('click', onAction))
  }, [isOpen, step, flow])

  // Measure the tooltip's actual rendered height so its position can be
  // clamped to the viewport -- content length varies per step, and a fixed
  // guess either leaves gaps or (worse) lets the tooltip render partly above
  // the top of the screen, behind the browser chrome, where its Skip button
  // is unreachable.
  useLayoutEffect(() => {
    const measured = tooltipRef.current?.offsetHeight
    if (measured && measured !== tooltipHeight) setTooltipHeight(measured)
  })

  function advance() {
    if (step >= steps.length - 1) close()
    else setStep(s => s + 1)
  }

  function close() {
    localStorage.setItem(config.storageKey, '1')
    onClose()
  }

  if (!isOpen) return null

  const stepDef = steps[step]
  const isLast = step === steps.length - 1
  const isAction = stepDef.action

  const spotlightStyle = rect
    ? {
        left: rect.left - PAD,
        top: rect.top - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : { opacity: 0, pointerEvents: 'none' }

  // Position tooltip below spotlight, above if too close to bottom -- then
  // clamp to the viewport either way, since a spotlight that fills most of
  // the screen height (e.g. a tall vertical nav) can leave too little room
  // on *both* sides to fit the tooltip without clamping.
  let tooltipStyle = { opacity: 0 }
  if (rect) {
    const TW = 280
    const M = 12
    const left = Math.max(M, Math.min(rect.left + rect.width / 2 - TW / 2, window.innerWidth - TW - M))
    const spaceBelow = window.innerHeight - (rect.bottom + PAD + M)
    const top = spaceBelow >= tooltipHeight
      ? rect.bottom + PAD + M
      : rect.top - PAD - M - tooltipHeight
    const clampedTop = Math.min(Math.max(top, M), Math.max(M, window.innerHeight - tooltipHeight - M))
    tooltipStyle = { left, top: clampedTop, opacity: 1 }
  }

  return (
    <>
      <div className="wt-spotlight" style={spotlightStyle} />
      {rect && (
        <div className="wt-tooltip" ref={tooltipRef} style={tooltipStyle} role="dialog" aria-label={`Walkthrough step ${step + 1} of ${steps.length}`}>
          <div className="wt-tooltip__meta">
            <span className="wt-tooltip__counter">{step + 1} / {steps.length}</span>
            <button className="wt-skip" onClick={close}>Skip</button>
          </div>
          <p className="wt-tooltip__text">{stepDef.text}</p>
          {isAction && (
            <p className="wt-tooltip__hint">Tap the highlighted element to continue</p>
          )}
          {(!isAction || isLast) && (
            <div className="wt-tooltip__footer">
              <button className="wt-next" onClick={advance}>
                {isLast ? 'Done' : 'Next →'}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
