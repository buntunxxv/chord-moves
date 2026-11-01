import { DEMO_SCRIPTS } from './demoScripts.js'
import recordings from './recordings.json' with { type: 'json' }

// Joins a demo's script (title, captions) with its latest recording (files,
// beat timings), written by `npm run demo:record`. Returns null for a demo
// that has no recording yet, so the app simply offers no video for it.
export function getDemo(id, allRecordings = recordings) {
  const script = DEMO_SCRIPTS[id]
  const recording = allRecordings[id]
  if (!script || !recording) return null
  const variants = {}
  for (const [name, variant] of Object.entries(recording.variants)) {
    variants[name] = { ...variant, cues: buildCues(script, variant.beats, variant.duration) }
  }
  return { id, title: script.title, lengthLabel: script.lengthLabel, variants }
}

// One cue per beat that has a caption: from the beat's time to the next
// beat's, the last one running to the end of the video.
export function buildCues(script, beatTimes = {}, duration) {
  const timed = script.beats
    .filter(beat => typeof beatTimes[beat] === 'number')
    .map(beat => ({ beat, start: beatTimes[beat] }))
    .sort((a, b) => a.start - b.start)
  return timed
    .map((entry, i) => ({
      start: entry.start,
      end: i + 1 < timed.length ? timed[i + 1].start : duration,
      text: script.captions[entry.beat] || '',
    }))
    .filter(cue => cue.text)
}

export function activeCue(cues, time) {
  return cues.find(cue => time >= cue.start && time < cue.end) || null
}

// Portrait on a phone-shaped screen, landscape everywhere else; falls back to
// whichever variant exists.
export function pickVariant(demo, portrait) {
  const preferred = portrait ? 'portrait' : 'landscape'
  return demo.variants[preferred] || Object.values(demo.variants)[0] || null
}
