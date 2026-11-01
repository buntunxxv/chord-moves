import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import { logEvent } from '../analytics/events'
import { DEMO_CHAPTERS } from './chapters'
import { DEMO_FRAME_SRC } from './demoFrameSeed'
import { accessibleName, createPlayer, matchesName } from './director'
import './DemoPage.css'

const EXIT_STATE = { fromDemo: true }

function isShown(el) {
  if (!el.getClientRects().length) return false
  if (el.closest('[aria-hidden="true"], [inert]')) return false
  const style = el.ownerDocument.defaultView.getComputedStyle(el)
  return style.visibility !== 'hidden' && !el.disabled
}

// The director's view of the real app in the frame: find a control by its
// name, tap it, show where the tap lands, and start a fresh app.
function makeFrame(iframeRef, showTapAt) {
  const win = () => iframeRef.current?.contentWindow
  const api = () => win()?.chordMovesDemo
  const until = async (ok, ms = 8000) => {
    const end = performance.now() + ms
    while (!ok()) {
      if (performance.now() > end) throw new Error('The demo app did not load')
      await new Promise(r => setTimeout(r, 50))
    }
  }
  const frame = {
    async reset() {
      await until(() => api())
      const run = api().reset()
      await until(() => api()?.mounted === run && frame.find(/^Root:/))
    },
    find(matcher, { role, last } = {}) {
      const doc = iframeRef.current?.contentDocument
      if (!doc) return null
      const selector = role === 'option' ? '[role="option"]' : 'button, [role="button"], a[href]'
      const hits = [...doc.querySelectorAll(selector)].filter(el => isShown(el) && matchesName(accessibleName(el), matcher))
      return (last ? hits[hits.length - 1] : hits[0]) || null
    },
    tap(el) {
      el.click()
    },
    showTap(el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const box = el.getBoundingClientRect()
      const stage = iframeRef.current.getBoundingClientRect()
      showTapAt(stage.left + box.left + box.width / 2, stage.top + box.top + box.height / 2)
    },
  }
  return frame
}

