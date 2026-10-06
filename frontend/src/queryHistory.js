import { STORAGE_KEYS, loadJSON, saveJSON } from './storage.js'

// ─── query history ────────────────────────────────────────────────────────────
// The last HISTORY_LIMIT executed queries per target (AEP sandbox or Direct
// host), newest first. An entry holds only the SQL text and run statistics:
//   { id, query, executedAt, duration, rowCount, status }
// Never results, sessions, passwords or tokens.
//
// Stored as { [target]: entries[] }; targets beyond MAX_TARGETS are dropped,
// least recently used first.
export const HISTORY_LIMIT = 50
const MAX_TARGETS = 20
const MAX_QUERY_CHARS = 20000

const readAll = () => {
  const all = loadJSON(STORAGE_KEYS.history, {})
  return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
}

const isEntry = (e) => e && typeof e.query === 'string' && typeof e.executedAt === 'number'

export function loadHistory(target) {
  if (!target) return []
  const list = readAll()[target]
  return Array.isArray(list) ? list.filter(isEntry) : []
}

function writeTarget(target, list) {
  const all = readAll()
  if (list.length) all[target] = list
  else delete all[target]
  const targets = Object.keys(all)
  if (targets.length > MAX_TARGETS) {
    const lastUsed = (t) => all[t][0]?.executedAt || 0
    targets.sort((a, b) => lastUsed(a) - lastUsed(b))
      .slice(0, targets.length - MAX_TARGETS)
      .forEach(t => { delete all[t] })
  }
  // storage full: keep the newer half of this target's entries and try again
  if (!saveJSON(STORAGE_KEYS.history, all) && list.length > 1) {
    all[target] = list.slice(0, Math.ceil(list.length / 2))
    saveJSON(STORAGE_KEYS.history, all)
    return all[target]
  }
  return list
}

/**
 * Record a run for `target`; returns the target's updated list. Re-running a
 * query moves it to the top with its latest stats; the oldest entries fall
 * off once the list holds HISTORY_LIMIT.
 */
export function addHistory(target, { query, duration, rowCount, status }) {
  if (!target || !query?.trim() || query.length > MAX_QUERY_CHARS) return loadHistory(target)
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query,
    executedAt: Date.now(),
    duration: Number.isFinite(duration) ? duration : null,
    rowCount: Number.isFinite(rowCount) ? rowCount : null,
    status: status || 'success',
  }
  const list = [entry, ...loadHistory(target).filter(e => e.query !== query)].slice(0, HISTORY_LIMIT)
  return writeTarget(target, list)
}

export function removeHistory(target, id) {
  return writeTarget(target, loadHistory(target).filter(e => e.id !== id))
}

export function clearHistory(target) {
  return writeTarget(target, [])
}
