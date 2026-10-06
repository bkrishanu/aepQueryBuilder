// ─── localStorage helpers ────────────────────────────────────────────────────
// Only non-sensitive preferences and editor state go here: theme, query tabs,
// query history (SQL text + stats, never results) and Direct Connection
// profiles (never passwords). Every access is wrapped — storage can be full,
// disabled (private mode, blocked site data) or hold data from an older version.

export const STORAGE_KEYS = {
  theme:    'aepqe.theme',
  tabs:     'aepqe.tabs.v1',
  history:  'aepqe.history.v1',
  profiles: 'aepqe.profiles.v1',
}

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** Returns false when the value could not be stored (quota, storage disabled). */
export function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadString(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

export function saveString(key, value) {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}
