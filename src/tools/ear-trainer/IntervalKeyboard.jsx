import { useCallback, useEffect, useRef, useState } from 'react'
import {
  WHITE_KEYS, BLACK_KEYS, WHITE_KEY_WIDTH, WHITE_KEY_HEIGHT,
  BLACK_KEY_WIDTH, BLACK_KEY_HEIGHT, SVG_WIDTH, SVG_HEIGHT, whiteKeyLabel,
} from '../../utils/pianoLayout'
import { resolveKeyStyle } from '../../utils/pianoKeyStyle'
import { getNoteColors } from '../../utils/noteColors'
import { useKeysPreview } from '../../shared/audio/useKeysPreview'
import './IntervalKeyboard.css'

// The just-answered interval shown on a real keyboard: the note heard first
// (gold) and the note heard second (teal), reusing PianoDisplay's own
// root/chord-tone key-coloring rules rather than a separate copy of them --
// "first"/"second" here plays the same role "root"/"chord tone" plays there.
// Keys stay tappable (via the same shared audio hook the Replay button
// already uses) so a note can be checked in isolation, not just seen.
export default function IntervalKeyboard({ notes }) {
  const noteColors = getNoteColors()
  const { playChord } = useKeysPreview()
  const [pressedNote, setPressedNote] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const playNote = useCallback(note => {
    playChord([note])
    if (timerRef.current) clearTimeout(timerRef.current)
    setPressedNote(note)
    timerRef.current = setTimeout(() => setPressedNote(null), 150)
  }, [playChord])

  const firstNote = notes[0]

  return (
    <div className="interval-keyboard">
      <div className="interval-keyboard__scroll">
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          width={SVG_WIDTH}
          height={SVG_HEIGHT}
          xmlns="http://www.w3.org/2000/svg"
          className="interval-keyboard__svg"
          role="group"
          aria-label={`Piano keyboard showing the interval from ${notes[0]} to ${notes[1]}`}
        >
          {WHITE_KEYS.map((note, i) => {
            const x = i * WHITE_KEY_WIDTH
            const style = resolveKeyStyle(note, notes, firstNote, null, '#ffffff', null, noteColors)
            const isPressed = pressedNote === note

            return (
              <g
                key={note}
                onClick={() => playNote(note)}
                style={{ cursor: 'pointer' }}
                role="button"
                aria-label={`Play ${note}`}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') playNote(note) }}
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
              </g>
            )
          })}

          {BLACK_KEYS.map(({ note, whiteIndex }) => {
            const x = whiteIndex * WHITE_KEY_WIDTH + WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 - 1
            const style = resolveKeyStyle(note, notes, firstNote, null, '#1a1a1a', null, noteColors)
            const isPressed = pressedNote === note

            return (
              <g
                key={note}
                onClick={() => playNote(note)}
                style={{ cursor: 'pointer' }}
                role="button"
                aria-label={`Play ${note}`}
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') playNote(note) }}
              >
                <rect x={x} y={0} width={BLACK_KEY_WIDTH} height={BLACK_KEY_HEIGHT} rx={3} fill={style.fill} stroke="#000" strokeWidth={1} />
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
                {style.active && (
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
        </svg>
      </div>

      <div className="interval-keyboard__legend">
        <span className="interval-keyboard__legend-item">
          <span className="interval-keyboard__legend-dot interval-keyboard__legend-dot--first" /> First note
        </span>
        <span className="interval-keyboard__legend-item">
          <span className="interval-keyboard__legend-dot interval-keyboard__legend-dot--second" /> Second note
        </span>
      </div>
    </div>
  )
}
