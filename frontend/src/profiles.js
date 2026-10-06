import { STORAGE_KEYS, loadJSON, saveJSON } from './storage.js'

// ─── saved Direct Connection profiles ─────────────────────────────────────────
// { id, name, host, port, dbName, user } kept in localStorage. Passwords,
// session tokens and other secrets are never part of a profile.
export const PROFILE_FIELDS = ['host', 'port', 'dbName', 'user']

export function loadProfiles() {
  const list = loadJSON(STORAGE_KEYS.profiles, [])
  if (!Array.isArray(list)) return []
  // keep only the known, non-secret fields — whatever an older version stored
  return list
    .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string')
    .map(p => ({ id: p.id, name: p.name, ...Object.fromEntries(PROFILE_FIELDS.map(f => [f, typeof p[f] === 'string' ? p[f] : ''])) }))
}

export const saveProfiles = (list) => saveJSON(STORAGE_KEYS.profiles, list)
