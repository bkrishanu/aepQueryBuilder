// ─── cell values ──────────────────────────────────────────────────────────────
// Formatting, sorting, filtering and export of result-grid values. Rows are
// arrays in column order; values are whatever the server sent (null, string,
// number, boolean, or an object / array for JSON and nested XDM fields).

export const isComplex = (v) => v !== null && typeof v === 'object'

/** One-line text for a cell: objects and arrays as compact JSON, scalars unchanged. */
export function cellText(v) {
  if (v === null || v === undefined) return ''
  if (isComplex(v)) {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

/**
 * The value as structured data when it is JSON — an object / array, or a text
 * column holding a JSON object / array — else undefined.
 */
export function jsonValue(v) {
  if (isComplex(v)) return v
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try {
      const parsed = JSON.parse(v)
      if (isComplex(parsed)) return parsed
    } catch { /* not JSON */ }
  }
  return undefined
}

/** Full value for the viewer: JSON pretty-printed, including JSON held in a text column. */
export function prettyValue(v) {
  const json = jsonValue(v)
  if (json !== undefined) {
    try { return JSON.stringify(json, null, 2) } catch { return String(v) }
  }
  return String(v)
}

// ─── sorting ──────────────────────────────────────────────────────────────────
const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Ascending comparison of two cell values. Numbers — including the numeric
 * strings Postgres sends for bigint / numeric — compare by value; nulls sort
 * last in both directions (see sortRows).
 */
function compareValues(a, b) {
  const an = typeof a === 'number' ? a : typeof a === 'string' && NUMERIC.test(a) ? Number(a) : NaN
  const bn = typeof b === 'number' ? b : typeof b === 'string' && NUMERIC.test(b) ? Number(b) : NaN
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return collator.compare(cellText(a), cellText(b))
}

/** A sorted copy of `rows` by column `col`; nulls always last. Stable. */
export function sortRows(rows, col, dir) {
  const sign = dir === 'desc' ? -1 : 1
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = x.row[col]
      const b = y.row[col]
      const an = a === null || a === undefined
      const bn = b === null || b === undefined
      if (an || bn) return an === bn ? x.i - y.i : an ? 1 : -1
      return sign * compareValues(a, b) || x.i - y.i
    })
    .map(x => x.row)
}

// ─── filtering ────────────────────────────────────────────────────────────────
// A column filter is { text, values }: `text` keeps rows whose cell contains it
// (case-insensitive); `values` (a Set of valueKey()s, or null for "any") keeps
// rows whose cell is one of the checked values.
export const NULL_KEY = '\u0000null'
export const valueKey = (v) => (v === null || v === undefined ? NULL_KEY : cellText(v))

export const isFilterActive = (f) => !!f && (!!f.text?.trim() || !!f.values)

/** Rows that pass every active column filter. */
export function filterRows(rows, filters) {
  const active = Object.entries(filters)
    .filter(([, f]) => isFilterActive(f))
    .map(([col, f]) => ({ col: Number(col), text: f.text?.trim().toLowerCase(), values: f.values }))
  if (!active.length) return rows
  return rows.filter(row => active.every(({ col, text, values }) => {
    const v = row[col]
    if (values && !values.has(valueKey(v))) return false
    if (text && !(v !== null && v !== undefined && cellText(v).toLowerCase().includes(text))) return false
    return true
  }))
}

/**
 * Distinct values of column `col` with their counts, most frequent first, or
 * null when there are more than `max` (a checklist would be unusable).
 */
export function distinctValues(rows, col, max) {
  const counts = new Map()
  for (const row of rows) {
    const key = valueKey(row[col])
    counts.set(key, (counts.get(key) || 0) + 1)
    if (counts.size > max) return null
  }
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.key, b.key))
}

// ─── export ───────────────────────────────────────────────────────────────────
/**
 * TSV field that pastes back into a single cell (Excel, Google Sheets): values
 * containing a tab, newline, carriage return or double quote are wrapped in
 * double quotes with inner quotes doubled.
 */
export function tsvField(v) {
  const s = cellText(v)
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** RFC 4180 field: quoted when it holds a comma, quote, line break or edge whitespace. */
function csvField(v) {
  const s = cellText(v)
  return /[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV text with a header row; starts with a BOM so Excel reads it as UTF-8. */
export function toCSV(labels, rows) {
  const lines = [labels.map(csvField).join(','), ...rows.map(r => r.map(csvField).join(','))]
  return `﻿${lines.join('\r\n')}\r\n`
}

/** JSON array of row objects keyed by column label; nested values stay structured. */
export function toJSON(labels, rows) {
  return JSON.stringify(rows.map(r => Object.fromEntries(labels.map((l, i) => [l, r[i] ?? null]))), null, 2)
}

/** Save `content` as a file, generated entirely in the browser. */
export function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** query-results-20261006-142501[-2].csv */
export function exportFileName(ext, suffix = '') {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `query-results-${stamp}${suffix}.${ext}`
}
