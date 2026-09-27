import { useEffect, useId, useRef } from 'react'
import { useBackdropDismiss } from '../hooks/useDismiss'
import './OverlayPage.css'

// `eyebrowIsChord` is for an eyebrow that is a chord name. The eyebrow is set
// in uppercase, and uppercasing a chord name changes what it says: "Eb"
// (E flat) becomes "EB", and "Cm" becomes "CM", which reads as C major.
export default function OverlayPage({ isOpen, onClose, eyebrow, eyebrowIsChord = false, title, children, intro = false, wide = false, docked = false }) {
  const titleId = useId()
  const closeRef = useRef(null)
  // The intro closes on tap-away and Escape too -- it is a welcome screen, not
  // a gate. It still has no × of its own; its button says what closing does.
  const backdropProps = useBackdropDismiss(onClose)

  useEffect(() => {
    if (!isOpen) return undefined
    const previouslyFocused = document.activeElement
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className={`overlay-page ${docked ? 'overlay-page--docked' : ''}`}
      role="presentation"
      {...backdropProps}
    >
      <section
        className={`overlay-page__panel ${wide ? 'overlay-page__panel--wide' : ''} ${intro ? 'overlay-page__panel--intro' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {!intro && (
          <button ref={closeRef} type="button" className="overlay-page__close" onClick={onClose} aria-label={`Close ${title}`}>
            ×
          </button>
        )}
        <header className="overlay-page__header">
          {eyebrow && <p className={`overlay-page__eyebrow ${eyebrowIsChord ? 'overlay-page__eyebrow--chord' : ''}`}>{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
        </header>
        <div className="overlay-page__content">{children}</div>
      </section>
    </div>
  )
}
