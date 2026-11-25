// The answer model for Build it: what the student has chosen, compared with
// the rolled chord by pitch class only. Octave never counts and a repeated
// note counts once, so C4 and C5 are both "C", and A♭ answers G♯.
//
// Feedback is a reflection prompt, never a grade: it names the interval the
// student played and asks a question. At Levels 1–2 it comes as each note is
// placed, with one missing-note prompt at a time.
//
// From sound, nothing here may name a chord tone the student has not placed,
// the chord's name or its quality: intervals are measured from notes the
// student already has.
import { Note } from 'tonal'
import { displayNote } from './faces.js'

// Piano keys, by pitch class. The first name is the spelling Chord Dice uses
// for roots (Phase 0 approval), so a root's key and its name always agree.
export const KEY_NAMES = [
  ['C'], ['C#', 'Db'], ['D'], ['Eb', 'D#'], ['E'], ['F'],
  ['F#', 'Gb'], ['G'], ['G#', 'Ab'], ['A'], ['Bb', 'A#'], ['B'],
]
export const isBlackKey = chroma => KEY_NAMES[chroma].length > 1
export const keyLabel = chroma => KEY_NAMES[chroma].map(displayNote).join('/')
// Spoken form for screen readers: "C sharp or D flat".
export const keySpoken = chroma => KEY_NAMES[chroma]
  .map(n => n[0] + (n[1] === '#' ? ' sharp' : n[1] === 'b' ? ' flat' : ''))
  .join(' or ')

// Interval above a reference, by semitones (0–11).
export const INTERVAL_NAMES = [
  'unison', 'minor second', 'major second', 'minor third', 'major third', 'perfect fourth',
  'tritone (augmented fourth or diminished fifth)', 'perfect fifth', 'minor sixth (or augmented fifth)',
  'major sixth', 'minor seventh', 'major seventh',
]
const article = name => (/^[aeiou]/i.test(name) ? 'an' : 'a')
const withArticle = name => `${article(name)} ${name}`
export const semitonesUp = (from, to) => (((to - from) % 12) + 12) % 12

// Accepts ASCII or Unicode accidentals, with or without an octave.
export function normaliseNoteName(name) {
  return String(name).trim()
    .replace(/𝄪/g, '##').replace(/𝄫/g, 'bb').replace(/♯/g, '#').replace(/♭/g, 'b')
}

export function chromaOf(name) {
  const c = Note.chroma(normaliseNoteName(name))
  return Number.isInteger(c) ? c : null
}

// Note names (any spelling, any octave, repeats allowed) -> sorted unique
// pitch classes. Unreadable names are dropped.
export function pitchClassSet(names) {
  return [...new Set(names.map(chromaOf).filter(c => c !== null))].sort((a, b) => a - b)
}

export function matches(chord, names) {
  const chosen = pitchClassSet(names)
  const target = [...new Set(chord.chromas)].sort((a, b) => a - b)
  return chosen.length === target.length && chosen.every((c, i) => c === target[i])
}

// Where the student is: chord tones placed and missing (in root, third, fifth
// order) and extra notes, from a list of chosen pitch classes.
export function compare(chord, selected) {
  const chosen = new Set(selected)
  const placed = chord.roles.map((role, i) => ({ ...role, index: i, note: chord.notes[i], chroma: chord.chromas[i] }))
  return {
    found: placed.filter(t => chosen.has(t.chroma)),
    missing: placed.filter(t => !chosen.has(t.chroma)),
    extras: [...chosen].filter(c => !chord.chromas.includes(c)),
    complete: placed.every(t => chosen.has(t.chroma)) && [...chosen].every(c => chord.chromas.includes(c)),
  }
}

const roleOf = (chord, chroma) => chord.chromas.indexOf(chroma)
const rootName = chord => displayNote(chord.root)
const thirdName = chord => chord.roles[1].name
const fifthName = chord => chord.roles[2].name

