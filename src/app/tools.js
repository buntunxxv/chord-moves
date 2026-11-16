// Single source of truth for the tools in the Kynda Tools suite -- used by
// ToolHome's directory grid and by suiteMenu.js's shared nav-menu links, so
// adding, renaming, or reordering a tool never means updating two lists that
// happen to agree today.
export const TOOLS = [
  {
    name: 'Chord Moves',
    description: 'Build chord progressions and understand why each movement works.',
    path: '/',
    icon: '⌁',
  },
  {
    name: 'Rhythm Dice',
    description: 'Roll a bar of rhythm, clap it back, and keep the ones you choose.',
    path: '/rhythm-dice',
    icon: '⚄',
  },
  {
    name: 'Metronome',
    description: 'Set a pulse, choose a time signature, or find a tempo by tapping.',
    path: '/metronome',
    icon: '♩',
  },
  {
    name: 'Interval Ear Trainer',
    description: 'Learn to recognise the distance between two notes by ear.',
    path: '/ear-trainer',
    icon: '◒',
  },
  {
    name: 'Chord–Scale Explorer',
    description: 'Find scales for a chord—or chords that belong to a scale.',
    path: '/chord-scales',
    icon: '◎',
  },
]
