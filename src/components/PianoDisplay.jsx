import { useState, useRef, useCallback, useEffect } from 'react'
import { createKeysSynth, startAudioContext } from '../audio/synth'
import { getNoteColors } from '../utils/noteColors'
import { resolveKeyStyle } from '../utils/pianoKeyStyle'
import {
  WHITE_KEYS, BLACK_KEYS, WHITE_KEY_WIDTH, WHITE_KEY_HEIGHT,
  BLACK_KEY_WIDTH, BLACK_KEY_HEIGHT, SVG_WIDTH, SVG_HEIGHT, whiteKeyLabel,
} from '../utils/pianoLayout'
import './PianoDisplay.css'

// The collapsed bottom bar's mini-keyboard strip: same C3-D5 range and same
// note-matching/color logic as the full keyboard above (so nothing gets
// clipped for wide multi-octave voicings -- see Session 30's extended/
// altered chords), just drawn at a fraction of the size. Scaling the SVG's
// own width/height down while keeping its viewBox unchanged is what does
// that -- every rect, stroke and radius shrinks proportionally with it, so
// this is a real scale-down, not a crop. A collapsed bar has more spare
// horizontal room than vertical, so trading width for a short, fixed height
// is the right tradeoff there.
const MINIATURE_HEIGHT = 34
const MINIATURE_WIDTH = Math.round((SVG_WIDTH / SVG_HEIGHT) * MINIATURE_HEIGHT)

