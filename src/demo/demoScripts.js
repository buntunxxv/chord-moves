// The in-app demo videos: what each one is called and what its captions say.
// Read by the app (src/demo/demoVideos.js) and by the recorder
// (scripts/record-demo-videos.mjs), so keep this file free of imports.
//
// Captions are keyed by "beat": a moment the recorder marks as it drives the
// app. The recorder notes when each beat happens; the player shows a beat's
// caption from then until the next beat. Rewording a caption needs no
// re-record. Adding, removing or renaming a beat does: `npm run demo:record`.
export const DEMO_SCRIPTS = {
  'build-a-progression': {
    title: 'Build a progression from one chord',
    lengthLabel: '30s',
    beats: ['pick', 'explore', 'build'],
    captions: {
      pick: 'Pick a chord. Hear where it can go.',
      explore: 'Each move tells you what it does to the song.',
      build: 'Build it. Play it. Know why it works.',
    },
  },
}