// Why a key is spelled the way it is in this chord, when the key's own
// label would not tell you (black keys, and E♯ / B♯ on white keys).
function spellingNote(chord, chroma, i) {
  const spelled = chord.notes[i]
  const plain = KEY_NAMES[chroma][0]
  if (i === 0 || (!isBlackKey(chroma) && spelled === plain)) return ''
  return ` That key is ${keyLabel(chroma)}. Here we write ${displayNote(spelled)} because it’s the ${chord.roles[i].name} of ${rootName(chord)}.`
}

// The reflection for one note just placed. `selected` includes it.
export function placementFeedback(chord, chroma, selected, mode = 'name') {
  return mode === 'sound' ? soundPlacement(chord, chroma, selected) : namePlacement(chord, chroma, selected)
}

function namePlacement(chord, chroma, selected) {
  const i = roleOf(chord, chroma)
  const root = rootName(chord)
  if (i === 0) return `${root} is the root of ${chord.prose}.`
  if (i > 0) {
    return `${displayNote(chord.notes[i])} is the ${chord.roles[i].name} above ${root}.${spellingNote(chord, chroma, i)}`
  }
  const semis = semitonesUp(chord.chromas[0], chroma)
  const played = keyLabel(chroma)
  if (chord.quality === 'major' && semis === 3) {
    return `You played a minor third above ${root}. Major needs a major third. What changes if you move that note up a semitone?`
  }
  if (chord.quality === 'minor' && semis === 4) {
    return `You played a major third above ${root}. Minor needs a minor third. What changes if you move that note down a semitone?`
  }
  const { missing } = compare(chord, selected)
  const lead = `${played} is ${withArticle(INTERVAL_NAMES[semis])} above ${root}.`
  const near = missing.find(t => semitonesUp(chroma, t.chroma) === 1 || semitonesUp(t.chroma, chroma) === 1)
  if (near) {
    const dir = semitonesUp(chroma, near.chroma) === 1 ? 'up' : 'down'
    return `${lead} ${chord.prose} uses its root, ${withArticle(thirdName(chord))} and ${withArticle(fifthName(chord))}. What changes if you move that note ${dir} a semitone?`
  }
  if (missing.length === 0) {
    return `${lead} ${chord.prose} already has its root, ${thirdName(chord)} and ${fifthName(chord)}. What does this extra note do to the sound?`
  }
  return `${lead} ${chord.prose} uses its root, ${withArticle(thirdName(chord))} and ${withArticle(fifthName(chord))}. Which of those is this note closest to?`
}

// From sound: measure from a chord tone the student already has, and never
// say which role it plays.
function soundPlacement(chord, chroma, selected) {
  const played = keyLabel(chroma)
  const others = compare(chord, selected).found.filter(t => t.chroma !== chroma)
  const anchor = others[0]
  const from = anchor ? ` ${withArticle(INTERVAL_NAMES[semitonesUp(anchor.chroma, chroma)])} above ${keyLabel(anchor.chroma)}` : ''
  if (chord.chromas.includes(chroma)) {
    return anchor
      ? `${played} is in the chord:${from}. Play your notes together. Does it sound closer?`
      : `${played} is in the chord. Play it against the chord. Can you hear where it sits?`
  }
  const rootPlaced = others.some(t => t.index === 0)
  const semis = semitonesUp(chord.chromas[0], chroma)
  if (rootPlaced && ((chord.quality === 'major' && semis === 3) || (chord.quality === 'minor' && semis === 4))) {
    const kind = semis === 3 ? 'minor' : 'major'
    return `You played ${withArticle(`${kind} third`)} above ${keyLabel(chord.chromas[0])}. Listen again: is the chord brighter or darker than what you’ve built?`
  }
  const near = compare(chord, selected).missing.some(t => semitonesUp(chroma, t.chroma) === 1 || semitonesUp(t.chroma, chroma) === 1)
  if (near) {
    const said = anchor ? `${played} is${from}. It isn’t in the chord` : `${played} isn’t in the chord`
    return `${said}, but it’s a semitone from a note that is. Replay it: does that note sit higher or lower?`
  }
  return anchor
    ? `${played} is${from}, and that interval isn’t in this chord. Replay it and listen for where your next note sits.`
    : `${played} isn’t in the chord. Replay it and listen for a note you can hear clearly.`
}

