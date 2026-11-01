import { useEffect, useMemo, useState } from 'react'
import OverlayPage from './OverlayPage'
import { activeCue, getDemo, pickVariant } from '../demo/demoVideos'
import { logEvent } from '../analytics/events'
import './DemoVideo.css'

const PORTRAIT_QUERY = '(max-width: 760px), (orientation: portrait)'

function matches(query) {
  return typeof window !== 'undefined' && window.matchMedia?.(query).matches
}

// A recorded walkthrough of the real app, with captions drawn over it from
// src/demo/demoScripts.js. Mounts the <video> only while open, so nothing is
// downloaded until someone asks to watch.
export default function DemoVideo({ demoId, isOpen, onClose }) {
  const demo = useMemo(() => getDemo(demoId), [demoId])
  const [time, setTime] = useState(0)
  // Chosen once per opening, so turning the phone mid-video doesn't restart it.
  const [portrait, setPortrait] = useState(() => matches(PORTRAIT_QUERY))
  const [autoPlay, setAutoPlay] = useState(true)

  useEffect(() => {
    if (!isOpen || !demo) return
    setTime(0)
    setPortrait(matches(PORTRAIT_QUERY))
    // Someone who asked for less motion starts it themselves.
    setAutoPlay(!matches('(prefers-reduced-motion: reduce)'))
    logEvent('demo_video_opened', { demo: demoId })
  }, [isOpen, demo, demoId])

  if (!demo) return null
  const variant = pickVariant(demo, portrait)
  if (!variant) return null
  const cue = activeCue(variant.cues, time)

  return (
    <OverlayPage
      isOpen={isOpen}
      onClose={onClose}
      eyebrow={`Watch · ${demo.lengthLabel}`}
      title={demo.title}
      wide={!portrait}
    >
      <figure className={`demo-video ${portrait ? 'demo-video--portrait' : 'demo-video--landscape'}`}>
        <div className="demo-video__frame" style={{ aspectRatio: `${variant.width} / ${variant.height}` }}>
          <video
            className="demo-video__media"
            poster={variant.poster}
            width={variant.width}
            height={variant.height}
            controls
            muted
            playsInline
            autoPlay={autoPlay}
            preload="metadata"
            aria-describedby="demo-video-caption"
            onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
            onEnded={() => logEvent('demo_video_completed', { demo: demoId })}
          >
            {variant.sources.map(source => <source key={source.src} src={source.src} type={source.type} />)}
          </video>
          {cue && (
            <p className="demo-video__caption" aria-hidden="true">
              <span>{cue.text}</span>
            </p>
          )}
        </div>
        {/* The captions in one place for screen readers, rather than announced
            as they change over the picture. */}
        <figcaption id="demo-video-caption" className="demo-video__transcript">
          {variant.cues.map(c => c.text).join(' ')}
        </figcaption>
      </figure>
    </OverlayPage>
  )
}
