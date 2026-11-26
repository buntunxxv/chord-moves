import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import './index.css'
import { migrateStorageKeys } from './utils/migrateStorageKeys.js'
import { lockZoom } from './utils/lockZoom.js'
import { safeStorage, startSandbox } from './utils/safeStorage.js'
import { runDomainHandover } from './utils/domainHandover.js'
import { CHORD_MOVES_PATH, DEMO_PATH, UPGRADE_PATH } from './app/sites.js'
import RouteMeta from './app/RouteMeta.jsx'
import { shareProLogin } from './app/proLogin.js'
import { DEMO_FRAME_PARAM, demoSeed } from './demo/demoFrameSeed.js'

// Inside the live demo's frame (/demo embeds /?demo-frame), the app runs on a
// throwaway store seeded with the viewer's theme, and nothing else here runs.
const demoFrame = new URLSearchParams(window.location.search).has(DEMO_FRAME_PARAM)
if (demoFrame) startSandbox(demoSeed(safeStorage))

if (!demoFrame) migrateStorageKeys(safeStorage)
// Old host (chordmoves.co.uk): hand saved state to
// tools.kyndalearning.co.uk/chordmoves and stop. New host: take in any
// handed-over state before anything below reads storage.
const leaving = !demoFrame && runDomainHandover(window, safeStorage)
// One Pro login across Chord Moves and the tools (src/app/proLogin.js).
if (!demoFrame && !leaving) shareProLogin(safeStorage)
lockZoom()

// Old paths from before Chord Moves moved under /chordmoves (bookmarks,
// Stripe and email links). Keeps the query, e.g. ?unlock=1.
function MovedTo({ to }) {
  const { search, hash } = useLocation()
  return <Navigate to={to + search + hash} replace />
}

const App = lazy(() => import('./App'))
const UpgradePage = lazy(() => import('./UpgradePage'))
const ToolHome = lazy(() => import('./app/ToolHome'))
const Metronome = lazy(() => import('./tools/metronome/Metronome'))
const EarTrainer = lazy(() => import('./tools/ear-trainer/EarTrainer'))
const ChordScaleExplorer = lazy(() => import('./tools/chord-scales/ChordScaleExplorer'))
const RhythmDice = lazy(() => import('./tools/rhythm-dice/RhythmDice'))
const ChordDice = lazy(() => import('./tools/chord-dice/ChordDice'))
const DemoPage = lazy(() => import('./demo/DemoPage'))
const DemoFrame = lazy(() => import('./demo/DemoFrame'))

if (demoFrame) ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
        <DemoFrame />
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
)
else if (!leaving) ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <RouteMeta />
      <Suspense fallback={<div className="route-loading" role="status">Loading…</div>}>
        <Routes>
          <Route path="/" element={<ToolHome />} />
          <Route path={CHORD_MOVES_PATH} element={<App />} />
          <Route path={UPGRADE_PATH} element={<UpgradePage />} />
          <Route path={DEMO_PATH} element={<DemoPage />} />
          <Route path="/metronome" element={<Metronome />} />
          <Route path="/ear-trainer" element={<EarTrainer />} />
          <Route path="/chord-scales" element={<ChordScaleExplorer />} />
          <Route path="/rhythm-dice" element={<RhythmDice />} />
          <Route path="/chord-dice" element={<ChordDice />} />
          <Route path="/tools" element={<MovedTo to="/" />} />
          <Route path="/chordmoves/upgrade" element={<MovedTo to={UPGRADE_PATH} />} />
          <Route path="/demo" element={<MovedTo to={DEMO_PATH} />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
)
