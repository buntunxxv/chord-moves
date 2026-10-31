// One codebase, two public sites (decided 31 Oct 2026):
//
//   www.chordmoves.co.uk        Chord Moves, the flagship: "/" and "/upgrade"
//   tools.kyndalearning.co.uk   the Kynda tools library: "/" is the directory,
//                               plus the metronome, ear trainer and chord-scales
//
// Any other host (localhost, Vercel previews) serves everything, so dev and
// preview links keep working without either domain.
//
// Links between the sites go through resolveLink(): same site -> a router
// path; other site -> an absolute URL. The server half of the split lives in
// vercel.json (tools paths requested on chordmoves.co.uk redirect to the
// library).

export const CHORD_MOVES_ORIGIN = 'https://www.chordmoves.co.uk'
export const TOOLS_ORIGIN = 'https://tools.kyndalearning.co.uk'

const CHORD_MOVES_HOSTS = ['www.chordmoves.co.uk', 'chordmoves.co.uk', 'www.chordmoves.uk', 'chordmoves.uk']
const TOOLS_HOSTS = ['tools.kyndalearning.co.uk']

// Logical paths owned by Chord Moves; every other app path is a library tool.
export const CHORD_MOVES_PATHS = ['/', '/upgrade']
// The library's directory. Its logical path is /tools; on its own host it is
// served at the root.
export const LIBRARY_PATH = '/tools'

export function siteForHost(hostname) {
  if (CHORD_MOVES_HOSTS.includes(hostname)) return 'chordmoves'
  if (TOOLS_HOSTS.includes(hostname)) return 'tools'
  return 'all'
}

export function siteOfPath(path) {
  return CHORD_MOVES_PATHS.includes(path) ? 'chordmoves' : 'tools'
}

// Where a logical app path lives when viewed from `site`.
//   { internal: '/x' }               router link on this site
//   { external: 'https://...', site } full URL on the other site
export function resolveLink(path, site) {
  const owner = siteOfPath(path)
  if (site === 'all') return { internal: path }
  if (owner === site) {
    return { internal: site === 'tools' && path === LIBRARY_PATH ? '/' : path }
  }
  if (owner === 'chordmoves') return { external: CHORD_MOVES_ORIGIN + path, site: owner }
  return { external: TOOLS_ORIGIN + (path === LIBRARY_PATH ? '/' : path), site: owner }
}

export const CURRENT_SITE = typeof window === 'undefined' ? 'all' : siteForHost(window.location.hostname)
