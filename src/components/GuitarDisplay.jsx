import { Note } from 'tonal'
import { getNoteColors } from '../utils/noteColors'
import './GuitarDisplay.css'

// Standard tuning, low string to high: E A D G B e
const STRING_COUNT = 6
const OPEN_PITCH_CLASS = [4, 9, 2, 7, 11, 4]
const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e']

const WINDOW_SIZE = 5
const STRING_SPACING = 30
const FRET_WIDTH = 88
const DOT_RADIUS = 13
const TOP_PAD = 28
const LEFT_PAD = 58
const RIGHT_PAD = 24
const BOTTOM_PAD = 34

const GRID_HEIGHT = STRING_SPACING * (STRING_COUNT - 1)
const GRID_WIDTH = FRET_WIDTH * WINDOW_SIZE
const SVG_WIDTH = LEFT_PAD + GRID_WIDTH + RIGHT_PAD
const SVG_HEIGHT = TOP_PAD + GRID_HEIGHT + BOTTOM_PAD

function stringY(i) {
  return TOP_PAD + i * STRING_SPACING
}

function fretX(row) {
  // row 0 = the nut/left line, row 1..WINDOW_SIZE = fret lines to the right
  return LEFT_PAD + row * FRET_WIDTH
}

const FALLBACK_SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

