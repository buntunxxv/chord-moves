import { useEffect, useRef } from 'react'

// Tap-away dismissal, shared by every secondary surface in the app so they all
// close the same way.
//
// Why pointer events and not the onMouseDown the backdrops used before: iOS
// Safari only synthesises mouse events for elements it considers clickable,
// and a plain backdrop <div> with only a React onMouseDown is not one -- so on
// an iPhone tapping outside a window did nothing.

// For surfaces with no backdrop of their own (the header menus, inline text
// boxes, the saved-progressions list, the floating progression workspace):
// a press anywhere outside `refs` calls onDismiss. Presses inside another
// dialog layered on top (a sheet, the walkthrough tooltip) belong to that
// dialog and are ignored, so dismissing one layer never collapses the one
// underneath it as well.
export function useDismissOnOutsidePress(active, onDismiss, refs) {
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  const refsRef = useRef(refs)
  refsRef.current = refs

  useEffect(() => {
    if (!active) return undefined
    function handlePointerDown(event) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (refsRef.current.some(ref => ref.current?.contains(target))) return
      if (target instanceof Element && target.closest('[role="dialog"]')) return
      onDismissRef.current()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [active])
}

// For modal surfaces with a dimmed backdrop: spread the returned props onto
// the backdrop element. It closes on a click that both started and ended on
// the backdrop itself -- a drag that begins inside the panel (selecting text,
// scrolling a list) and is released over the backdrop does not count. Closing
// on click rather than on press also means the tap is used up by the close,
// instead of falling through to whatever sits underneath the window.
export function useBackdropDismiss(onDismiss) {
  const pressedOnBackdrop = useRef(false)
  return {
    onPointerDown: event => {
      pressedOnBackdrop.current = event.target === event.currentTarget
    },
    onClick: event => {
      if (pressedOnBackdrop.current && event.target === event.currentTarget) onDismiss?.()
      pressedOnBackdrop.current = false
    },
  }
}
