import { useState, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Chord, Note } from 'tonal'
import { CHORD_DATA } from './chordData'
import { GUITAR_SHAPES } from './guitarData'
import { GUITAR_INVERSION_SHAPES } from './guitarInversions'
import { buildChordSymbol } from './components/ChordSelector'
import { isSlashEligible, computeSlashNotes, appendSlashSymbol, isInChordTone } from './utils/slashChord'
import { applyDrop2, applyLeftHandSplit } from './utils/pianoVoicings'
import { createKeysSynth, startAudioContext } from './audio/synth'
import { useTheme } from './hooks/useTheme'
import { toDataKey, chordNameToSelection, resolveGuitarPositions, guitarShapeForChordName } from './utils/chordSelectionLookup'
import { shouldAutoOpenWalkthrough, walkthroughFlowForPath } from './utils/walkthroughs'
import ChordSelector from './components/ChordSelector'
import ChordOutputPanel from './components/ChordOutputPanel'
import NextChordSuggestions from './components/NextChordSuggestions'
import ProgressionTemplates from './components/ProgressionTemplates'
import ProgressionStrip from './components/ProgressionStrip'
import ReverseVoicingFinder from './components/ReverseVoicingFinder'
import FeedbackPanel from './components/FeedbackPanel'
import WalkthroughOverlay from './components/WalkthroughOverlay'
import ThemeToggle from './components/ThemeToggle'
import LearnPath from './components/LearnPath'
import OverlayPage from './components/OverlayPage'
import SuiteMenuLinks from './app/SuiteMenuLinks'
import './App.css'

const PROGRESSION_LIMIT = 4
const PROGRESSION_STORAGE_KEY = 'chordMovesProgression'
const PROGRESSION_TEASER = 'Longer progressions are coming in Chord Moves Pro.'
// How long the one-step "Undo" after a template load stays available before
// it silently expires -- it also clears sooner, immediately, on any other
// progression-mutating action (see clearLoadUndo's call sites below).
const LOAD_UNDO_WINDOW_MS = 10000
const CHORD_AUDITION_SECONDS = 1.5

// The three ways to find a chord, in slide order -- siblings you can swipe
// between. Identify and Templates used to be aria-modal overlays stacked over
// Build, which made two of the three feel like detours off the "real" screen
// rather than peers of it.
//
// Progression is deliberately NOT among them: it's the project the collected
// chords go into, and it has its own permanent destination in the bottom dock
// (see ProgressionStrip). Listing it here too would present a workspace as a
// fourth "way to make a chord" and leave two competing entry points to the
// same place.
const WORKSPACE_PAGES = [
  { key: 'build', label: 'Build', eyebrow: 'Chord Moves', title: 'Build, hear and save a chord' },
  { key: 'find', label: 'Identify', eyebrow: 'Identify', title: 'Find a chord from its notes' },
  { key: 'templates', label: 'Templates', eyebrow: 'Templates', title: 'Start with a proven progression' },
]

// Resolves each displayed note's interval label from what it actually IS
// (by pitch class), not from its position in the array -- notes get
// reordered/re-voiced independently of tonalChord's own root-position
// notes/intervals (slash-chord bass via computeSlashNotes, Drop-2, Split),
// so a positional pairing is only ever coincidentally correct. Building a
// chroma -> interval lookup from tonalChord's own notes/intervals pairing
// once, then resolving every displayed note against it by pitch class,
// handles any reordering with a single lookup -- no separate slash-chord
// special case needed. A note whose pitch class isn't one of the chord's
// own tones (only possible today via a foreign, non-chord-tone slash bass)
// has no interval to report and is simply omitted.
function intervalsForNotes(tonalChord, notes) {
  if (!tonalChord?.notes || !tonalChord?.intervals) return []
  const chromaToInterval = new Map()
  tonalChord.notes.forEach((n, i) => chromaToInterval.set(Note.chroma(n), tonalChord.intervals[i]))
  return notes.map(n => chromaToInterval.get(Note.chroma(n))).filter(Boolean)
}

// Format chord display name from tonal
function getDisplayName(root, quality, extension) {
  const symbol = buildChordSymbol(root, quality, extension)
  if (!symbol) return '—'
  const c = Chord.get(symbol)
  if (!c || !c.tonic) return symbol
  // Build a clean display name
  return c.symbol || symbol
}