// One prompt at a time for what is still to do, or null when it matches.
export function nextPrompt(chord, selected, mode = 'name') {
  const { found, missing, extras, complete } = compare(chord, selected)
  if (complete) return null
  if (missing.length === 0) {
    const n = extras.length
    return mode === 'sound'
      ? `All the chord’s notes are here, plus ${n === 1 ? 'one more' : `${n} more`}. Which would you take away? Replay it to compare.`
      : `All three notes of ${chord.prose} are here, plus ${n === 1 ? 'one more' : `${n} more`}. Which would you take away?`
  }
  if (mode === 'sound') {
    const n = missing.length
    if (found.length === 0) return 'Replay the chord and find one note you can hear. The lowest is often easiest.'
    return `${n === 1 ? 'One more note' : `${n} more notes`} to find. Replay it and listen for the next one.`
  }
  const root = rootName(chord)
  const has = idx => found.some(t => t.index === idx)
  const next = missing[0]
  if (next.index === 0) {
    return found.length || extras.length ? `Where is the root, ${root}?` : `Start with the root. Where is ${root}?`
  }
  if (next.index === 1) {
    return has(0)
      ? `You’ve found the root. Which note is ${withArticle(thirdName(chord))} above ${root}?`
      : `Which note is ${withArticle(thirdName(chord))} above ${root}?`
  }
  return has(0) && has(1)
    ? `You’ve found the root and ${thirdName(chord)}. What completes the ${fifthName(chord)} above ${root}?`
    : `What sits ${withArticle(fifthName(chord))} above ${root}?`
}

export const spelledNotes = chord => chord.notes.map(displayNote).join(' – ')

const times = n => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

// What makes this chord sound the way it does, for the finish reflection.
function whatMakesIt(chord) {
  switch (chord.quality) {
    case 'major':
    case 'minor':
      return `Which note makes it ${chord.quality}? Play it and listen for that note.`
    case 'dim':
      return 'Two notes make it diminished. Which two? Play it and listen for them.'
    case 'aug':
      return 'Which note makes it augmented? Play it and listen for that note.'
    default:
      return `What does the ${thirdName(chord)} do in place of the third? Play it and listen.`
  }
}

// The reflection line on the Result stage. A chord made by changing one die
// asks about the change instead.
export function finishReflection(chord, { start, replays = 0, revealed = false, changedFrom = null }) {
  if (changedFrom && !revealed) {
    const heard = start === 'sound' && replays > 0 ? `You replayed it ${times(replays)}. ` : ''
    return heard + describeChange(changedFrom.chord, chord, changedFrom.die)
  }
  if (revealed) {
    const heard = start === 'sound' && replays > 0 ? `You played it ${times(replays + 1)} before revealing. ` : ''
    return `${heard}Play it again and listen for the ${thirdName(chord)}. Where would you have found it?`
  }
  if (start === 'sound') {
    return replays === 0
      ? 'You found it from the first play. What did you hear first?'
      : `You replayed it ${times(replays)}. What did you listen for on the last play?`
  }
  return whatMakesIt(chord)
}

const DIE_LABEL = { root: 'Root', quality: 'Quality', colour: 'Colour' }
const semitoneWords = n => (n === 1 ? 'a semitone' : n === 2 ? 'a tone' : `${n} semitones`)

