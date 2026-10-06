import { useState, useRef, useMemo, useLayoutEffect } from 'react'
import { ArrowUp, ArrowDown, ArrowUpDown, ListFilter, Search, X, RotateCcw } from 'lucide-react'
import { Popover } from './Overlay.jsx'
import {
  cellText, isComplex, prettyValue, distinctValues, isFilterActive, NULL_KEY,
} from './cellValues.js'

// ─── ResultsTable ─────────────────────────────────────────────────────────────
// Grid viewport shows at most MAX_VISIBLE_ROWS rows × MAX_VISIBLE_COLS columns.
//   rows ≤ 20 → grid sizes to its rows (no filler rows, no vertical scrollbar)
//   rows > 20 → grid height fixed at exactly 20 rows, vertical scroll for the rest
//   cols ≤ 5  → columns share the full width equally, no horizontal scrollbar
//   cols > 5  → each column is 1/5 of the width, horizontal scroll for the rest
// Once a column is resized every visible column gets a pixel width and the
// grid scrolls horizontally whenever they overflow.
const MAX_VISIBLE_ROWS = 20
const MAX_VISIBLE_COLS = 5
const HEADER_H = 40
const ROW_H    = 36
const MIN_COL_W = 64
const DEFAULT_COL_W = 160
const RESIZE_STEP = 16
// Text cells at least this long open the value viewer on click (they're likely truncated)
const VIEWER_MIN_CHARS = 40
const TOOLTIP_MAX_CHARS = 1000

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s)

/**
 * One page of a result set. `rows` are arrays in column order; `columns` are
 * { name, label } with labels made unique by the server (_id, _id (2)), so
 * columns that share a name each keep their own values. `view` is the
 * useResultView state; only its visible columns are rendered.
 */
