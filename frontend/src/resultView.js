import { useState, useMemo } from 'react'
import { sortRows, filterRows, isFilterActive } from './cellValues.js'

// ─── result view state ────────────────────────────────────────────────────────
// Client-side view over one result set's fetched rows: sorting, column filters,
// hidden columns, column widths and the pinned first column. Nothing here
// re-runs the query; copy and export read the same view (exportView).
export function useResultView(set) {
  const [sort, setSort]       = useState(null)            // { col, dir: 'asc' | 'desc' }
  const [filters, setFilters] = useState({})              // column index → { text, values }
  const [hidden, setHidden]   = useState(() => new Set()) // hidden column indexes
  const [widths, setWidths]   = useState(null)            // px per column index once a column is resized
  const [pinFirst, setPinFirst] = useState(true)

  const { columns, rows } = set
  const filtered = useMemo(() => filterRows(rows, filters), [rows, filters])
  const viewRows = useMemo(() => (sort ? sortRows(filtered, sort.col, sort.dir) : filtered), [filtered, sort])
  const visibleCols = useMemo(() => columns.map((_, i) => i).filter(i => !hidden.has(i)), [columns, hidden])
  const activeFilters = Object.keys(filters).map(Number).filter(c => isFilterActive(filters[c]))

  return {
    sort, filters, hidden, widths, pinFirst, viewRows, visibleCols, activeFilters,
    setWidths, setPinFirst,
    /** header click: ascending → descending → unsorted */
    cycleSort: (col) => setSort(s => (!s || s.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null)),
    setSortDir: (col, dir) => setSort(dir ? { col, dir } : null),
    setFilter: (col, f) => setFilters(prev => {
      const next = { ...prev }
      if (f && (f.text || f.values)) next[col] = f
      else delete next[col]
      return next
    }),
    clearFilters: () => setFilters({}),
    toggleColumn: (col) => setHidden(prev => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else if (columns.length - next.size > 1) next.add(col) // keep at least one column
      return next
    }),
    showAllColumns: () => setHidden(new Set()),
    /** labels and rows as displayed: visible columns, filtered and sorted, every page */
    exportView: () => ({
      labels: visibleCols.map(i => columns[i].label),
      rows: viewRows.map(r => visibleCols.map(i => r[i])),
    }),
  }
}
