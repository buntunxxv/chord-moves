// M0 notation feasibility check -- DISPOSABLE PROTOTYPE, never merged.
// /m0-notation?fixture=F11&width=375&theme=dark
// "Time it" runs the T2 measurement on this device and shows the numbers,
// so the founder can run it on an iPad Air 2 from the preview link.
import { useEffect, useRef, useState } from 'react'
import { FIXTURES, fixtureById } from './fixtures'
import { renderScore } from './renderer'

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function inkColour() {
  return getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1a1a1a'
}

export function timeRender(el, fixture, width, runs = 10) {
  const first = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    renderScore(el, fixture, { width, ink: inkColour() })
    first.push(performance.now() - t0)
  }
  // Re-render after changing one note's pitch (as an edit would).
  const edited = { ...fixture, notes: fixture.notes.map((n, i) => (i === 3 ? { ...n, pitch: 'A4' } : n)) }
  const again = []
  for (let i = 0; i < runs; i++) {
    const f = i % 2 ? fixture : edited
    const t0 = performance.now()
    renderScore(el, f, { width, ink: inkColour() })
    again.push(performance.now() - t0)
  }
  return { firstMedian: median(first), editMedian: median(again), first, again }
}

export default function M0NotationPage() {
  const params = new URLSearchParams(window.location.search)
  const [id, setId] = useState(params.get('fixture') || 'F11')
  const theme = params.get('theme')
  const fixedWidth = Number(params.get('width')) || null
  const boxRef = useRef(null)
  const [report, setReport] = useState(null)
  const [timing, setTiming] = useState(null)

  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    const el = boxRef.current
    const draw = () => {
      const width = fixedWidth ?? el.clientWidth
      const r = renderScore(el, fixtureById(id), { width, ink: inkColour() })
      setReport(r)
      window.__m0 = { report: r, fixture: fixtureById(id), width }
    }
    draw()
    if (fixedWidth) return
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [id, fixedWidth])

  function runTiming() {
    const el = boxRef.current
    const width = fixedWidth ?? el.clientWidth
    const result = timeRender(el, fixtureById('F11'), width)
    setTiming({ ...result, width, ua: navigator.userAgent })
    setId('F11')
  }

  const fixture = fixtureById(id)
  return (
    <div style={{ padding: 16, background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--font)' }}>
      <p style={{ margin: '0 0 8px', fontWeight: 700 }}>M0 notation prototype (disposable, not a product page)</p>
      <label>
        Fixture{' '}
        <select value={id} onChange={e => setId(e.target.value)} data-testid="fixture" style={{ maxWidth: '100%' }}>
          {FIXTURES.map(f => <option key={f.id} value={f.id}>{f.id}: {f.title}</option>)}
        </select>
      </label>{' '}
      <button type="button" onClick={runTiming} data-testid="time">Time it (F11, 10 runs)</button>
      {timing && (
        <pre data-testid="timing" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {`First render median: ${timing.firstMedian.toFixed(1)} ms\nAfter one-note edit median: ${timing.editMedian.toFixed(1)} ms\nWidth: ${timing.width}px\n${timing.ua}`}
        </pre>
      )}
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{fixture.title}</p>
      <div ref={boxRef} data-testid="score" style={{ width: fixedWidth ?? '100%', overflow: 'hidden' }} />
      {report && <pre style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} data-testid="report">{JSON.stringify(report)}</pre>}
    </div>
  )
}
