import { useLayoutEffect, useRef } from 'react'
import { drawFace } from './notation'
import { faceBlocks, resolveTies } from './rhythm'

// One die. White with black ink in both themes, like the physical dice.
// Notes view draws the face with no stave; blocks view shows attack /
// sustain / rest per tick group.
export function DieFace({ face, view, beatTicks, unit, tiedIn = false, tieOut = false, size = 'large' }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    if (view !== 'notes' || !ref.current) return
    try {
      drawFace(ref.current, face, { beatTicks, tieOut, tiedIn })
    } catch (err) {
      console.error('Could not draw face', face.id, err)
      ref.current.textContent = face.name
    }
  }, [face, view, beatTicks, tieOut, tiedIn])

  return (
    <span className={`rd-die rd-die--${size}`}>
      {view === 'notes' ? (
        // Keyed per view: VexFlow draws into this element outside React, so
        // React must never reuse it for the blocks (it would leave the notes
        // drawn underneath them).
        <span key="notes" className="rd-die__notes" ref={ref} />
      ) : (
        <span key="blocks" className="rd-die__blocks" style={{ gridTemplateColumns: `repeat(${beatTicks / unit}, 1fr)` }}>
          {faceBlocks(face, unit, { tiedIn, tiedOut: tieOut }).map((cell, i) => (
            <i key={i} className={`rd-block rd-block--${cell.state}${cell.tieOut ? ' rd-block--tie' : ''}`} />
          ))}
        </span>
      )}
    </span>
  )
}

export default function DieTile({ index, face, locked, rolling, onToggleLock, disabled, beatLit, ...faceProps }) {
  return (
    <div className={`rd-slot${locked ? ' rd-slot--locked' : ''}${beatLit ? ' rd-slot--lit' : ''}`}>
      <button
        type="button"
        className={`rd-die-button${rolling && !locked ? ' rd-die-button--rolling' : ''}`}
        aria-pressed={locked}
        aria-label={`Beat ${index + 1}: ${face.name}. ${locked ? 'Locked. Tap to unlock.' : 'Tap to lock.'}`}
        onClick={onToggleLock}
        disabled={disabled}
      >
        <DieFace face={face} {...faceProps} />
      </button>
      <span className="rd-slot__label" aria-hidden="true">
        <span className="rd-slot__beat">{index + 1}</span>
        <span className="rd-slot__text">{locked ? 'Locked' : 'Tap to lock'}</span>
      </span>
    </div>
  )
}

// A whole bar as one slim line of blocks, beat by beat: kept bars and phrase
// slots use it, where a row of full dice would not fit.
export function BarStrip({ faces, beatTicks, unit, label }) {
  const ties = resolveTies(faces)
  return (
    <span className="rd-strip" role="img" aria-label={label ?? faces.map(f => f.name).join(', ')}>
      {faces.map((face, i) => (
        <span key={i} className="rd-strip__beat" style={{ gridTemplateColumns: `repeat(${beatTicks / unit}, 1fr)` }}>
          {faceBlocks(face, unit, { tiedIn: i > 0 && ties[i - 1], tiedOut: ties[i] }).map((cell, j) => (
            <i key={j} className={`rd-block rd-block--${cell.state}${cell.tieOut ? ' rd-block--tie' : ''}`} />
          ))}
        </span>
      ))}
    </span>
  )
}
