import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { migrateStorageKeys } from './utils/migrateStorageKeys.js'
import { lockZoom } from './utils/lockZoom.js'

migrateStorageKeys(window.localStorage)
lockZoom()

const App = lazy(() => import('./App'))
const UpgradePage = lazy(() => import('./UpgradePage'))
const AdminFeedback = lazy(() => import('./AdminFeedback'))
const ToolHome = lazy(() => import('./app/ToolHome'))
const Metronome = lazy(() => import('./tools/metronome/Metronome'))
const EarTrainer = lazy(() => import('./tools/ear-trainer/EarTrainer'))
const ChordScaleExplorer = lazy(() => import('./tools/chord-scales/ChordScaleExplorer'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading" role="status">Loading…</div>}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/tools" element={<ToolHome />} />
          <Route path="/metronome" element={<Metronome />} />
          <Route path="/ear-trainer" element={<EarTrainer />} />
          <Route path="/chord-scales" element={<ChordScaleExplorer />} />
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="/admin/feedback" element={<AdminFeedback />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
)
