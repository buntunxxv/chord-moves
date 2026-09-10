// Shared key layout for every piano visualization in the app (the full
// interactive keyboard, its miniature dock strip, and any other static
// keyboard, like the ear trainer's answer feedback) -- one real layout, not
// a copy that could drift out of sync with another.
//
// Two octaves, C3-D5, so a chord's (or interval's) notes render at their
// real pitch height instead of being wrapped into a single octave -- see
// PianoDisplay.jsx for why. The extra D5 lets a 9th render as a true 9th
// rather than collapsing into a 2nd within the same octave.
export const WHITE_KEYS = [
  'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3',
  'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
  'C5', 'D5',
]

// black key position: index in the white-key array (sits to the right of that key)
// no fixed display spelling here -- a black key can be spelled differently
// depending on context (e.g. a chord's sharp vs its flat), so the label is
// derived per-render from whichever note actually lit it up
export const BLACK_KEYS = [
  { note: 'C#3', whiteIndex: 0 },
  { note: 'D#3', whiteIndex: 1 },
  { note: 'F#3', whiteIndex: 3 },
  { note: 'G#3', whiteIndex: 4 },
  { note: 'A#3', whiteIndex: 5 },
  { note: 'C#4', whiteIndex: 7 },
  { note: 'D#4', whiteIndex: 8 },
  { note: 'F#4', whiteIndex: 10 },
  { note: 'G#4', whiteIndex: 11 },
  { note: 'A#4', whiteIndex: 12 },
  { note: 'C#5', whiteIndex: 14 },
]

// White keys render at their true intrinsic size (no container-relative
// scaling), so these viewBox units map 1:1 to real CSS px. 46 gives a
// genuine 44px-wide tappable rect once the 1px visual gap on each side is
// subtracted out -- a real 44x44 minimum touch target, not just a scaled-up
// appearance. Black keys are 32px wide so they stay comfortably tappable as
// a secondary target, while remaining visibly narrower than a white key.
export const WHITE_KEY_WIDTH = 46
export const WHITE_KEY_HEIGHT = 160
export const BLACK_KEY_WIDTH = 32
export const BLACK_KEY_HEIGHT = 100
export const SVG_WIDTH = WHITE_KEY_WIDTH * WHITE_KEYS.length
export const SVG_HEIGHT = WHITE_KEY_HEIGHT + 24

// A "C" key also shows its octave number so students can read the anchor points
export function whiteKeyLabel(note) {
  return note[0] === 'C' ? note : note[0]
}