export default function PianoDisplay({ chordNotes, previewNotes, bassHighlightNote, rootNote, compact, miniature }) {
  const notes = chordNotes || []
  // The first note in a chord's data is always its root, by convention --
  // but Drop-2 deliberately re-sorts by pitch height, so whichever note
  // ends up at notes[0] after that isn't reliably the actual root anymore
  // (it's just whatever's lowest). Callers that apply a voicing transform
  // pass the true root/bass explicitly via rootNote; anything that doesn't
  // (e.g. progression playback, whose notes are never reordered) falls
  // back to the original notes[0] convention unchanged.
  const root = rootNote ?? (notes.length > 0 ? notes[0] : null)
  const noteColors = getNoteColors()

  const synthRef = useRef(null)
  const timerRef = useRef(null)
  const [pressedNote, setPressedNote] = useState(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (synthRef.current) synthRef.current.dispose()
    }
  }, [])

  const playNote = useCallback(async (note) => {
    await startAudioContext()
    if (!synthRef.current) {
      synthRef.current = createKeysSynth()
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    setPressedNote(note)
    synthRef.current.triggerAttackRelease(note, '8n')
    timerRef.current = setTimeout(() => setPressedNote(null), 150)
  }, [])

  // The mini strip in the collapsed bottom bar: purely a decorative echo of
  // whatever's lit up on the real keyboard, so it gets none of the tap
  // targets/labels/legend below -- see MINIATURE_HEIGHT/MINIATURE_WIDTH
  // above for how it still covers the same C3-D5 range without clipping.
  const keySvg = (
    <svg
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      width={miniature ? MINIATURE_WIDTH : SVG_WIDTH}
      height={miniature ? MINIATURE_HEIGHT : SVG_HEIGHT}
      xmlns="http://www.w3.org/2000/svg"
      className={`piano-display__svg ${miniature ? 'piano-display__svg--miniature' : ''}`}
      {...(miniature
        ? { 'aria-hidden': true, focusable: false }
        : { role: 'group', 'aria-label': 'Piano keyboard showing chord tones across two octaves' })}
    >
      {/* White keys */}
      {WHITE_KEYS.map((note, i) => {
        const x = i * WHITE_KEY_WIDTH
        const style = resolveKeyStyle(note, notes, root, previewNotes, '#ffffff', bassHighlightNote, noteColors)
        const isPressed = pressedNote === note

        return (
          <g
            key={note}
            opacity={style.leaving ? 0.4 : 1}
            {...(miniature
              ? {}
              : {
                  onClick: () => playNote(note),
                  style: { cursor: 'pointer' },
                  role: 'button',
                  'aria-label': `Play ${note}`,
                  tabIndex: 0,
                  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') playNote(note) },
                })}
          >
            <rect
              x={x + 1}
              y={0}
              width={WHITE_KEY_WIDTH - 2}
              height={WHITE_KEY_HEIGHT}
              rx={4}
              fill={style.fill}
              stroke="#c8c8c8"
              strokeWidth={1.5}
            />
            {isPressed && (
              <rect
                x={x + 1}
                y={0}
                width={WHITE_KEY_WIDTH - 2}
                height={WHITE_KEY_HEIGHT}
                rx={4}
                fill="rgba(17,147,146,0.18)"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {style.shared && !miniature && (
              <rect
                x={x + 4}
                y={4}
                width={WHITE_KEY_WIDTH - 8}
                height={WHITE_KEY_HEIGHT - 8}
                rx={3}
                fill="none"
                stroke={noteColors.suggested}
                strokeWidth={2.5}
                strokeDasharray="4 3"
              />
            )}
            {!miniature && (
              <text
                x={x + WHITE_KEY_WIDTH / 2}
                y={WHITE_KEY_HEIGHT - 14}
                textAnchor="middle"
                fontSize={note[0] === 'C' ? 13 : 14}
                fontWeight={style.active ? '600' : '500'}
                fontFamily="Inter, sans-serif"
                fill={style.textFill}
                style={{ pointerEvents: 'none' }}
              >
                {whiteKeyLabel(note)}
              </text>
            )}
          </g>
        )
      })}

      {/* Black keys — rendered on top */}
      {BLACK_KEYS.map(({ note, whiteIndex }) => {
        const x = whiteIndex * WHITE_KEY_WIDTH + WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 - 1
        const style = resolveKeyStyle(note, notes, root, previewNotes, '#1a1a1a', bassHighlightNote, noteColors)
        const isPressed = pressedNote === note

        return (
          <g
            key={note}
            opacity={style.leaving ? 0.4 : 1}
            {...(miniature
              ? {}
              : {
                  onClick: () => playNote(note),
                  style: { cursor: 'pointer' },
                  role: 'button',
                  'aria-label': `Play ${note}`,
                  tabIndex: 0,
                  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') playNote(note) },
                })}
          >
            <rect
              x={x}
              y={0}
              width={BLACK_KEY_WIDTH}
              height={BLACK_KEY_HEIGHT}
              rx={3}
              fill={style.fill}
              stroke="#000"
              strokeWidth={1}
            />
            {isPressed && (
              <rect
                x={x}
                y={0}
                width={BLACK_KEY_WIDTH}
                height={BLACK_KEY_HEIGHT}
                rx={3}
                fill="rgba(255,255,255,0.25)"
                style={{ pointerEvents: 'none' }}
              />
            )}
            {style.shared && !miniature && (
              <rect
                x={x + 3}
                y={3}
                width={BLACK_KEY_WIDTH - 6}
                height={BLACK_KEY_HEIGHT - 6}
                rx={2}
                fill="none"
                stroke={noteColors.suggested}
                strokeWidth={2}
                strokeDasharray="3 2"
              />
            )}
            {style.active && !miniature && (
              <text
                x={x + BLACK_KEY_WIDTH / 2}
                y={BLACK_KEY_HEIGHT - 10}
                textAnchor="middle"
                fontSize={13}
                fontWeight="600"
                fontFamily="Inter, sans-serif"
                fill={style.textFill}
                style={{ pointerEvents: 'none' }}
              >
                {style.spelling}
              </text>
            )}
          </g>
        )
      })}

      {/* Octave label */}
      {!miniature && (
        <text
          x={SVG_WIDTH - 6}
          y={SVG_HEIGHT - 4}
          textAnchor="end"
          fontSize={13}
          fill="#aaaaaa"
          fontFamily="Inter, sans-serif"
        >
          C3 – D5
        </text>
      )}
    </svg>
  )

  if (miniature) {
    return <div className="piano-display piano-display--miniature" id="wt-piano">{keySvg}</div>
  }

  return (
    <div className={`piano-display ${compact ? 'piano-display--compact' : ''}`} id="wt-piano">
      {!compact && <h2 className="piano-display__title">On the Keys</h2>}
      {/* Real 44px keys are wider than most phone screens for a full
          octave-plus keyboard -- that's the accepted tradeoff for a genuine
          44px touch target (see WHITE_KEY_WIDTH above), so the keyboard
          scrolls horizontally inside its own container rather than the SVG
          shrinking itself back down to fit. */}
      <div className="piano-display__keys-scroll">
        {keySvg}
      </div>

      {/* Documents all four note-highlight colors -- shown wherever the
          piano itself is shown (not gated behind compact/preview state),
          since root and chord-tone highlighting is relevant to every chord
          the piano displays, not just while a suggestion preview is active. */}
      <div className="piano-display__legend">
        <span className="piano-display__legend-item">
          <span className="piano-display__legend-dot piano-display__legend-dot--root" /> Root
        </span>
        <span className="piano-display__legend-item">
          <span className="piano-display__legend-dot piano-display__legend-dot--chord-tone" /> Chord tone
        </span>
        <span className="piano-display__legend-item">
          <span className="piano-display__legend-dot piano-display__legend-dot--suggested" /> Suggested chord
        </span>
        <span className="piano-display__legend-item">
          <span className="piano-display__legend-dot piano-display__legend-dot--split-bass" /> Split bass
        </span>
      </div>
    </div>
  )
}
