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
