import { formatOffsetMs } from './scoring'

const SYLLABLES = { 0: null, 3: 'e', 6: '&', 9: 'a' }

// Counting name for an onset: "1", "2&", "3e"... -- the words students say.
export function countName(tick, beatTicks) {
  const beat = Math.floor(tick / beatTicks) + 1
  const within = tick % beatTicks
  const syl = SYLLABLES[within]
  if (syl === null) return String(beat)
  if (syl) return `${beat}${syl}`
  return `${beat} + ${within}/${beatTicks}`
}

const VIEW_W = 1000
const PAD_LEFT = 70
const PAD_RIGHT = 20

// Expected hits on the top lane, your taps on the bottom lane, joined where
// they matched. Beat lines mark the grid.
function Timeline({ result, expected, barSec, beats }) {
  const x = t => PAD_LEFT + (t / barSec) * (VIEW_W - PAD_LEFT - PAD_RIGHT)
  const clampX = t => Math.min(VIEW_W - 6, Math.max(PAD_LEFT - 14, x(t)))
  return (
    <svg className="rd-timeline" viewBox={`0 0 ${VIEW_W} 120`} role="img"
      aria-label={`Timeline: ${result.matched} of ${result.expectedCount} hits matched, ${result.extras.length} extra taps`}>
      {Array.from({ length: beats + 1 }, (_, b) => (
        <g key={b}>
          <line x1={x((b / beats) * barSec)} x2={x((b / beats) * barSec)} y1="14" y2="106" className="rd-timeline__beat" />
          {b < beats && <text x={x((b / beats) * barSec) + 6} y="12" className="rd-timeline__label">{b + 1}</text>}
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

export default function Results({ outcome, beatTicks, beats }) {
  const { result, reflection, expected, barSec, pass, loop } = outcome
  const pct = Math.round(result.accuracy * 100)
  return (
    <section className="rd-results" aria-labelledby="rd-results-title" aria-live="polite">
      <h2 id="rd-results-title" className="rd-visually-hidden">Your bar</h2>
      <p className="rd-results__reflection">{reflection}</p>
      {loop && <p className="rd-results__pass">Pass {pass + 1}</p>}

      <Timeline result={result} expected={expected} barSec={barSec} beats={beats} />

      <dl className="rd-results__numbers">
        <div>
          <dt>Accuracy</dt>
          <dd>{pct}%</dd>
          <span>{result.matched} of {result.expectedCount} hits{result.extras.length ? `, ${result.extras.length} extra` : ''}</span>
        </div>
        <div>
          <dt>Consistency</dt>
          <dd>{result.spread === null ? '–' : `±${Math.round(result.spread * 1000)} ms`}</dd>
          <span>{result.spread === null ? 'Needs two hits' : 'Spread of your hits'}</span>
        </div>
        <div>
          <dt>Average</dt>
          <dd>{result.meanOffset === null ? '–' : formatOffsetMs(result.meanOffset)}</dd>
          <span>Where you sat overall</span>
        </div>
      </dl>

      {expected.length > 0 && (
        <ol className="rd-results__hits">
          {result.hits.map((h, i) => (
            <li key={i} className={h.offset === null ? 'is-missed' : ''}>
              <span className="rd-results__count">{countName(expected[i].tick, beatTicks)}</span>
              <span>{h.offset === null ? 'missed' : formatOffsetMs(h.offset)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
