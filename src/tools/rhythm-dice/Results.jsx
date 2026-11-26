import { useEffect, useRef, useState } from 'react'
import { formatOffsetMs } from './scoring'
import { countName, countInMetre } from './counting'
import { dieStarts, barTicks } from './rhythm'

export { countName }

const VIEW_W = 1000
const PAD_LEFT = 70
const PAD_RIGHT = 20

// Expected hits on the top lane, your taps on the bottom lane, joined where
// they matched. Beat lines mark the grid.
function Timeline({ result, expected, barSec, metre, bars }) {
  const x = t => PAD_LEFT + (t / barSec) * (VIEW_W - PAD_LEFT - PAD_RIGHT)
  const clampX = t => Math.min(VIEW_W - 6, Math.max(PAD_LEFT - 14, x(t)))
  // A line at every die (beat; in 7/8 every group), heavier at each barline.
  const barLen = barSec / bars
  const lines = []
  for (let b = 0; b < bars; b++) {
    dieStarts(metre).forEach((start, die) => lines.push({ t: b * barLen + (start / barTicks(metre)) * barLen, label: die + 1, bar: die === 0 }))
  }
  lines.push({ t: barSec, label: null, bar: true })
  return (
    <svg className="rd-timeline" viewBox={`0 0 ${VIEW_W} 120`} role="img"
      aria-label={`Timeline: ${result.matched} of ${result.expectedCount} hits matched, ${result.extras.length} extra taps`}>
      {lines.map((l, i) => (
        <g key={i}>
          <line x1={x(l.t)} x2={x(l.t)} y1="14" y2="106" className={`rd-timeline__beat${l.bar ? ' rd-timeline__barline' : ''}`} />
          {l.label && <text x={x(l.t) + 6} y="12" className="rd-timeline__label">{l.label}</text>}
        </g>
      ))}
      <text x="4" y="40" className="rd-timeline__lane">Dice</text>
      <text x="4" y="92" className="rd-timeline__lane">You</text>
      {result.hits.map((h, i) => (
        <g key={i}>
          {h.offset !== null && <line x1={x(h.time)} y1="40" x2={clampX(h.tap)} y2="84" className="rd-timeline__link" />}
          <circle cx={x(h.time)} cy="36" r="9" className={h.offset !== null ? 'rd-timeline__expected' : 'rd-timeline__missed'} />
          {h.offset !== null && <rect x={clampX(h.tap) - 3} y="76" width="6" height="24" rx="3" className="rd-timeline__tap" />}
        </g>
      ))}
      {result.extras.map((t, i) => (
        <rect key={`x${i}`} x={clampX(t) - 3} y="76" width="6" height="24" rx="3" className="rd-timeline__extra" />
      ))}
      {expected.length === 0 && <text x={VIEW_W / 2} y="40" textAnchor="middle" className="rd-timeline__label">Silence</text>}
    </svg>
  )
}

export default function Results({ outcome, onAllowLag }) {
  const { metre } = outcome
  const bars = outcome.bars ?? 1
  const { result, reflection, expected, barSec, pass, loop } = outcome
  const [detail, setDetail] = useState('summary')
  // Each hit pages instead of scrolling: as many as fit the space left.
  const hitsRef = useRef(null)
  const [perPage, setPerPage] = useState(64)
  const [hitPage, setHitPage] = useState(0)
  useEffect(() => {
    const el = hitsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width === 0 || height === 0) return
      const cols = Math.max(1, Math.floor((width + 6) / 112))
      const rows = Math.max(1, Math.floor((height + 6) / 34))
      setPerPage(cols * rows)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [detail])
  useEffect(() => setHitPage(0), [outcome])
  const hitPages = Math.max(1, Math.ceil(result.hits.length / perPage))
  const hp = Math.min(hitPage, hitPages - 1)
  const pct = Math.round(result.accuracy * 100)
  return (
    <section className={`rd-results rd-results--${detail}`} aria-labelledby="rd-results-title" aria-live="polite">
      <h2 id="rd-results-title" className="rd-visually-hidden">Your bar</h2>
      <div className="rd-results__lead">
        {outcome.lag ? (
          <p className="rd-results__reflection rd-results__lag">
            Every tap landed about {Math.round(Math.abs(outcome.lag) * 1000)} ms {outcome.lag > 0 ? 'late' : 'early'}, by the same amount.
            That is this device's delay, not your timing.{' '}
            <button type="button" className="rd-link" onClick={onAllowLag}>Allow for it and re-score</button>
          </p>
        ) : (
          <p className="rd-results__reflection">{reflection}</p>
        )}
        {loop && <p className="rd-results__pass">Pass {pass + 1}</p>}
      </div>

      <div className="rd-results__bar">
        <div className="rd-seg rd-seg--small rd-results__switch" role="radiogroup" aria-label="Detail">
          {[['summary', 'Summary'], ['timeline', 'Timeline'], ['hits', 'Each hit']]
            .filter(([v]) => expected.length > 0 || v !== 'hits')
            .map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={detail === v}
                className={detail === v ? 'is-on' : ''} onClick={() => setDetail(v)}>{label}</button>
            ))}
        </div>
        {hitPages > 1 && (
          <div className="rd-pager rd-results__pager">
            <button type="button" className="rd-btn rd-btn--small" onClick={() => setHitPage(Math.max(0, hp - 1))} disabled={hp === 0} aria-label="Earlier hits">←</button>
            <span>{hp + 1}/{hitPages}</span>
            <button type="button" className="rd-btn rd-btn--small" onClick={() => setHitPage(Math.min(hitPages - 1, hp + 1))} disabled={hp >= hitPages - 1} aria-label="Later hits">→</button>
          </div>
        )}
      </div>

      <dl className="rd-results__numbers">
          <div>
            <dt>Accuracy</dt>
            <dd>{pct}%</dd>
            <span>{result.matched}/{result.expectedCount} hits{result.extras.length ? ` · ${result.extras.length} extra` : ''}</span>
          </div>
          <div>
            <dt>Consistency</dt>
            <dd>{result.spread === null ? '–' : `±${Math.round(result.spread * 1000)} ms`}</dd>
            <span>{result.spread === null ? 'Needs two hits' : 'Spread of your hits'}</span>
          </div>
          <div>
            <dt>Average</dt>
            <dd>{result.meanOffset === null ? '–' : formatOffsetMs(result.meanOffset)}</dd>
            <span>Where you sat</span>
          </div>
      </dl>

      <div className="rd-results__timeline">
        <Timeline result={result} expected={expected} barSec={barSec} metre={metre} bars={bars} />
      </div>

      {expected.length > 0 && (
        <ol className="rd-results__hits" ref={hitsRef} start={hp * perPage + 1}>
          {result.hits.slice(hp * perPage, (hp + 1) * perPage).map((h, j) => {
            const i = hp * perPage + j
            return (
            <li key={i} className={h.offset === null ? 'is-missed' : ''}>
              <span className="rd-results__count">{outcome.bars > 1 ? `${expected[i].bar + 1}: ` : ''}{countInMetre(expected[i].tick, metre)}</span>
              <span>{h.offset === null ? 'missed' : formatOffsetMs(h.offset)}</span>
            </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
