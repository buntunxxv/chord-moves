// How the Extension dropdown names its options, given the chosen quality.
//
// The "7" extension adds a minor seventh on top of whatever triad is chosen:
// Minor + 7 = Cm7, Diminished + 7 = Cm7♭5, Augmented + 7 = Caug7. With a
// major triad that is a *dominant* seventh (C7), not a major seventh -- but
// "Major" next to "7" reads as "major seventh". Founder report (26 Nov 2026):
// choosing Major and then 7 should not give a dominant seventh by surprise.
// So, only when the quality is Major, the dominant extensions say so. Values,
// symbols and chords are unchanged; this is wording only.
const DOMINANT_WITH_MAJOR = new Set(['7', '9', '11', '13'])

export function extensionLabel(extension, label, quality) {
  return quality === 'major' && DOMINANT_WITH_MAJOR.has(extension) ? `${label} (dominant)` : label
}
