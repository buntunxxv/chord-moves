import { chordPattern } from './director.js'

// The live demo, chapter by chapter. Each `run` taps through the real app by
// the names on its controls; the demo page shows `title` in the chapter list
// and `caption` while the chapter plays. Change wording here freely. If a
// step can't find its control after a UI change, `npm run test:demo` fails
// and names the step.

// On a phone, the chord's actions sit behind the "Explore" tab.
async function inChordPanel(d, name, opts) {
  if (!d.has(name)) await d.tap(/^Explore$/, { after: 500 })
  await d.tap(name, opts)
}

// A suggestion's own add button is named for its chord ("Add to progression
// Am7"), so it can't be confused with the builder's, behind the overlay.
const addSuggestion = (d, chord) => d.tap(`Add to progression ${chord}`, { after: 1000 })

export const DEMO_CHAPTERS = [
  {
    id: 'pick',
    title: 'Pick a chord',
    caption: 'Pick a chord and hear it.',
    async run(d) {
      await d.wait(600)
      await d.tap(/^Root:/, { after: 900 })
      await d.tap('C', { role: 'option', after: 700 })
      await d.tap(/^Play chord/, { sound: true, after: 1200 })
    },
  },
  {
    id: 'add',
    title: 'Add it',
    caption: 'Add it to your progression. It waits in the bar below.',
    async run(d) {
      await inChordPanel(d, /^Add to progression/, { after: 1400 })
    },
  },
  {
    id: 'explore',
    title: 'See where it can go',
    caption: 'Each move tells you what it does to the song.',
    async run(d) {
      await inChordPanel(d, /^Explore next chords/, { after: 1500 })
      await d.tap(chordPattern('Am7'), { after: 1800 })
      await d.tap(/^Hear/, { sound: true, after: 400 })
      // Adding waits until the preview has finished playing, as it would for
      // anyone listening.
      await d.find(/^Hear/, { timeout: 8000 })
      await d.wait(500)
    },
  },
  {
    id: 'chain',
    title: 'Chain the moves',
    caption: 'Add it, then choose the next move from there.',
    async run(d) {
      await addSuggestion(d, 'Am7')
      for (const chord of ['Dm7', 'G7']) {
        await d.tap(chordPattern(chord), { after: 1800 })
        await addSuggestion(d, chord)
      }
      await d.tap(/^Close Choose where/, { after: 800 })
    },
  },
  {
    id: 'play',
    title: 'Play it back',
    caption: 'Build it. Play it. Know why it works.',
    async run(d) {
      await d.tap(/^Progression/, { after: 1200 })
      await d.tap(/Play progression/, { after: 6500 })
    },
  },
]