// /demo: the real app, sandboxed in a frame, playing itself chapter by
// chapter. It is the app, so it takes the shape of whatever screen it is on.
export default function DemoPage() {
  useTheme() // the page around the frame follows the viewer's theme too
  const iframeRef = useRef(null)
  const tapLayerRef = useRef(null)
  const [state, setState] = useState({ chapter: 0, status: 'idle', error: null })
  const [muted, setMuted] = useState(false)

  const showTapAt = useCallback((x, y) => {
    const layer = tapLayerRef.current
    if (!layer) return
    const ring = document.createElement('span')
    ring.className = 'demo-tap'
    ring.style.left = `${x}px`
    ring.style.top = `${y}px`
    layer.appendChild(ring)
    setTimeout(() => ring.remove(), 700)
  }, [])

  const player = useMemo(
    () => createPlayer({ chapters: DEMO_CHAPTERS, frame: makeFrame(iframeRef, showTapAt), onChange: setState }),
    [showTapAt]
  )
  useEffect(() => () => player.stop(), [player])

  useEffect(() => {
    if (state.status === 'ended') logEvent('demo_completed')
    if (state.status === 'error') logEvent('demo_step_failed', { chapter: DEMO_CHAPTERS[state.chapter]?.id, error: state.error })
  }, [state.status, state.chapter, state.error])

  // Sound can only start inside the viewer's own tap, so every control that
  // starts playback unlocks it first, synchronously.
  const unlockSound = useCallback(() => {
    const api = iframeRef.current?.contentWindow?.chordMovesDemo
    api?.startAudio()
    api?.setMuted(muted)
  }, [muted])

  const playFrom = useCallback(index => {
    unlockSound()
    if (state.status === 'idle') logEvent('demo_started')
    player.play(Math.max(0, Math.min(DEMO_CHAPTERS.length - 1, index)))
  }, [player, state.status, unlockSound])

  const togglePlay = useCallback(() => {
    if (state.status === 'playing') player.pause()
    else if (state.status === 'paused') { unlockSound(); player.resume() }
    else playFrom(state.status === 'ended' ? 0 : state.chapter)
  }, [player, playFrom, state.chapter, state.status, unlockSound])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    iframeRef.current?.contentWindow?.chordMovesDemo?.setMuted(next)
  }

  useEffect(() => {
    const onKey = event => {
      if (event.target.closest?.('button, a, input, select, textarea')) return
      if (event.key === 'ArrowRight') playFrom(state.chapter + 1)
      else if (event.key === 'ArrowLeft') playFrom(state.chapter - 1)
      else if (event.key === ' ') { event.preventDefault(); togglePlay() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [playFrom, state.chapter, togglePlay])

  const current = DEMO_CHAPTERS[state.chapter]
  const { status } = state
  const caption = status === 'idle' ? 'Watch Chord Moves build a progression from one chord.' : current.caption
  const playing = status === 'playing'

  return (
    <div className="demo-page" data-status={status} data-chapter={DEMO_CHAPTERS[state.chapter].id} data-error={state.error || undefined}>
      <header className="demo-bar">
        <div className="demo-bar__top">
          <p className="demo-bar__eyebrow"><span className="demo-bar__eyebrow-brand">Chord Moves · </span>Live demo</p>
          <div className="demo-bar__tools">
            <button type="button" className="demo-bar__tool" aria-pressed={muted} onClick={toggleMute}>
              {muted ? 'Sound off' : 'Sound on'}
            </button>
            <Link to="/" state={EXIT_STATE} className="demo-bar__tool demo-bar__tool--exit">Exit demo</Link>
          </div>
        </div>

        <p className="demo-bar__caption" aria-live="polite">{caption}</p>

        <div className="demo-bar__controls">
          <div className="demo-bar__transport">
            <button type="button" className="demo-bar__step" onClick={() => playFrom(state.chapter - 1)} disabled={state.chapter === 0 || status === 'idle'} aria-label="Previous chapter">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <button type="button" className="demo-bar__play" onClick={togglePlay} aria-label={playing ? 'Pause' : status === 'ended' ? 'Watch again' : 'Play'}>
              {playing
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" className="demo-bar__fill" /></svg>}
            </button>
            <button type="button" className="demo-bar__step" onClick={() => playFrom(state.chapter + 1)} disabled={state.chapter === DEMO_CHAPTERS.length - 1 || status === 'idle'} aria-label="Next chapter">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>

          <ol className="demo-bar__chapters" aria-label="Chapters">
            {DEMO_CHAPTERS.map((chapter, i) => (
              <li key={chapter.id}>
                <button
                  type="button"
                  className={`demo-bar__chapter ${i < state.chapter && status !== 'idle' ? 'demo-bar__chapter--done' : ''}`}
                  aria-current={i === state.chapter && status !== 'idle' ? 'step' : undefined}
                  onClick={() => playFrom(i)}
                  aria-label={`Chapter ${i + 1}: ${chapter.title}`}
                >
                  <span className="demo-bar__chapter-num">{i + 1}</span>
                  <span className="demo-bar__chapter-title">{chapter.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <div className="demo-stage">
        <iframe
          ref={iframeRef}
          className="demo-stage__app"
          src={DEMO_FRAME_SRC}
          title="Chord Moves, playing the demo"
          allow="autoplay"
          tabIndex={-1}
          aria-hidden="true"
        />
        {/* Taps on the app pause and resume it; the app itself only follows
            the script, so it can't drift out of step. */}
        <div className="demo-stage__shield" onClick={status === 'playing' || status === 'paused' ? togglePlay : undefined} aria-hidden="true" />

        {status === 'idle' && (
          <div className="demo-stage__card">
            <button type="button" className="demo-stage__primary" onClick={() => playFrom(0)}>Play the demo</button>
            <p>About 30 seconds · {DEMO_CHAPTERS.length} chapters · jump to any chapter above</p>
          </div>
        )}
        {status === 'paused' && <p className="demo-stage__badge">Paused · tap to resume</p>}
        {status === 'ended' && (
          <div className="demo-stage__card">
            <Link to="/" state={EXIT_STATE} className="demo-stage__primary">Try it yourself</Link>
            <button type="button" className="demo-stage__secondary" onClick={() => playFrom(0)}>Watch again</button>
          </div>
        )}
        {status === 'error' && (
          <div className="demo-stage__card">
            <p>This chapter didn’t play as expected.</p>
            {state.chapter < DEMO_CHAPTERS.length - 1 && (
              <button type="button" className="demo-stage__secondary" onClick={() => playFrom(state.chapter + 1)}>Skip to the next chapter</button>
            )}
            <Link to="/" state={EXIT_STATE} className="demo-stage__primary">Open the app</Link>
          </div>
        )}
      </div>

      <div ref={tapLayerRef} className="demo-taps" aria-hidden="true" />
    </div>
  )
}