export default function App() {
  const [selection, setSelection] = useState({ root: 'C', quality: 'major', extension: 'none', bassNote: 'none' })
  const [bpm, setBpm] = useState(90)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [walkthroughFlow, setWalkthroughFlow] = useState(null)
  const [introOpen, setIntroOpen] = useState(true)
  // Progression/instrument bottom sheet -- collapsed by default so the
  // chord builder gets the vast majority of a mobile viewport. Lives here
  // (not inside ProgressionStrip) only because App.css's bottom-padding
  // reservation for the fixed-position sheet needs to know its height too;
  // otherwise this is pure UI state, not persisted, and nothing but the
  // user's own tap/swipe on the sheet ever changes it -- selecting a chord,
  // playing, switching Build/Templates/Find modes, none of that touches it.
  const [sheetExpanded, setSheetExpanded] = useState(false)
  // Which of the three slides is showing. Not persisted -- always starts back
  // on Build.
  const [workspacePage, setWorkspacePage] = useState('build')
  // Suggestions is the one page that stays a true overlay: it is opened FROM
  // the builder for the chord it is currently showing, so it belongs on top of
  // Build rather than beside it.
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const slidesRef = useRef(null)
  const slideRefs = useRef({})
  const [phonePanel, setPhonePanel] = useState('build')

  // Top-level Learn/Build path (distinct from `mode`, the build/find tab
  // inside the builder panel above) -- persisted so the choice survives a
  // reload.
  const [path, setPath] = useState(() => localStorage.getItem('cm_path') || 'build')

  useEffect(() => {
    localStorage.setItem('cm_path', path)
  }, [path])

  const [previewIndex, setPreviewIndex] = useState(null)
  const [progression, setProgression] = useState(() => {
    try {
      const stored = localStorage.getItem(PROGRESSION_STORAGE_KEY)
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [progressionTeaser, setProgressionTeaser] = useState('')
  const teaserTimeoutRef = useRef(null)
  // Which progression chip was last tapped (drives the chord builder/piano/
  // guitar views, and is where the next add-to-progression call inserts --
  // null means "no chip tapped yet," which falls back to appending at the
  // end, same as before any chip but the last was tappable at all. Kept as
  // a plain index rather than an id because every mutation that could move
  // or invalidate it (insert, remove, reorder) is a function right here in
  // this component that can just adjust it in the same breath.
  const [tappedChordIndex, setTappedChordIndex] = useState(null)
  const [isPro, setIsPro] = useState(false)
  const [templateKeyRoot, setTemplateKeyRoot] = useState('C')
  const [templateKeyMode, setTemplateKeyMode] = useState('major')
  const [activeTemplate, setActiveTemplate] = useState(null)
  // Snapshot of {progression, activeTemplate, tappedChordIndex} taken right
  // before a template load overwrites them -- null means no undo is
  // currently available. One step only: a second load overwrites this with
  // its own pre-load snapshot rather than stacking a history.
  const [loadUndoSnapshot, setLoadUndoSnapshot] = useState(null)
  const loadUndoTimeoutRef = useRef(null)

  useEffect(() => {
    return () => { if (loadUndoTimeoutRef.current) clearTimeout(loadUndoTimeoutRef.current) }
  }, [])

  function armLoadUndo(snapshot) {
    if (loadUndoTimeoutRef.current) clearTimeout(loadUndoTimeoutRef.current)
    setLoadUndoSnapshot(snapshot)
    loadUndoTimeoutRef.current = setTimeout(() => setLoadUndoSnapshot(null), LOAD_UNDO_WINDOW_MS)
  }

  // Called at the top of every progression mutation that ISN'T itself a
  // template load, so the undo affordance only ever offers to restore the
  // state from immediately before the most recent load, never a stale one
  // from several edits ago.
  function clearLoadUndo() {
    if (loadUndoTimeoutRef.current) {
      clearTimeout(loadUndoTimeoutRef.current)
      loadUndoTimeoutRef.current = null
    }
    setLoadUndoSnapshot(null)
  }

  function undoLoad() {
    if (!loadUndoSnapshot) return
    if (loadUndoTimeoutRef.current) {
      clearTimeout(loadUndoTimeoutRef.current)
      loadUndoTimeoutRef.current = null
    }
    setProgression(loadUndoSnapshot.progression)
    setActiveTemplate(loadUndoSnapshot.activeTemplate)
    setTappedChordIndex(loadUndoSnapshot.tappedChordIndex)
    setLoadUndoSnapshot(null)
  }

  useEffect(() => {
    setIsPro(localStorage.getItem('cm_tier') === 'pro')
  }, [])
  const [playingChordNotes, setPlayingChordNotes] = useState(null)
  const [playingRootNote, setPlayingRootNote] = useState(null)
  // Which progression chord is actually sounding right now, by display name
  // -- lets the Guitar tab (InstrumentDock/GuitarDisplay) resolve and show
  // THAT chord's own shape during playback instead of staying frozen on
  // whichever chord the builder happens to have selected (see
  // playingGuitarShape below). null whenever nothing is playing.
  const [playingChordName, setPlayingChordName] = useState(null)
  const [auditionPlaying, setAuditionPlaying] = useState(false)
  const auditionSynthRef = useRef(null)
  const auditionTimeoutRef = useRef(null)

  useEffect(() => () => {
    if (auditionTimeoutRef.current) clearTimeout(auditionTimeoutRef.current)
    auditionSynthRef.current?.dispose()
  }, [])
  const [keysPositionIndex, setKeysPositionIndex] = useState(0)
  // Lifted out of InstrumentDock (which used to own this locally) so the
  // reverse-lookup's "closest to the last progression chord" ranking can
  // tell whether the last chord IS the one currently shown on the Guitar
  // tab, and if so, use whichever neck position is actually selected for
  // it right now instead of always assuming position 1.
  const [guitarPositionIndex, setGuitarPositionIndex] = useState(0)

  // ProgressionStrip now applies the selected Keys voicing (Drop-2/Split)
  // during playback too, so playingChordNotes[0] is no longer reliably the
  // true root the way it was when playback only ever voice-led the chord
  // as-stored -- it needs its own untouched root passed alongside the notes.
  function handlePlayingChordChange(notes, rootNote, chordName) {
    setPlayingChordNotes(notes)
    setPlayingRootNote(rootNote ?? null)
    setPlayingChordName(chordName ?? null)
  }
  const { preference: themePreference, resolvedTheme, setPreference: setThemePreference } = useTheme()

  const { root, quality, extension, bassNote } = selection

  const dataKey = useMemo(() => toDataKey(root, quality, extension), [root, quality, extension])
  const chordEntry = dataKey ? CHORD_DATA[dataKey] : null

  useEffect(() => setPreviewIndex(null), [dataKey])

  // Slash chords/inversions are Pro-gated and don't apply to the symmetric
  // diminished/augmented/dim7 chord types (see src/utils/slashChord.js) --
  // effectiveBassNote is the single source of truth actually used to build
  // notes/symbol, so a free user or an ineligible quality has zero effect
  // even if selection.bassNote somehow held a stale non-"none" value.
  const bassEligible = useMemo(() => isSlashEligible(quality, extension), [quality, extension])
  const effectiveBassNote = isPro && bassEligible ? bassNote : 'none'
  const hasSlashBass = effectiveBassNote !== 'none' && Note.chroma(effectiveBassNote) !== Note.chroma(root)

  // Guitar shapes only exist for true inversions (bass = an existing chord
  // tone) -- a foreign-bass slash chord changes the chord's actual pitch-
  // class set and has no fixed fingering template at all yet, so it keeps
  // showing the honest "coming soon" notice (the tab stays clickable). A
  // true in-chord inversion with no generated shape is a different case:
  // guitarInversions.js's search already tried and documented (in its
  // skip-list comment) that no clean fingering exists within a reasonable
  // fret span for that specific chord/bass combination -- there's nothing
  // "coming," so the Guitar tab is disabled entirely instead, same as any
  // other structurally-unavailable control in this app.
  const isInversion = hasSlashBass && isInChordTone(chordEntry?.notes, effectiveBassNote)
  const inversionGuitarShape = isInversion ? GUITAR_INVERSION_SHAPES[dataKey]?.[effectiveBassNote] : null
  const guitarShapeToShow = hasSlashBass ? inversionGuitarShape : GUITAR_SHAPES[dataKey]
  const guitarInversionUnavailable = isInversion && !inversionGuitarShape
  const guitarSlashNotice = hasSlashBass && !isInversion

  // Alternate neck positions: root-position chords use guitarPositions.js,
  // true inversions use guitarInversionPositions.js (same idea, but every
  // position keeps the selected BASS TONE lowest, not the root). Foreign-
  // bass slash chords and inversions with no position-1 shape at all
  // (guitarInversionUnavailable) get no selector -- there's nothing to
  // page through. Position 1 is always whatever guitarShapeToShow already
  // resolved to; any additional positions get appended after it, so the
  // array's own length (1-3) already reflects how many of the 2 alternates
  // actually exist for this specific chord (+ bass, for inversions).
  const guitarPositions = useMemo(
    () => resolveGuitarPositions(dataKey, hasSlashBass, effectiveBassNote, chordEntry?.notes),
    [dataKey, hasSlashBass, effectiveBassNote, chordEntry],
  )

  // Reference shape for the reverse-lookup's Phase 2 ranking: the LAST
  // chord already in the progression, resolved via the exact same
  // resolveGuitarPositions lookup above -- reused, not duplicated. Its
  // name only tells us root/quality/extension (chordNameToSelection can't
  // recover a slash bass from a display string), so this never resolves an
  // inversion shape for it; that's an acceptable simplification, not a
  // silent wrong answer -- an unresolvable last chord just means no
  // reference shape, same as an empty progression (ease-only ranking).
  //
  // "Whichever position is currently displayed for it" only has a real
  // answer when the last progression chord IS the chord the builder/Guitar
  // tab is actively showing right now -- guitarPositionIndex is a single,
  // global "what's selected for the chord on screen" value, not a memory
  // per progression slot. When the last chord isn't what's on screen, its
  // own position 1 (the shape's default fingering) is the only honest
  // choice, since nothing else was ever "selected" for it.
  const lastProgressionEntry = progression.length > 0 ? progression[progression.length - 1] : null
  const lastChordSelection = lastProgressionEntry ? chordNameToSelection(lastProgressionEntry.chord) : null
  const lastChordDataKey = lastChordSelection
    ? toDataKey(lastChordSelection.root, lastChordSelection.quality, lastChordSelection.extension)
    : null
  const lastChordGuitarPositions = lastChordDataKey
    ? resolveGuitarPositions(lastChordDataKey, false, 'none', null)
    : null
  const lastChordIsOnScreen = !hasSlashBass && lastChordDataKey === dataKey
  const referenceGuitarShape = lastChordGuitarPositions
    ? lastChordGuitarPositions[lastChordIsOnScreen ? Math.min(guitarPositionIndex, lastChordGuitarPositions.length - 1) : 0]
    : null

  // While a progression is playing, the Guitar tab must track whichever
  // chord is actually sounding, the same way the piano already does via
  // playingChordNotes -- otherwise the fretboard stays frozen on whatever
  // the builder had selected before Play was pressed while the audio (and
  // the piano) moves through the whole progression underneath it (Field
  // Test, 12 Aug 2026). Same resolution pipeline as referenceGuitarShape
  // above (display name -> selector state -> CHORD_DATA key -> curated
  // shape), always position 1 since no "selected position" exists for an
  // arbitrary progression chord. Resolves to null for a name the pipeline
  // can't parse (e.g. a slash chord in the progression) or with no curated
  // shape -- in that case the builder's own live root/shape/positions below
  // are used unchanged for that beat, same "acceptable simplification, not
  // a silent wrong answer" precedent already used for referenceGuitarShape.
  const playingChordLookup = playingChordName ? guitarShapeForChordName(playingChordName) : null
  const playingGuitarShape = playingChordLookup?.shape ?? null

  // Suggested-chord preview only makes sense for the chord it was shown under
  useEffect(() => {
    setPreviewIndex(null)
  }, [dataKey])

  // Reset the bass note whenever it stops being selectable, so switching
  // back to an eligible quality later doesn't resurrect a stale slash choice
  useEffect(() => {
    if (!bassEligible && bassNote !== 'none') {
      setSelection(sel => ({ ...sel, bassNote: 'none' }))
    }
  }, [bassEligible]) // eslint-disable-line react-hooks/exhaustive-deps

  const previewNotes = previewIndex != null ? chordEntry?.next?.[previewIndex]?.notes : null

  useEffect(() => {
    localStorage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(progression))
  }, [progression])

  // Adds after the currently tapped chip (whichever chord is driving the
  // builder right now), not always at the end -- if the last chip is what's
  // tapped (the default, e.g. nothing's been tapped yet) that's the same
  // position as appending, so this is a strict generalization of the old
  // always-append behavior, not a different one.
  //
  // guitarPositionIndex/keysPositionIndex are stored ON the entry itself,
  // not left as a transient global selection -- a chord's chosen guitar
  // neck position and Keys voicing (Close/Drop-2/Split) are part of what
  // was actually added, so they need to survive as long as the chord does
  // (tapping back to it later, or playback, both read these back). Callers
  // that add a chord OTHER than whatever's live in the builder (a
  // suggestion, a reverse-lookup result) have no "position I picked" to
  // report -- there's no position selector for either -- so they default to
  // 0/0 (Close, position 1), which is also what those chords would already
  // show if you tapped into them.
  function addToProgression(chord, notes, entryGuitarPositionIndex = 0, entryKeysPositionIndex = 0) {
    if (!isPro && progression.length >= PROGRESSION_LIMIT) {
      setProgressionTeaser(PROGRESSION_TEASER)
      if (teaserTimeoutRef.current) clearTimeout(teaserTimeoutRef.current)
      teaserTimeoutRef.current = setTimeout(() => setProgressionTeaser(''), 4000)
      return
    }
    clearLoadUndo()
    setActiveTemplate(null)
    const insertAt = (tappedChordIndex != null && tappedChordIndex < progression.length)
      ? tappedChordIndex + 1
      : progression.length
    const entry = { chord, notes, guitarPositionIndex: entryGuitarPositionIndex, keysPositionIndex: entryKeysPositionIndex }
    setProgression(prev => [...prev.slice(0, insertAt), entry, ...prev.slice(insertAt)])
    // The freshly-inserted chord becomes the new tapped position, so adding
    // several suggestions in a row while exploring from a middle chip keeps
    // extending forward from there instead of stacking in reverse order.
    setTappedChordIndex(insertAt)
  }

  // Bulk sibling of addToProgression, for importing an ordered sequence of
  // chords in one shot (MIDI range import). addToProgression reads
  // progression.length/tappedChordIndex from this render's own closured
  // state, which is fine for a single call but would silently reorder the
  // sequence if called once per chord in a loop: every call in the same
  // synchronous batch would see the SAME pre-loop progression/index (React
  // doesn't re-render mid-loop), so each chord would compute the same
  // insertAt and effectively race to the same slot rather than building on
  // the previous insert. Computing insertAt/the cap ONCE here and inserting
  // every chord via a single setProgression call sidesteps that entirely.
  //
  // Free-tier cap still applies here for consistency with addToProgression/
  // loadTemplate, even though today only Pro users can reach a MIDI import
  // in the first place (it's Pro-gated at the UI level) -- so this path
  // never actually truncates yet, but stays correct if that ever changes.
  function addProgressionSequence(chords) {
    if (!chords || chords.length === 0) return
    const insertAt = (tappedChordIndex != null && tappedChordIndex < progression.length)
      ? tappedChordIndex + 1
      : progression.length
    const allowed = isPro ? chords : chords.slice(0, Math.max(0, PROGRESSION_LIMIT - progression.length))
    if (allowed.length < chords.length) {
      setProgressionTeaser(PROGRESSION_TEASER)
      if (teaserTimeoutRef.current) clearTimeout(teaserTimeoutRef.current)
      teaserTimeoutRef.current = setTimeout(() => setProgressionTeaser(''), 4000)
    }
    if (allowed.length === 0) return
    clearLoadUndo()
    setActiveTemplate(null)
    setProgression(prev => [
      ...prev.slice(0, insertAt),
      // Same "no position was ever picked for these" default as
      // addToProgression's own suggestion/reverse-lookup callers -- a range
      // import has no guitar/Keys position selector of its own either.
      ...allowed.map(({ chord, notes }) => ({ chord, notes, guitarPositionIndex: 0, keysPositionIndex: 0 })),
      ...prev.slice(insertAt),
    ])
    setTappedChordIndex(insertAt + allowed.length - 1)
  }

  function clearProgression() {
    clearLoadUndo()
    setActiveTemplate(null)
    setProgression([])
    setTappedChordIndex(null)
  }

  // Removes whichever chord is selected, not the last one. With the
  // arrangement laid out as a grid every cell is selectable, which made
  // "last" the one chord you could point at and still not remove.
  function removeSelected() {
    if (tappedChordIndex == null || tappedChordIndex >= progression.length) return
    const removedIndex = tappedChordIndex
    clearLoadUndo()
    setActiveTemplate(null)
    setProgression(prev => prev.filter((_, index) => index !== removedIndex))
    // Selection closes the gap rather than clearing: it lands on whichever
    // chord slid into the removed slot, or on the new last chord when the
    // removed one was at the end. Clearing instead would turn removing a run
    // of chords into a select-remove-select shuffle.
    setTappedChordIndex(() => {
      const remaining = progression.length - 1
      return remaining === 0 ? null : Math.min(removedIndex, remaining - 1)
    })
  }

  // Templates only ever ADD chords (never merge into an existing one), so
  // loading one over a non-empty progression is a full, hard-to-undo
  // replacement -- worth a confirm. An empty progression has nothing to
  // lose, so it loads straight away. Either way, the progression as it
  // stood right before this call is kept for one undoLoad() (see
  // armLoadUndo above) so a confirmed replace is never truly a one-way door.
  function loadTemplate(entries, template) {
    if (!isPro && entries.length > PROGRESSION_LIMIT) {
      setProgressionTeaser(PROGRESSION_TEASER)
      if (teaserTimeoutRef.current) clearTimeout(teaserTimeoutRef.current)
      teaserTimeoutRef.current = setTimeout(() => setProgressionTeaser(''), 4000)
      return
    }
    if (progression.length > 0) {
      const confirmed = window.confirm(
        `Replace your current progression (${progression.length} chord${progression.length === 1 ? '' : 's'}) with "${template.name}"?`
      )
      if (!confirmed) return
    }
    armLoadUndo({ progression, activeTemplate, tappedChordIndex })
    setProgression(entries)
    setActiveTemplate({ name: template.name, description: template.description })
    // Same "last chord added becomes selected" rule every other add path
    // (single chord, suggestion, reverse-lookup, MIDI range import) already
    // follows -- a template load is a bulk add, not a reason to leave the
    // arrangement with nothing selected.
    setTappedChordIndex(entries.length > 0 ? entries.length - 1 : null)
  }

  function loadSavedProgression(chords) {
    clearLoadUndo()
    setActiveTemplate(null)
    setProgression(chords)
    // Same rule as loadTemplate just above.
    setTappedChordIndex(chords.length > 0 ? chords.length - 1 : null)
  }

  // Drag-to-reorder: splice the moved chord into its new position, and slide
  // tappedChordIndex along with whatever it was pointing at (itself, if that
  // chord is what moved; otherwise shifted by one only if it sat between the
  // old and new position) so a reorder never silently detaches the tapped
  // chip from the chord it was actually tapped on.
  function moveChord(fromIndex, toIndex) {
    if (fromIndex === toIndex) return
    clearLoadUndo()
    setActiveTemplate(null)
    setProgression(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
    setTappedChordIndex(prev => {
      if (prev == null) return prev
      if (prev === fromIndex) return toIndex
      if (fromIndex < toIndex) {
        if (prev > fromIndex && prev <= toIndex) return prev - 1
      } else if (prev >= toIndex && prev < fromIndex) {
        return prev + 1
      }
      return prev
    })
  }

  // Generalized from "tap the last chip" (Session 11) to any chip -- tapping
  // always records the tapped position (so the next add-to-progression
  // inserts after it) even if the name doesn't parse into a selector state
  // for some reason; the two are independent, position tracking shouldn't
  // depend on display-parsing succeeding.
  //
  // Also restores THIS chord's own stored guitarPositionIndex/
  // keysPositionIndex (Sessions 11/36's tap-to-select, extended) -- reading
  // straight from progression[index] rather than trusting the chordName
  // param, since the param only round-trips display text, not the entry's
  // real stored fields. `?? 0` covers entries persisted before these fields
  // existed (older localStorage progressions, saved progressions, template
  // loads) with the same Close/position-1 default they always implicitly
  // had.
  function handleSelectChord(index, chordName) {
    setTappedChordIndex(index)
    const sel = chordNameToSelection(chordName)
    if (sel) setSelection({ ...sel, bassNote: 'none' })
    const entry = progression[index]
    setGuitarPositionIndex(entry?.guitarPositionIndex ?? 0)
    setKeysPositionIndex(entry?.keysPositionIndex ?? 0)
  }

  // NextChordSuggestions' "+ Add to progression" adds a chord the builder
  // never actually built (it's a suggestion, not the live selection), so
  // unlike ChordOutputPanel's own Add -- which already reflects whatever's
  // in the builder -- nothing here otherwise syncs the builder to match.
  // Chains this onto addToProgression the same way handleSelectChord synced
  // the builder for a tapped chip, so a suggestion just added behaves as if
  // its chip had been tapped immediately after: the builder/suggestions
  // panel picks it up without a trip to the progression strip, letting a
  // user keep chaining suggestion-to-suggestion. addToProgression always
  // inserts suggestion entries at guitar/keys position 0, so those are the
  // values restored here rather than read back off the just-inserted entry.
  function handleAddSuggestionToProgression(chord, notes) {
    addToProgression(chord, notes)
    const sel = chordNameToSelection(chord)
    if (sel) setSelection({ ...sel, bassNote: 'none' })
    setGuitarPositionIndex(0)
    setKeysPositionIndex(0)
  }

  // The ChordSelector's own dropdowns (Root/Quality/Extension/Bass note) are
  // the one place a genuinely NEW chord gets built from scratch -- unlike
  // handleSelectChord (tapping a progression chip), there's no prior
  // position to restore here, so this always resets back to Close/position
  // 1, same "always reset to position 1" rule Session 29 used for the
  // guitar neck-position selector. Kept as an explicit reset on this one
  // real call site instead of a blanket "any time dataKey changes" effect,
  // since that blanket form couldn't tell a genuine new-chord edit apart
  // from handleSelectChord's own restore immediately overwriting it.
  function handleBuilderSelectionChange(newSelection) {
    setSelection(newSelection)
    setGuitarPositionIndex(0)
    setKeysPositionIndex(0)
  }

  const symbol = useMemo(() => buildChordSymbol(root, quality, extension), [root, quality, extension])
  const tonalChord = useMemo(() => (symbol ? Chord.get(symbol) : null), [symbol])

  const displayName = useMemo(() => {
    const base = (!tonalChord || !tonalChord.tonic) ? (symbol || '—') : (tonalChord.symbol || symbol)
    return appendSlashSymbol(base, effectiveBassNote, root)
  }, [tonalChord, symbol, effectiveBassNote, root])

  // Editing a chord's Keys voicing or guitar neck position WHILE it's the
  // tapped progression entry (Field Test, 12 Aug 2026: the keyboard/
  // fretboard visibly updated, but playback kept sounding whatever was
  // stored when the chord was originally added) has to write the new value
  // back into that entry, not just the transient global selector state --
  // otherwise the change is only ever a live preview, never actually saved.
  // Guarded by the tapped entry's own chord name still matching what's live
  // in the builder: editing the ChordSelector's dropdowns away from that
  // entry doesn't itself clear tappedChordIndex (see handleSelectChord's
  // own comment), so without this guard a position change made after
  // building an unrelated chord would silently overwrite a stale slot.
  function handleKeysPositionChange(index) {
    setKeysPositionIndex(index)
    if (tappedChordIndex != null && progression[tappedChordIndex]?.chord === displayName) {
      setProgression(prev => prev.map((entry, i) => (i === tappedChordIndex ? { ...entry, keysPositionIndex: index } : entry)))
    }
  }

  function handleGuitarPositionChange(index) {
    setGuitarPositionIndex(index)
    if (tappedChordIndex != null && progression[tappedChordIndex]?.chord === displayName) {
      setProgression(prev => prev.map((entry, i) => (i === tappedChordIndex ? { ...entry, guitarPositionIndex: index } : entry)))
    }
  }

  // Notes to highlight: use CHORD_DATA notes if available, else derive from tonal at octave 4,
  // re-voiced for the selected bass note (Pro-gated slash chords) -- see computeSlashNotes
  const chordNotes = computeSlashNotes(chordEntry?.notes || [], effectiveBassNote, root)

  const available = !!chordEntry

  // Keys-tab voicing positions: Close (whatever chordNotes already is --
  // works correctly for slash/inversion chords with zero extra handling,
  // since it's the same array), Drop-2, and a left-hand/right-hand split.
  // Position 1 is always free; 2-3 are Pro-gated. Clamping here (not just
  // disabling the tab buttons in InstrumentDock) means a free user can
  // never actually hear/see position 2/3 even if keysPositionIndex state
  // somehow held a stale non-zero value -- same defense-in-depth pattern
  // already used for effectiveBassNote and the guitar position selector.
  // applyDrop2 only needs to protect the bass from inversion when there's a
  // genuinely selected slash/inversion bass active -- for a plain root-
  // position chord, inverting which note ends up lowest is Drop-2's
  // intended, characterful behavior (the true root still gets highlighted
  // correctly below via the separate rootNote prop).
  const keysPositions = [chordNotes, applyDrop2(chordNotes, hasSlashBass), applyLeftHandSplit(chordNotes)]
  const maxAllowedKeysIndex = isPro ? keysPositions.length - 1 : 0
  const activeKeysIndex = Math.min(keysPositionIndex, maxAllowedKeysIndex)
  const displayedPianoNotes = keysPositions[activeKeysIndex]

  async function handleAuditionChord() {
    if (auditionPlaying || displayedPianoNotes.length === 0) return
    setAuditionPlaying(true)
    try {
      await startAudioContext()
      if (!auditionSynthRef.current) auditionSynthRef.current = createKeysSynth()
      auditionSynthRef.current.triggerAttackRelease(displayedPianoNotes, CHORD_AUDITION_SECONDS)
      auditionTimeoutRef.current = setTimeout(() => setAuditionPlaying(false), CHORD_AUDITION_SECONDS * 1000 + 200)
    } catch {
      setAuditionPlaying(false)
    }
  }

  // See intervalsForNotes above -- resolved against whichever notes are
  // actually on screen (Close/Drop-2/Split, slash bass and all), not
  // tonalChord's own root-position array.
  const intervals = intervalsForNotes(tonalChord, displayedPianoNotes)

  // While a progression plays, the piano should track whatever's actually
  // sounding (ProgressionStrip applies the same selected voicing transform
  // per-chord before it ever reaches here).
  const pianoNotes = playingChordNotes || displayedPianoNotes
  // Only the LH/RH split gets its own bass highlight color -- Close and
  // Drop-2 keep the ordinary root/chord-tone convention. Split always places
  // the isolated bass at notes[0], live or during playback alike, so this
  // reads pianoNotes[0] directly instead of nulling out during playback.
  const pianoBassHighlight = activeKeysIndex === 2 ? pianoNotes[0] : null
  const pianoPreviewNotes = playingChordNotes ? null : previewNotes
  // Drop-2 deliberately re-sorts by pitch height, so notes[0] of the
  // transformed array isn't reliably the actual root anymore -- pass the
  // true root/bass explicitly so PianoDisplay's gold highlight always lands
  // on the real root, not whichever note happened to end up lowest. During
  // playback that's playingRootNote (captured alongside playingChordNotes,
  // see handlePlayingChordChange); live, it's chordNotes[0] before any
  // voicing transform.
  const pianoRootNote = playingChordNotes ? playingRootNote : (chordNotes[0] ?? null)

  // #82 removed the on-mount auto-open when the welcome overlay took over
  // first-run duty, leaving shouldAutoOpenWalkthrough exported but uncalled --
  // which meant the storage key was written on close and never read. It runs
  // again now, but gated on the welcome overlay being dismissed: firing on
  // mount would put a tour behind a modal that covers everything it points at.
  useEffect(() => {
    if (introOpen) return
    if (shouldAutoOpenWalkthrough(path, localStorage)) setWalkthroughFlow(walkthroughFlowForPath(path))
  }, [introOpen, path])

  // A tab click scrolls the track; a swipe scrolls it directly. Both have to
  // end with the same tab marked current, so the tab drives scroll position
  // and this observer drives the tab from scroll position -- without the
  // second direction, swiping to Identify would leave Build looking current.
  // Unlike useCardDeck's observer this runs at every width: the workspace
  // slides at desktop sizes too, where the deck inside a card does not.
  useEffect(() => {
    const track = slidesRef.current
    if (!track) return undefined
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const key = entry.target.dataset.page
          if (key) setWorkspacePage(key)
        }
      },
      { root: track, threshold: 0.6 },
    )
    Object.values(slideRefs.current).forEach(slide => { if (slide) observer.observe(slide) })
    return () => observer.disconnect()
  }, [])

  const currentPage = WORKSPACE_PAGES.find(page => page.key === workspacePage) ?? WORKSPACE_PAGES[0]

  function showWorkspacePage(page) {
    setSheetExpanded(false)
    setWorkspacePage(page)
    slideRefs.current[page]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
  }

  // Opening the Progression workspace closes the suggestions overlay: it
  // deliberately sits ABOVE the dock rather than covering it (see
  // .overlay-page--docked), so without this the workspace would expand
  // underneath it. Identify and Templates need no such handling any more --
  // they are slides beside Build now, not overlays on top of it.
  function handleProgressionExpandedChange(next) {
    if (next) setSuggestionsOpen(false)
    setSheetExpanded(next)
  }

  // The dock echoes whatever is actually sounding during progression
  // playback, and the builder's own chord the rest of the time -- the same
  // rule pianoNotes already follows above, so the name and the miniature
  // keyboard beneath it can never describe two different chords.
  const dockChordName = playingChordName || displayName
  const canPlayChord = displayedPianoNotes.length > 0

  return (
    <div className="app">
      {/* While feedback is open, everything behind its modal is inert so
          keyboard and screen-reader focus stays inside the feedback flow. */}
      <div className="app__background" inert={feedbackOpen} aria-hidden={feedbackOpen ? 'true' : undefined}>
      <header className="app__header">
        <div className="app__header-inner">
          <div className="app__logo">
            <a href="https://www.kyndalearning.co.uk" className="app__logo-link">
              <img src={resolvedTheme === 'dark' ? '/kynda-logo-white.png' : '/kynda-logo-full.png'} alt="Kynda Learning" />
            </a>
            <span className="app__header-divider" aria-hidden="true" />
            <Link to="/tools" className="app__suite-link">Tools</Link>
          </div>
          <div className="app__header-tool">
            <button
              type="button"
              className="app__guided-learning-link"
              onClick={() => setPath(path === 'learn' ? 'build' : 'learn')}
              aria-current={path === 'learn' ? 'page' : undefined}
            >
              <span className="app__guided-label app__guided-label--desktop">
                {path === 'learn' ? '← Chord tool' : 'Guided learning'}
              </span>
              <span className="app__guided-label app__guided-label--mobile" aria-hidden="true">
                {path === 'learn' ? '← Tool' : 'Learn'}
              </span>
            </button>
            <button
              className="app__header-feedback-btn"
              onClick={() => setFeedbackOpen(true)}
              aria-label="Share feedback"
            >
              Share feedback
            </button>
            <ThemeToggle preference={themePreference} onChange={setThemePreference} />
            <button
              className="app__hamburger"
              onClick={() => setMenuOpen(o => !o)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              <span className="app__hamburger-line" />
              <span className="app__hamburger-line" />
              <span className="app__hamburger-line" />
            </button>
            <button
              className="app__help-btn"
              onClick={() => {
                // The tool walkthrough spotlights #wt-root, which lives in the
                // Build slide -- inert while you are on Identify or Templates,
                // so the first step would point at something you cannot reach.
                if (path !== 'learn') showWorkspacePage('build')
                setWalkthroughFlow(walkthroughFlowForPath(path))
              }}
              aria-label={path === 'learn' ? 'How to use Learn' : 'How to use Chord Moves'}
            >
              ?
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="app__mobile-menu">
            <SuiteMenuLinks
              className="app__mobile-menu-link"
              currentClassName="app__mobile-menu-link--current"
              childClassName="app__mobile-menu-link--child"
              onNavigate={() => setMenuOpen(false)}
            />
            <button
              className="app__mobile-menu-link app__mobile-menu-feedback"
              onClick={() => { setMenuOpen(false); setFeedbackOpen(true) }}
            >
              Share feedback
            </button>
            <div className="app__mobile-menu-theme">
              <span className="app__mobile-menu-theme-label">Appearance</span>
              <ThemeToggle preference={themePreference} onChange={setThemePreference} />
            </div>
          </div>
        )}
      </header>

      {path === 'learn' ? (
        <LearnPath onBackToBuild={() => setPath('build')} />
      ) : (
      <>
      <div className="app__drawer-wrapper">
        <main className="app__panel app__builder-panel">
          <div className={`app__panel-inner ${sheetExpanded ? '' : 'app__panel-inner--sheet-collapsed'}`}>
            <section className="app__builder-intro" aria-labelledby="builder-intro-title">
              <div className="app__builder-intro-copy">
                {/* Names the page you are on. Build/Identify/Templates are
                    peers now, so a fixed "Build, hear and save a chord" would
                    be wrong on two of the three -- and giving each slide its
                    own header instead would put a second heading above every
                    panel, the duplication #84 and #85 spent their time
                    removing. */}
                <p className="app__eyebrow">{currentPage.eyebrow}</p>
                <h1 id="builder-intro-title">{currentPage.title}</h1>
              </div>
              <div className="app__workspace-actions">
                {/* Pro users need a way back to /upgrade too -- it is the
                    only place that can log them out, and every other link to
                    it is hidden once isPro is true, which used to leave the
                    page reachable only by typing the URL. */}
                {isPro
                  ? (
                    <Link to="/upgrade" className="app__pro-badge">
                      Pro<span className="sr-only"> — unlocked on this device, manage</span>
                    </Link>
                  )
                  : <Link to="/upgrade" className="app__upgrade-link">Upgrade <span>to Pro</span></Link>}
              </div>
            </section>

            {/* Folder-style tabs physically attached to the workspace surface
                on desktop (the active tab's own edge paints over the surface's
                border so the two read as one sheet), collapsing to an ordinary
                horizontal selector below 900px -- see App.css. */}
            <div className="app__workspace-shell">
              <nav id="wt-workspace-nav" className="app__workspace-nav" aria-label="Chord Moves pages">
                {WORKSPACE_PAGES.map(page => {
                  const isActive = page.key === workspacePage
                  return (
                    <button
                      key={page.key}
                      id={`wt-tab-${page.key}`}
                      type="button"
                      className={`app__workspace-tab ${isActive ? 'app__workspace-tab--active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => showWorkspacePage(page.key)}
                    >
                      {page.label}
                    </button>
                  )
                })}
              </nav>

              {/* All three pages are mounted at once so the track can slide
                  between them, which means the two you are not on are still in
                  the tab order unless they are made inert -- otherwise tabbing
                  off Build lands in Identify's note keys and drags the track
                  along with the focus. */}
              <div className="app__workspace-slides" ref={slidesRef}>
              <section
                className="app__section app__builder-workspace app__workspace-slide"
                data-page="build"
                ref={el => { slideRefs.current.build = el }}
                aria-label="Build and preview a chord"
                inert={workspacePage !== 'build'}
              >
                <div className="app__phone-panel-tabs" role="group" aria-label="Build or explore the current chord">
                  <button
                    type="button"
                    aria-pressed={phonePanel === 'build'}
                    className={phonePanel === 'build' ? 'app__phone-panel-tab app__phone-panel-tab--active' : 'app__phone-panel-tab'}
                    onClick={() => setPhonePanel('build')}
                  >
                    Build a chord
                  </button>
                  <button
                    type="button"
                    aria-pressed={phonePanel === 'chord'}
                    className={phonePanel === 'chord' ? 'app__phone-panel-tab app__phone-panel-tab--active' : 'app__phone-panel-tab'}
                    onClick={() => setPhonePanel('chord')}
                  >
                    Explore
                  </button>
                </div>

                <div className={`app__builder-controls app__phone-panel ${phonePanel === 'build' ? 'app__phone-panel--active' : ''}`}>
                  <ChordSelector
                    root={root}
                    quality={quality}
                    extension={extension}
                    bassNote={bassNote}
                    isPro={isPro}
                    onChange={handleBuilderSelectionChange}
                  />
                </div>

                <div className={`app__builder-result app__phone-panel ${phonePanel === 'chord' ? 'app__phone-panel--active' : ''}`}>
                  <ChordOutputPanel
                    chordName={displayName}
                    notes={displayedPianoNotes}
                    intervals={intervals}
                    available={available}
                    onAddToProgression={(chord, notes) => addToProgression(chord, notes, guitarPositionIndex, keysPositionIndex)}
                    onOpenSuggestions={() => { setSheetExpanded(false); setSuggestionsOpen(true) }}
                    hasSuggestions={!!chordEntry?.next}
                    isPro={isPro}
                    onPlayChord={handleAuditionChord}
                    isPlayingChord={auditionPlaying}
                    canPlayChord={canPlayChord}
                  />
                </div>
              </section>

              <section
                className="app__section app__workspace-slide"
                data-page="find"
                ref={el => { slideRefs.current.find = el }}
                aria-label="Find a chord from its notes"
                inert={workspacePage !== 'find'}
              >
                <ReverseVoicingFinder
                  onAddToProgression={addToProgression}
                  onImportSequence={addProgressionSequence}
                  progression={progression}
                  referenceGuitarShape={referenceGuitarShape}
                  isPro={isPro}
                />
              </section>

              <section
                className="app__section app__workspace-slide"
                data-page="templates"
                ref={el => { slideRefs.current.templates = el }}
                aria-label="Start with a proven progression"
                inert={workspacePage !== 'templates'}
              >
                <ProgressionTemplates
                  keyRoot={templateKeyRoot}
                  keyMode={templateKeyMode}
                  onKeyRootChange={setTemplateKeyRoot}
                  onKeyModeChange={setTemplateKeyMode}
                  onLoad={(entries, template) => { loadTemplate(entries, template); showWorkspacePage('build') }}
                />
              </section>
              </div>
            </div>

            <p className="app__workspace-hint">Build, Identify and Templates are three ways to find a chord. Your progression waits in the bar below.</p>
          </div>
        </main>
      </div>

      <OverlayPage isOpen={suggestionsOpen} onClose={() => setSuggestionsOpen(false)} eyebrow={displayName} title="Choose where this chord goes next" wide docked>
        {available && chordEntry?.next && (
          <NextChordSuggestions
            suggestions={chordEntry.next}
            currentNotes={chordNotes}
            bpm={bpm}
            previewIndex={previewIndex}
            onPreviewChange={setPreviewIndex}
            onAddToProgression={handleAddSuggestionToProgression}
            theme={resolvedTheme}
            isPro={isPro}
          />
        )}
      </OverlayPage>

      <ProgressionStrip
        expanded={sheetExpanded}
        onExpandedChange={handleProgressionExpandedChange}
        currentChordName={dockChordName}
        onPlayChord={handleAuditionChord}
        isChordPlaying={auditionPlaying}
        canPlayChord={canPlayChord}
        progression={progression}
        selectedChordIndex={tappedChordIndex}
        bpm={bpm}
        onBpmChange={setBpm}
        onClear={clearProgression}
        onRemoveSelected={removeSelected}
        onSelectChord={handleSelectChord}
        onReorder={moveChord}
        onLoadSaved={loadSavedProgression}
        templateInfo={activeTemplate}
        canUndoLoad={!!loadUndoSnapshot}
        onUndoLoad={undoLoad}
        teaserMessage={progressionTeaser}
        onPlayingChordChange={handlePlayingChordChange}
        chordNotes={pianoNotes}
        previewNotes={pianoPreviewNotes}
        bassHighlightNote={pianoBassHighlight}
        keysRootNote={pianoRootNote}
        keysPositionIndex={keysPositionIndex}
        onKeysPositionChange={handleKeysPositionChange}
        guitarPositionIndex={guitarPositionIndex}
        onGuitarPositionChange={handleGuitarPositionChange}
        root={playingGuitarShape ? playingChordLookup.root : root}
        guitarShape={playingGuitarShape || guitarShapeToShow}
        guitarSlashNotice={guitarSlashNotice}
        guitarInversionUnavailable={guitarInversionUnavailable}
        guitarPositions={playingChordName ? null : guitarPositions}
        isPro={isPro}
      />
      </>
      )}
      </div>

      <OverlayPage isOpen={introOpen} intro eyebrow="Welcome to Chord Moves" title="Find the next chord without losing your place">
        <div className="app__intro-page">
          <p className="app__intro-lead">Three ways to find a chord, side by side—swipe or tap between them. Whatever you find lands in the progression bar at the bottom.</p>
          <ol className="app__intro-steps">
            <li><span>1</span><div><strong>Build</strong><p>Pick a root and quality from a list, and hear the chord.</p></div></li>
            <li><span>2</span><div><strong>Identify</strong><p>Know the notes but not the name? Tap them and get the shapes that fit.</p></div></li>
            <li><span>3</span><div><strong>Templates</strong><p>Start from a progression that already works, in any key.</p></div></li>
          </ol>
          <button
            type="button"
            className="app__intro-start"
            onClick={() => { setPath('build'); setIntroOpen(false) }}
          >
            Start building
          </button>
        </div>
      </OverlayPage>

      {/* Feedback panel — state persists while closed */}
      <FeedbackPanel
        isOpen={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        theme={resolvedTheme}
      />

      <WalkthroughOverlay
        flow={walkthroughFlow ?? walkthroughFlowForPath(path)}
        isOpen={walkthroughFlow !== null}
        onClose={() => setWalkthroughFlow(null)}
      />
    </div>
  )
}