// Change one die: what moved, note by note, then a question about the sound.
// Never a verdict: the student says why it sounds different.
export function describeChange(from, to, die) {
  const lead = `You changed the ${DIE_LABEL[die]}: ${from.name} became ${to.name}.`
  if (die === 'root') {
    const up = semitonesUp(from.chromas[0], to.chromas[0])
    const dir = up <= 6 ? 'up' : 'down'
    const n = up <= 6 ? up : 12 - up
    return `${lead} Every note moved ${dir} ${withArticle(INTERVAL_NAMES[n].replace(/ \(.*\)$/, ''))}, so the shape stayed the same. What changed in the sound, and what didn’t?`
  }
  const moves = []
  for (let i = 0; i < 3; i++) {
    if (from.chromas[i] === to.chromas[i]) continue
    const up = semitonesUp(from.chromas[i], to.chromas[i])
    const dir = up <= 6 ? 'up' : 'down'
    moves.push(`${displayNote(from.notes[i])} moved ${dir} ${semitoneWords(up <= 6 ? up : 12 - up)} to ${displayNote(to.notes[i])}`)
  }
  const said = moves.length ? `${moves.join(', and ')}.` : 'The notes stayed the same; only the spelling changed.'
  return `${lead} ${said} What does that change do to the sound?`
}

// ---------- Submit (Level 3 and Mix) ----------

// The keyboard stays neutral while the student works; this is the only
// feedback, and only when they choose to Submit. Extra notes and missing
// notes are described separately. A wrong note is paired with a missing
// one only when it sits a semitone from exactly one of them.
//   { complete: true } or { complete: false, extra: string|null, missing: string|null }
export function submitFeedback(chord, selected, mode = 'name') {
  const { found, missing, extras, complete } = compare(chord, selected)
  if (complete) return { complete: true, extra: null, missing: null }
  const near = (a, b) => semitonesUp(a, b) === 1 || semitonesUp(b, a) === 1
  const pairs = []
  for (const e of extras) {
    const candidates = missing.filter(m => near(e, m.chroma) && !pairs.some(p => p.missing === m))
    if (candidates.length === 1) pairs.push({ extra: e, missing: candidates[0] })
  }
  const paired = new Set(pairs.map(p => p.extra))
  const loose = extras.filter(e => !paired.has(e))
  const stillMissing = missing.filter(m => !pairs.some(p => p.missing === m))
  const root = rootName(chord)
  const list = cs => cs.map(keyLabel).join(cs.length === 2 ? ' and ' : ', ')

  let extra = null
  if (mode === 'sound') {
    if (pairs.length) {
      const p = pairs[0]
      extra = `${keyLabel(p.extra)} isn’t in the chord, but it’s a semitone from a note that is. Replay it: does that note sit higher or lower?`
    } else if (loose.length) {
      extra = `${list(loose)} ${loose.length === 1 ? 'isn’t' : 'aren’t'} in the chord. Which would you take away? Replay it to compare.`
    }
  } else if (pairs.length) {
    const p = pairs[0]
    const dir = semitonesUp(p.extra, p.missing.chroma) === 1 ? 'up' : 'down'
    const inPlace = chord.quality.startsWith('sus') && p.missing.index === 1 ? ' in place of the third' : ''
    extra = `You played ${withArticle(INTERVAL_NAMES[semitonesUp(chord.chromas[0], p.extra)])} above ${root}. ${chord.prose} uses ${withArticle(p.missing.name)}${inPlace}. What changes if you move that note ${dir} a semitone?`
  } else if (loose.length) {
    const what = loose.map(e => `${keyLabel(e)} is ${withArticle(INTERVAL_NAMES[semitonesUp(chord.chromas[0], e)])} above ${root}`)
    extra = `${what.join('; ')}. ${chord.prose} doesn’t use ${loose.length === 1 ? 'it' : 'them'}. Which would you take away?`
  }

  let missingLine = null
  if (stillMissing.length) {
    if (mode === 'sound') {
      const n = stillMissing.length
      missingLine = found.length === 0
        ? 'None of these notes are in the chord yet. Replay it and listen for one you can hear.'
        : `${n === 1 ? 'One note is' : `${n} notes are`} still to find. Replay it and listen.`
    } else {
      const next = stillMissing[0]
      missingLine = next.index === 0
        ? `Where is the root, ${root}?`
        : `Which note is ${withArticle(next.name)} above ${root}?`
    }
  }
  return { complete: false, extra, missing: missingLine }
}
