import { useState, useEffect, useCallback } from 'react'
import { safeStorage } from '../utils/safeStorage'

const STORAGE_KEY = 'chordMovesThemePreference'
const VALID_PREFERENCES = ['light', 'dark', 'system']

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(preference) {
  return preference === 'system' ? getSystemTheme() : preference
}

// Manages the light/dark/system theme preference, persists it, applies it
// to the document, and stays in sync with OS-level theme changes when the
// preference is "system"
export function useTheme() {
  const [preference, setPreferenceState] = useState(() => {
    const stored = safeStorage.getItem(STORAGE_KEY)
    return VALID_PREFERENCES.includes(stored) ? stored : 'system'
  })
  const [resolvedTheme, setResolvedTheme] = useState(() => resolveTheme(preference))

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    setResolvedTheme(resolveTheme(preference))
    if (preference !== 'system') return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setResolvedTheme(getSystemTheme())
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [preference])

  const setPreference = useCallback(next => {
    if (!VALID_PREFERENCES.includes(next)) return
    safeStorage.setItem(STORAGE_KEY, next)
    setPreferenceState(next)
  }, [])

  return { preference, resolvedTheme, setPreference }
}