// Match the piano's approach: label a pitch class the way the chord's own
// notes spell it, rather than a fixed sharp-only convention -- including
// spellings a single-accidental lookup table cannot hold, like the E# that
// is the #11 of B, or the Cb in an Abm chord.
function findSpelling(pitchClass, notes) {
  for (const note of notes || []) {
    if (Note.chroma(note) === pitchClass) {
      return Note.pitchClass(note).replace(/#/g, '♯').replace(/b/g, '♭')
    }
  }
  return FALLBACK_SHARP_NAMES[pitchClass]
}

export default function GuitarDisplay({ root, shape, notes, compact }) {
  if (!shape) return null

  // Same root/chord-tone colors as PianoDisplay, read from the single
  // shared source (index.css's --note-color-* custom properties) instead
  // of a second independently-hardcoded pair of hex values.
  const noteColors = getNoteColors()
  const rootPc = root ? Note.chroma(root) : undefined
  const frets = shape.frets

  const numericFrets = frets.filter(f => f !== 'x').map(Number)
  const maxFret = Math.max(...numericFrets, 0)
  const positiveFrets = numericFrets.filter(f => f > 0)
  const minPositiveFret = positiveFrets.length ? Math.min(...positiveFrets) : 1
  const baseFret = maxFret <= WINDOW_SIZE ? 1 : minPositiveFret

  return (
    <div className={`guitar-display ${compact ? 'guitar-display--compact' : ''}`} id="wt-guitar">
      {!compact && <h2 className="guitar-display__title">On the Fretboard</h2>}
      <div className="guitar-display__neck-scroll">
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          width={SVG_WIDTH}
          height={SVG_HEIGHT}
          xmlns="http://www.w3.org/2000/svg"
          className="guitar-display__svg"
          role="img"
          aria-label={`Guitar fretboard${root ? `, root ${root}` : ''}${baseFret > 1 ? `, starting at fret ${baseFret}` : ''}`}
        >
        {/* Like the piano keys, the neck keeps a fixed neutral instrument
            surface in both themes so note colours remain predictable. */}
        <rect
          x={fretX(0)}
          y={stringY(0)}
          width={GRID_WIDTH}
          height={GRID_HEIGHT}
          fill="#f3f6f6"
          stroke="#d5dddd"
          strokeWidth={1.5}
          rx={4}
        />

        {/* Nut or fret-position label */}
        {baseFret === 1 ? (
          <rect
            x={fretX(0)}
            y={stringY(0)}
            width={4}
            height={GRID_HEIGHT}
            fill="#1a1a1a"
          />
        ) : (
          <rect
            x={fretX(0)}
            y={stringY(0)}
            width={1.5}
            height={GRID_HEIGHT}
            fill="#c5cecf"
          />
        )}

        {/* Fret lines */}
        {Array.from({ length: WINDOW_SIZE }, (_, i) => i + 1).map(row => (
          <g key={row}>
            <rect
              x={fretX(row)}
              y={stringY(0)}
              width={1.5}
              height={GRID_HEIGHT}
              fill="#c5cecf"
            />
            <text
              x={fretX(row) - FRET_WIDTH / 2}
              y={SVG_HEIGHT - 9}
              textAnchor="middle"
              fontSize={11}
              fontFamily="Inter, sans-serif"
              fill="#999"
            >
              {baseFret + row - 1}
            </text>
          </g>
        ))}

        {/* Strings */}
        {STRING_LABELS.map((_, i) => (
          <rect
            key={i}
            x={fretX(0)}
            y={stringY(i) - (1.15 - i * 0.12)}
            width={GRID_WIDTH}
            height={2.3 - i * 0.24}
            fill="#929d9f"
          />
        ))}

        {/* Barre */}
        {shape.barre && (
          <rect
            x={fretX(shape.barre.fret - baseFret + 1) - FRET_WIDTH / 2 - DOT_RADIUS}
            y={stringY(shape.barre.from) - DOT_RADIUS}
            width={DOT_RADIUS * 2}
            height={stringY(shape.barre.to) - stringY(shape.barre.from) + DOT_RADIUS * 2}
            rx={DOT_RADIUS}
            fill="rgba(17,147,146,0.35)"
          />
        )}

        {/* Open / muted markers above the nut */}
        {frets.map((f, i) => {
          if (f === 'x') {
            return (
              <text
                key={i}
                x={LEFT_PAD - 27}
                y={stringY(i)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={13}
                fontWeight="700"
                fontFamily="Inter, sans-serif"
                fill="#999"
              >
                ✕
              </text>
            )
          }
          if (f === 0) {
            const pitchClass = OPEN_PITCH_CLASS[i]
            const isRoot = rootPc !== undefined && pitchClass === rootPc
            const color = isRoot ? noteColors.root : noteColors.chordTone
            return (
              <g key={i}>
                <circle
                  cx={LEFT_PAD - 27}
                  cy={stringY(i)}
                  r={10}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
                <text
                  x={LEFT_PAD - 27}
                  y={stringY(i)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={8.5}
                  fontWeight="700"
                  fontFamily="Inter, sans-serif"
                  fill={color}
                >
                  {findSpelling(pitchClass, notes)}
                </text>
              </g>
            )
          }
          return null
        })}

        {/* Fretted note dots */}
        {frets.map((f, i) => {
          if (f === 'x' || f === 0) return null
          const row = f - baseFret + 1
          const pitchClass = (OPEN_PITCH_CLASS[i] + f) % 12
          const isRoot = pitchClass === rootPc
          return (
            <g key={i}>
              <circle
                cx={fretX(row) - FRET_WIDTH / 2}
                cy={stringY(i)}
                r={DOT_RADIUS}
                fill={isRoot ? noteColors.root : noteColors.chordTone}
                stroke="#fff"
                strokeWidth={1.5}
              />
              <text
                x={fretX(row) - FRET_WIDTH / 2}
                y={stringY(i)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10}
                fontWeight="700"
                fontFamily="Inter, sans-serif"
                fill={isRoot ? '#7a5500' : '#ffffff'}
              >
                {findSpelling(pitchClass, notes)}
              </text>
            </g>
          )
        })}
        </svg>
      </div>
      <div className="guitar-display__legend" aria-label="Fretboard note colours">
        <span className="guitar-display__legend-item">
          <span className="guitar-display__legend-dot guitar-display__legend-dot--root" /> Root
        </span>
        <span className="guitar-display__legend-item">
          <span className="guitar-display__legend-dot guitar-display__legend-dot--chord-tone" /> Chord tone
        </span>
      </div>
    </div>
  )
}
