import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DieFace } from './DieTile'
import { resolveTies } from './rhythm'

const GROUPS = 'ABCDE'

// Projector view for a class: one big die per group, lettered A, B, C... so
// each group takes a die. Play counts in and loops the bar; the die whose
// beat is sounding lights up, so every group knows when it is on.
// Keys for the teacher at the laptop: Space play/stop, R roll, H hear it,
// arrow up/down tempo, Escape back.
export default function ClassroomView({ faces, metre, view, bpm, busy, playing, beatLight, onRoll, onHear, onPlay, onStop, onTempo, onClose }) {
  const rootRef = useRef(null)
  const ties = resolveTies(faces)
  const keys = useRef({})
  keys.current = { busy, playing, bpm, onRoll, onHear, onPlay, onStop, onTempo, onClose }

  useEffect(() => {
    const el = rootRef.current
    el?.focus()
    // Full screen where the browser allows it; the view works without it.
    el?.requestFullscreen?.().catch(() => {})
    const onKey = e => {
      const k = keys.current
      if (e.key === 'Escape') { k.onClose(); return }
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        if (e.repeat) return
        if (k.playing) k.onStop()
        else if (!k.busy) k.onPlay()
      } else if ((e.key === 'r' || e.key === 'R') && !k.busy) k.onRoll()
      else if ((e.key === 'h' || e.key === 'H') && !k.busy) k.onHear()
      else if (e.key === 'ArrowUp' && !k.busy) { e.preventDefault(); k.onTempo(k.bpm + 2) }
      else if (e.key === 'ArrowDown' && !k.busy) { e.preventDefault(); k.onTempo(k.bpm - 2) }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  const unitName = metre.unitTicks === 18 ? 'dotted crotchet' : metre.unitTicks === 6 ? 'quaver' : 'crotchet'

  return createPortal(
    <div className="rd-class" ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Rhythm Dice classroom view"
      style={{ '--n': faces.length }}>
      <header className="rd-class__bar">
        <p className="rd-class__title"><span>Rhythm Dice</span> Classroom</p>
        <p className="rd-class__metre" aria-label={`Time signature ${metre.id}${metre.grouping ? `, grouped ${metre.grouping}` : ''}`}>
          {metre.id}{metre.grouping && <small> {metre.grouping}</small>}
        </p>
        <div className="rd-class__tempo">
          <button type="button" onClick={() => onTempo(bpm - 2)} disabled={busy} aria-label="Slower">−</button>
          <span aria-live="polite"><strong>{bpm}</strong> {unitName}s a minute</span>
          <button type="button" onClick={() => onTempo(bpm + 2)} disabled={busy} aria-label="Faster">+</button>
        </div>
        <button type="button" className="rd-class__exit" onClick={onClose}>Exit</button>
      </header>

      <div className="rd-class__dice">
        {faces.map((face, i) => {
          const lit = playing && beatLight.beat === i && !beatLight.countIn
          return (
            <figure key={i} className={`rd-class__die${lit ? ' is-lit' : ''}`}>
              <DieFace face={face} view={view} size="class" tiedIn={i > 0 && ties[i - 1]} tieOut={ties[i]} />
              <figcaption>Group {GROUPS[i]}</figcaption>
            </figure>
          )
        })}
      </div>

      <p className="rd-class__status" aria-live="polite">
        {playing ? (beatLight.countIn ? `Count-in… ${beatLight.beat + 1}` : `Group ${GROUPS[Math.max(0, beatLight.beat)]}`) : 'Space to play · R to roll · H to hear it'}
      </p>

      <footer className="rd-class__actions">
        <button type="button" className="rd-btn rd-btn--roll" onClick={onRoll} disabled={busy}>Roll</button>
        <button type="button" className="rd-btn rd-btn--quiet" onClick={onHear} disabled={busy}>Hear it</button>
        {playing
          ? <button type="button" className="rd-btn rd-btn--stop" onClick={onStop}>Stop</button>
          : <button type="button" className="rd-btn rd-btn--primary" onClick={onPlay} disabled={busy}>Play</button>}
      </footer>
    </div>,
    document.body,
  )
}
