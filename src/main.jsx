import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { migrateStorageKeys } from './utils/migrateStorageKeys.js'
import { lockZoom } from './utils/lockZoom.js'
import { safeStorage } from './utils/safeStorage.js'
import { runDomainHandover } from './utils/domainHandover.js'
import { CURRENT_SITE, TOOLS_ORIGIN } from './app/sites.js'

migrateStorageKeys(safeStorage)
// Old host: hand saved state to www.chordmoves.co.uk and stop. New host:
// take in any handed-over state before anything below reads storage.
const leaving = runDomainHandover(window, safeStorage)
lockZoom()

// index.html is shared, so its canonical/og:url name Chord Moves. On the
// library, point search engines at the library's own address instead.
if (CURRENT_SITE === 'tools') {
  const path = window.location.pathname === '/tools' ? '/' : window.location.pathname
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', TOOLS_ORIGIN + path)
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', TOOLS_ORIGIN + path)
}

const App = lazy(() => import('./App'))
const UpgradePage = lazy(() => import('./UpgradePage'))
const ToolHome = lazy(() => import('./app/ToolHome'))
const Metronome = lazy(() => import('./tools/metronome/Metronome'))
const EarTrainer = lazy(() => import('./tools/ear-trainer/EarTrainer'))
const ChordScaleExplorer = lazy(() => import('./tools/chord-scales/ChordScaleExplorer'))

if (!leaving) ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading" role="status">Loading…</div>}>
        <Routes>
          {/* The library's own host serves its directory at the root. */}
          <Route path="/" element={CURRENT_SITE === 'tools' ? <ToolHome /> : <App />} />
          <Route path="/tools" element={<ToolHome />} />
          <Route path="/metronome" element={<Metronome />} />
          <Route path="/ear-trainer" element={<EarTrainer />} />
          <Route path="/chord-scales" element={<ChordScaleExplorer />} />
          <Route path="/upgrade" element={<UpgradePage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
)
