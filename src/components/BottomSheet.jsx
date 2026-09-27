import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import './BottomSheet.css'

// A sheet that rises from the bottom edge over a dimmed backdrop, for choices
// that only make sense once something else has been picked -- Identify's
// matching shapes after you select notes, and (next) the Build selectors.
// Deliberately anchored to the bottom rather than centred: on a phone that is
// where the thumb already is, and it leaves the thing you just tapped visible
// above it.
//
// Escape, backdrop-click and focus handling follow OverlayPage, so every modal
// surface in the app behaves the same way -- focus moves to the close button on
// open and returns to whatever opened the sheet on close.
//
// Portalled to document.body, which is not optional here: this renders from
// inside .app__builder-panel, and that panel carries a transform. A transformed
// ancestor becomes the containing block for position: fixed descendants and
// starts its own stacking context, so without the portal the backdrop covers
// only the panel instead of the viewport, and the dock -- outside that subtree
// -- paints over the foot of the sheet and swallows clicks on whatever sits
// there. OverlayPage needs no portal: it renders as a sibling of the panel.
// `initialFocusRef` is for content that owns its own focus target -- the
// Dropdown puts a listbox in here and the APG listbox model keeps DOM focus on
// the list itself, so landing on the close button instead would break arrow-key
// navigation before it started.
// `footer` sits below the scrolling content, never inside it, so the action a
// sheet exists for (Identify's "+ Add to progression") stays on screen however
// tall the content above it gets.
export default function BottomSheet({ isOpen, onClose, eyebrow, title, children, footer, initialFocusRef }) {
  const titleId = useId()
  const closeRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return undefined
    const previouslyFocused = document.activeElement
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    ;(initialFocusRef?.current ?? closeRef.current)?.focus()
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [isOpen, onClose, initialFocusRef])

  if (!isOpen) return null

  return createPortal(
    <div
      className="bottom-sheet"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <section
        className="bottom-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="bottom-sheet__header">
          <div className="bottom-sheet__heading">
            {eyebrow && <p className="bottom-sheet__eyebrow">{eyebrow}</p>}
            <h2 id={titleId} className="bottom-sheet__title">{title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="bottom-sheet__close"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            ×
          </button>
        </header>
        <div className={`bottom-sheet__content ${footer ? 'bottom-sheet__content--with-footer' : ''}`}>{children}</div>
        {footer && <div className="bottom-sheet__footer">{footer}</div>}
      </section>
    </div>,
    document.body,
  )
}
