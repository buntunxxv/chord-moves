// The app is laid out to fit a phone screen as-is, so zooming only ever lands
// someone in a half-scaled page they then have to pinch back out of. This
// closes every route into it. The viewport meta (index.html) covers Android,
// and index.css adds `touch-action: manipulation` (no double-tap zoom) and a
// 16px floor on text fields (the size below which iOS zooms in on focus).
// What neither can do:
//
// - iOS Safari ignores `user-scalable=no` for pinches on purpose, but still
//   lets a page cancel its proprietary gesture events and multi-touch moves.
// - Desktop browsers zoom on Ctrl/Cmd + wheel (and trackpad pinch, which
//   arrives as a Ctrl + wheel) and on Ctrl/Cmd with + - 0.
export function lockZoom(doc = document, win = window) {
  const cancel = event => event.preventDefault()
  // passive: false, or preventDefault() is ignored.
  const active = { passive: false }

  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    doc.addEventListener(type, cancel, active)
  }
  doc.addEventListener('touchmove', event => {
    if (event.touches.length > 1) event.preventDefault()
  }, active)

  win.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) event.preventDefault()
  }, active)
  win.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '_', '0'].includes(event.key)) {
      event.preventDefault()
    }
  })
}
