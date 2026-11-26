// One site (decided 26 Nov 2026, superseding the 31 Oct two-domain split):
//
//   tools.kyndalearning.co.uk/              the Kynda tools directory
//   tools.kyndalearning.co.uk/chordmoves    Chord Moves (+ /chordmoves/demo)
//   tools.kyndalearning.co.uk/upgrade       Kynda Learning Tools Pro, for every tool
//   tools.kyndalearning.co.uk/<tool>        metronome, ear trainer, dice...
//
// Why one origin: a browser keeps saved work and the Pro login per origin.
// With every app on the same origin, one Pro unlock and one set of saved
// state serve them all (see src/app/proLogin.js).
//
// www.chordmoves.co.uk is now a doorway: it hands this browser's saved
// Chord Moves state across and moves to the matching path here (see
// src/utils/domainHandover.js). Any other host (localhost, Vercel
// previews) serves the same routes, so dev and preview links keep working.

export const TOOLS_ORIGIN = 'https://tools.kyndalearning.co.uk'

export const CHORD_MOVES_PATH = '/chordmoves'
export const UPGRADE_PATH = '/upgrade'
export const DEMO_PATH = '/chordmoves/demo'
export const LIBRARY_PATH = '/'

// Hosts that used to serve Chord Moves on their own origin.
export const LEGACY_CHORD_MOVES_HOSTS = ['www.chordmoves.co.uk', 'chordmoves.co.uk', 'www.chordmoves.uk', 'chordmoves.uk']

// Where a path from the old chordmoves.co.uk layout lives now. Old Chord
// Moves paths move under /chordmoves; anything else (already-new paths,
// library tools) keeps its path.
const LEGACY_PATHS = {
  '/': CHORD_MOVES_PATH,
  '/chordmoves/upgrade': UPGRADE_PATH,
  '/demo': DEMO_PATH,
  '/tools': LIBRARY_PATH,
}

export function currentPathFor(legacyPath) {
  const trimmed = legacyPath.length > 1 ? legacyPath.replace(/\/+$/, '') : legacyPath
  return LEGACY_PATHS[trimmed] ?? trimmed
}
