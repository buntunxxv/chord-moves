import { useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import App from '../App'
import { safeStorage, startSandbox } from '../utils/safeStorage'
import { startAudioContext } from '../audio/synth'
import { demoSeed } from './demoFrameSeed'

// The real app, running inside the live demo's frame on sandboxed storage
// (started in main.jsx). The demo page drives it through window.chordMovesDemo:
//   reset()        a fresh app (empty sandbox, remounted) for a chapter jump;
//                  returns the run number `mounted` will show once it's up
//   startAudio()   unlock sound; called inside the viewer's own tap
//   setMuted(bool)
export default function DemoFrame() {
  const [run, setRun] = useState(0)
  const runRef = useRef(0)
  const [seed] = useState(() => demoSeed(safeStorage))

  useEffect(() => {
    window.chordMovesDemo = {
      mounted: runRef.current,
      reset() {
        startSandbox(seed)
        runRef.current += 1
        setRun(runRef.current)
        return runRef.current
      },
      startAudio: () => startAudioContext(),
      setMuted(muted) {
        Tone.getDestination().mute = muted
      },
    }
    return () => { delete window.chordMovesDemo }
  }, [seed])

  // Runs after App's own effects, so the app is up when the page sees it.
  useEffect(() => {
    if (window.chordMovesDemo) window.chordMovesDemo.mounted = run
  }, [run])

  return <App key={run} demo />
}