export function ResultsTable({ columns, rows, rowOffset = 0, view, onOpenCell, onOpenFilter }) {
  const scrollRef = useRef(null)
  const tableRef  = useRef(null)
  const headRef   = useRef(null)
  const [viewportH, setViewportH] = useState(null)
  const { visibleCols, widths, sort, filters } = view

  const colCount = visibleCols.length
  const rowCount = rows.length
  const custom   = !!widths
  const wideMode = custom || colCount > MAX_VISIBLE_COLS
  const tallMode = rowCount > MAX_VISIBLE_ROWS
  const pinned   = view.pinFirst && colCount > 1

  // a new page starts at its first row
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [rows])

  // When there are more than 20 rows, size the viewport to exactly header + 20
  // rows, measured from the DOM so borders and any horizontal scrollbar are
  // accounted for (otherwise the scrollbar would eat into the 20th row).
  useLayoutEffect(() => {
    if (!tallMode) return
    const el = scrollRef.current
    const table = tableRef.current
    if (!el || !table) return
    const measure = () => {
      const firstHidden = table.tBodies[0]?.rows[MAX_VISIBLE_ROWS]
      if (!firstHidden || el.offsetParent === null) return // not visible yet
      const chrome = el.offsetHeight - el.clientHeight // borders + horizontal scrollbar
      setViewportH(firstHidden.offsetTop + chrome)
    }
    measure()
    // re-measure when the grid becomes visible (e.g. results arrived on a hidden pane)
    const ro = new ResizeObserver(measure)
    ro.observe(table)
    return () => ro.disconnect()
  }, [rows, columns, tallMode, wideMode, widths, visibleCols])

  const widthOf = (c) => widths?.[c] ?? DEFAULT_COL_W
  // table width as % of the viewport: 100% for ≤5 cols, 20% per column beyond that
  const tableStyle = custom
    ? { width: `${visibleCols.reduce((sum, c) => sum + widthOf(c), 0)}px`, tableLayout: 'fixed' }
    : { width: `${wideMode ? (colCount / MAX_VISIBLE_COLS) * 100 : 100}%`, tableLayout: 'fixed' }
  const colStyle = (c) => (custom ? { width: `${widthOf(c)}px` } : { width: `${100 / colCount}%` })

  // pixel widths for every visible column, measured on the first resize so the
  // layout doesn't jump when it switches from percentages
  const baseWidths = () => {
    if (widths) return [...widths]
    const base = []
    const ths = headRef.current?.children || []
    visibleCols.forEach((c, k) => { base[c] = Math.round(ths[k]?.getBoundingClientRect().width || DEFAULT_COL_W) })
    return base
  }

  const startResize = (e, col) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    const base = baseWidths()
    const startX = e.clientX
    const startW = base[col] ?? DEFAULT_COL_W
    view.setWidths(base)
    handle.setPointerCapture?.(e.pointerId)
    const move = (ev) => {
      const next = [...base]
      next[col] = Math.max(MIN_COL_W, Math.round(startW + ev.clientX - startX))
      view.setWidths(next)
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const keyResize = (e, col) => {
    const delta = e.key === 'ArrowRight' ? RESIZE_STEP : e.key === 'ArrowLeft' ? -RESIZE_STEP : 0
    if (!delta) return
    e.preventDefault()
    const next = baseWidths()
    next[col] = Math.max(MIN_COL_W, (next[col] ?? DEFAULT_COL_W) + delta)
    view.setWidths(next)
  }

  return (
    <div
      ref={scrollRef}
      className="results-grid relative rounded-lg border border-slate-200 bg-surface"
      style={{
        overflowX: wideMode ? 'auto' : 'hidden',
        overflowY: tallMode ? 'auto' : 'hidden',
        height: tallMode ? (viewportH ?? HEADER_H + MAX_VISIBLE_ROWS * ROW_H) : undefined,
      }}
    >
      <table ref={tableRef} className="border-separate border-spacing-0 text-sm" style={tableStyle}>
        <colgroup>
          {visibleCols.map(c => <col key={c} style={colStyle(c)} />)}
        </colgroup>
        <thead>
          <tr ref={headRef}>
            {visibleCols.map((c, k) => {
              const col = columns[c]
              const dir = sort?.col === c ? sort.dir : null
              const filtered = isFilterActive(filters[c])
              const pin = pinned && k === 0
              const nameNote = col.label === col.name ? col.name : `${col.label} — another column is also named "${col.name}"`
              return (
                <th
                  key={c}
                  scope="col"
                  aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                  className={`group/th sticky top-0 ${pin ? 'left-0 z-20 pinned-col' : 'z-10'} bg-slate-100 p-0 text-left border-b border-slate-200 ${k < colCount - 1 ? 'border-r border-r-slate-200' : ''}`}
                  style={{ height: `${HEADER_H}px` }}
                >
                  <div className="flex h-full items-center gap-0.5 pl-3 pr-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => view.cycleSort(c)}
                      title={`${nameNote} — click to sort${dir === 'asc' ? ' descending' : dir === 'desc' ? ' (clear sort)' : ' ascending'}`}
                      className={`flex h-full min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40 rounded-sm ${dir || filtered ? 'text-blue-700' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      <span className="truncate">{col.label}</span>
                      {dir === 'asc' && <ArrowUp size={13} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />}
                      {dir === 'desc' && <ArrowDown size={13} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />}
                      {!dir && <ArrowUpDown size={12} strokeWidth={2.25} className="shrink-0 opacity-0 group-hover/th:opacity-50" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={e => onOpenFilter?.(c, e.currentTarget)}
                      aria-label={`Filter ${col.label}${filtered ? ' (filter active)' : ''}`}
                      title={filtered ? 'Filter active — edit or clear' : 'Filter this column'}
                      className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                        filtered ? 'bg-blue-100 text-blue-700' : 'text-slate-400 opacity-60 hover:opacity-100 hover:bg-slate-200 hover:text-slate-700 group-hover/th:opacity-100'
                      }`}
                    >
                      <ListFilter size={13} strokeWidth={2.25} />
                      {filtered && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-slate-100" />}
                    </button>
                  </div>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${col.label} (arrow keys)`}
                    aria-valuenow={widths?.[c]}
                    tabIndex={0}
                    onPointerDown={e => startResize(e, c)}
                    onKeyDown={e => keyResize(e, c)}
                    onClick={e => e.stopPropagation()}
                    className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-blue-400/50 focus:outline-none focus-visible:bg-blue-500/60"
                  />
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowOffset + i} className="group">
              {visibleCols.map((c, k) => {
                const col = columns[c]
                const v = row[c]
                const isNull = v === null || v === undefined
                const complex = isComplex(v)
                const text = cellText(v)
                const viewable = complex || text.length >= VIEWER_MIN_CHARS
                const open = () => onOpenCell?.({ column: col.label, row: rowOffset + i + 1, value: v })
                const pin = pinned && k === 0
                return (
                  <td
                    key={c}
                    title={isNull ? 'null' : clip(viewable ? prettyValue(v) : text, TOOLTIP_MAX_CHARS)}
                    onDoubleClick={isNull ? undefined : open}
                    className={`px-4 text-slate-700 whitespace-nowrap overflow-hidden text-ellipsis transition-colors ${
                      i % 2 === 0 ? 'bg-surface' : 'bg-slate-50'
                    } group-hover:bg-blue-50 ${pin ? 'sticky left-0 z-[1] pinned-col' : ''} ${
                      i < rowCount - 1 ? 'border-b border-slate-100' : ''
                    } ${k < colCount - 1 ? 'border-r border-r-slate-100' : ''}`}
                    style={{ height: `${ROW_H}px` }}
                  >
                    {isNull
                      ? <span className="text-slate-400 italic text-xs">null</span>
                      : viewable
                        ? (
                          <button
                            type="button"
                            onClick={open}
                            aria-label={`View full value of ${col.label}, row ${rowOffset + i + 1}`}
                            className={`block w-full truncate text-left cursor-zoom-in rounded-sm hover:underline decoration-dotted underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${complex ? 'font-mono text-[12px] text-slate-600' : ''}`}
                          >
                            {text}
                          </button>
                        )
                        : text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── FilterBar ────────────────────────────────────────────────────────────────
/** Active-filter chips above the grid, each removable, plus "Clear all". */
export function FilterBar({ columns, view, onEdit }) {
  const { activeFilters, filters } = view
  if (!activeFilters.length) return null
  const describe = (f) => {
    const parts = []
    if (f.text?.trim()) parts.push(`contains "${clip(f.text.trim(), 24)}"`)
    if (f.values) parts.push(`${f.values.size.toLocaleString()} value${f.values.size === 1 ? '' : 's'}`)
    return parts.join(' · ')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" role="status">
      <ListFilter size={13} strokeWidth={2.25} className="text-blue-600 shrink-0" aria-hidden="true" />
      <span className="text-slate-500">Filtered:</span>
      {activeFilters.map(c => (
        <span key={c} className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 max-w-full">
          <button
            type="button"
            onClick={e => onEdit?.(c, e.currentTarget)}
            className="truncate pl-2.5 pr-1 py-0.5 text-left rounded-l-full hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <span className="font-semibold">{columns[c].label}</span> {describe(filters[c])}
          </button>
          <button
            type="button"
            onClick={() => view.setFilter(c, null)}
            aria-label={`Remove filter on ${columns[c].label}`}
            className="mr-1 flex h-4 w-4 items-center justify-center rounded-full hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={view.clearFilters}
        className="ml-1 font-semibold text-slate-500 hover:text-rose-600 focus:outline-none focus-visible:underline"
      >
        Clear all
      </button>
    </div>
  )
}

// ─── ColumnFilterPopover ──────────────────────────────────────────────────────
// Text search plus, when a column has at most MAX_DISTINCT distinct values, a
// checklist of them with counts. Filters apply as you type / tick.
const MAX_DISTINCT = 100

const valueLabel = (key) => (key === NULL_KEY ? '(null)' : key === '' ? '(empty)' : key)

export function ColumnFilterPopover({ anchor, column, col, rows, view, onClose }) {
  const filter = view.filters[col] || { text: '', values: null }
  const distinct = useMemo(() => distinctValues(rows, col, MAX_DISTINCT), [rows, col])
  const dir = view.sort?.col === col ? view.sort.dir : null
  const text = filter.text || ''
  const needle = text.trim().toLowerCase()
  const listed = distinct && needle
    ? distinct.filter(d => d.key !== NULL_KEY && d.key.toLowerCase().includes(needle))
    : distinct

  const update = (patch) => view.setFilter(col, { ...filter, ...patch })
  const checked = (key) => !filter.values || filter.values.has(key)
  const toggle = (key) => {
    const next = new Set(filter.values || distinct.map(d => d.key))
    if (next.has(key)) next.delete(key)
    else next.add(key)
    update({ values: next.size === distinct.length ? null : next })
  }

  return (
    <Popover anchor={anchor} onClose={onClose} label={`Filter ${column.label}`} className="w-72">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <p className="truncate text-xs font-semibold text-slate-900" title={column.label}>{column.label}</p>
        <div className="flex shrink-0 items-center gap-1">
          {[['asc', ArrowUp, 'Sort ascending'], ['desc', ArrowDown, 'Sort descending']].map(([d, Icon, label]) => (
            <button
              key={d}
              type="button"
              onClick={() => view.setSortDir(col, dir === d ? null : d)}
              aria-pressed={dir === d}
              title={dir === d ? 'Clear sort' : label}
              aria-label={label}
              className={`flex h-6 w-6 items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${dir === d ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              <Icon size={13} strokeWidth={2.5} />
            </button>
          ))}
        </div>
      </div>
      <div className="p-3 space-y-2.5">
        <div className="relative">
          <Search size={13} strokeWidth={2.25} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            type="text"
            value={text}
            onChange={e => update({ text: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') onClose() }}
            placeholder="Contains…"
            aria-label={`Show rows where ${column.label} contains`}
            className="w-full rounded-md border border-slate-300 bg-surface py-1.5 pl-8 pr-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        {distinct ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-semibold uppercase tracking-wider text-slate-500">Values</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => update({ values: null })} className="font-semibold text-blue-600 hover:underline">All</button>
                <button type="button" onClick={() => update({ values: new Set() })} className="font-semibold text-blue-600 hover:underline">None</button>
              </span>
            </div>
            <ul className="explorer-scroll max-h-56 overflow-y-auto rounded-md border border-slate-200 py-1">
              {listed.length === 0 && <li className="px-2.5 py-1.5 text-xs text-slate-400">No matching values</li>}
              {listed.map(({ key, count }) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-xs hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked(key)}
                      onChange={() => toggle(key)}
                      className="h-3.5 w-3.5 shrink-0 accent-blue-600"
                    />
                    <span className={`min-w-0 flex-1 truncate ${key === NULL_KEY || key === '' ? 'italic text-slate-400' : 'text-slate-700'}`} title={valueLabel(key)}>
                      {valueLabel(key)}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-400">{count.toLocaleString()}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">More than {MAX_DISTINCT} distinct values — use the text search.</p>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2">
        <button
          type="button"
          onClick={() => view.setFilter(col, null)}
          disabled={!isFilterActive(filter)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600 disabled:opacity-40 disabled:hover:text-slate-500"
        >
          <RotateCcw size={12} strokeWidth={2.25} /> Clear filter
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
        >
          Done
        </button>
      </div>
    </Popover>
  )
}

// ─── ColumnPickerPopover ──────────────────────────────────────────────────────
/** Show / hide columns, pin the first column, reset resized widths. */
export function ColumnPickerPopover({ anchor, columns, view, onClose }) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const shown = columns.map((col, i) => ({ col, i })).filter(({ col }) => !needle || col.label.toLowerCase().includes(needle))
  const visibleCount = view.visibleCols.length

  return (
    <Popover anchor={anchor} onClose={onClose} label="Columns" align="end" className="w-72">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <p className="text-xs font-semibold text-slate-900">
          Columns <span className="font-normal text-slate-400 tabular-nums">{visibleCount} of {columns.length} shown</span>
        </p>
        <button
          type="button"
          onClick={view.showAllColumns}
          disabled={visibleCount === columns.length}
          className="text-[11px] font-semibold text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Show all
        </button>
      </div>
      <div className="p-3 space-y-2">
        {columns.length > 8 && (
          <div className="relative">
            <Search size={13} strokeWidth={2.25} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Find a column…"
              aria-label="Find a column"
              className="w-full rounded-md border border-slate-300 bg-surface py-1.5 pl-8 pr-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        )}
        <ul className="explorer-scroll max-h-64 overflow-y-auto rounded-md border border-slate-200 py-1">
          {shown.length === 0 && <li className="px-2.5 py-1.5 text-xs text-slate-400">No matching columns</li>}
          {shown.map(({ col, i }) => {
            const visible = !view.hidden.has(i)
            return (
              <li key={i}>
                <label className={`flex items-center gap-2 px-2.5 py-1 text-xs hover:bg-slate-50 ${visible && visibleCount === 1 ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={visible}
                    disabled={visible && visibleCount === 1}
                    onChange={() => view.toggleColumn(i)}
                    className="h-3.5 w-3.5 shrink-0 accent-blue-600"
                  />
                  <span className="min-w-0 flex-1 truncate text-slate-700" title={col.label}>{col.label}</span>
                  {isFilterActive(view.filters[i]) && <ListFilter size={12} strokeWidth={2.25} className="shrink-0 text-blue-600" aria-label="filtered" />}
                </label>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={view.pinFirst}
            onChange={e => view.setPinFirst(e.target.checked)}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          Pin first column
        </label>
        <button
          type="button"
          onClick={() => view.setWidths(null)}
          disabled={!view.widths}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-40 disabled:hover:text-slate-500"
        >
          <RotateCcw size={12} strokeWidth={2.25} /> Reset widths
        </button>
      </div>
    </Popover>
  )
}
