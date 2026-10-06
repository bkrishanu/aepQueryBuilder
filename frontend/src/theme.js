import { useState, useEffect, useCallback } from 'react'
import { STORAGE_KEYS, loadString, saveString } from './storage.js'

// ─── theme ────────────────────────────────────────────────────────────────────
// Preference: 'light' | 'dark' | 'system' (follows prefers-color-scheme).
// The resolved theme is the `dark` class on <html>; index.css remaps the colour
// palette under it. index.html applies the stored preference before first
// paint so a dark-theme reload never flashes white.
export const THEMES = ['light', 'dark', 'system']

const media = () => window.matchMedia?.('(prefers-color-scheme: dark)')

const readPreference = () => {
  const p = loadString(STORAGE_KEYS.theme, 'system')
  return THEMES.includes(p) ? p : 'system'
}

const resolve = (pref) => (pref === 'system' ? (media()?.matches ? 'dark' : 'light') : pref)

let transitionTimer = 0
function apply(resolved, animate) {
  const root = document.documentElement
  if (root.classList.contains('dark') === (resolved === 'dark')) return
  if (animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    // colours ease between themes, then the transition rule is removed so it
    // never slows down ordinary hover / state changes
    root.classList.add('theme-transition')
    clearTimeout(transitionTimer)
    transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), 350)
  }
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

/** [preference, setPreference, resolvedTheme] */
export function useTheme() {
  const [preference, setPreferenceState] = useState(readPreference)
  const [resolved, setResolved] = useState(() => resolve(readPreference()))

  useEffect(() => {
    const update = (animate) => {
      const r = resolve(preference)
      setResolved(r)
      apply(r, animate)
    }
    update(true)
    if (preference !== 'system') return
    const mq = media()
    const onChange = () => update(true)
    mq?.addEventListener('change', onChange)
    return () => mq?.removeEventListener('change', onChange)
  }, [preference])

  const setPreference = useCallback((p) => {
    if (!THEMES.includes(p)) return
    saveString(STORAGE_KEYS.theme, p)
    setPreferenceState(p)
  }, [])

  return [preference, setPreference, resolved]
}
