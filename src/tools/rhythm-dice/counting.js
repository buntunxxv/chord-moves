// Counting names for onsets: the words students say as they read a bar.
const SYLLABLES = { 0: null, 3: 'e', 6: '&', 9: 'a', 4: 'trip', 8: 'let' }

// Counting name for an onset, in the words students say: "1", "2&", "3e",
// and for triplets "1-trip-let". Sextuplet notes off those points are
// numbered within the beat: "1·2" is the second of six.
export function countName(tick, beatTicks) {
  const beat = Math.floor(tick / beatTicks) + 1
  const within = tick % beatTicks
  const syl = SYLLABLES[within]
  if (syl === null) return String(beat)
  if (syl === 'trip' || syl === 'let') return `${beat}-${syl}`
  if (syl) return `${beat}${syl}`
  if (within % 2 === 0) return `${beat}·${within / 2 + 1}`
  return `${beat} + ${within}/${beatTicks}`
}

// Compound beats count "1-la-li" on their three quavers; notes between are
// numbered by semiquaver within the beat ("1·2" is the second of six).
const COMPOUND = { 0: null, 6: 'la', 12: 'li' }

// Counting name for a tick in a bar of any metre: dice are counted 1, 2, 3...
// (in 7/8, the three groups), each named the way its own beat divides.
export function countInMetre(tickInBar, metre) {
  let start = 0
  let die = 0
  while (die < metre.dieTicks.length - 1 && start + metre.dieTicks[die] <= tickInBar) start += metre.dieTicks[die++]
  const size = metre.dieTicks[die]
  const within = tickInBar - start
  if (size === 12) return countName(die * 12 + within, 12)
  const syl = COMPOUND[within]
  if (syl === null) return String(die + 1)
  if (syl) return `${die + 1}-${syl}`
  return `${die + 1}·${within / 3 + 1}`
}
