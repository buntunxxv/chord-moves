// What the live demo's sandboxed app starts with: the viewer's own theme (read
// once from their real storage), the first-run tour already seen, and nothing
// else -- no progression, no Pro, no saved work.
export const DEMO_FRAME_PARAM = 'demo-frame'
export const DEMO_FRAME_SRC = `/?${DEMO_FRAME_PARAM}`

const THEME_KEY = 'chordMovesThemePreference'

export function demoSeed(realStorage) {
  return {
    [THEME_KEY]: realStorage.getItem(THEME_KEY),
    cm_seen_intro_v3: '1',
    cm_seen_learn_intro: '1',
    cm_path: 'build',
  }
}
