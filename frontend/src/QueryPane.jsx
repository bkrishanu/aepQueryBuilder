import { useState, useRef, useEffect, useLayoutEffect, forwardRef, useImperativeHandle } from 'react'
import api from './api.js'
import { LoaderCircle, Copy, Check, Table2, CircleCheck } from 'lucide-react'
import SqlEditor from './SqlEditor.jsx'
import Btn from './Button.jsx'

// ─── shared design tokens (keep in sync with App.jsx C object) ───────────────
const C = {
  cardBg:      'bg-white',
  cardBorder:  'border-slate-200',
  inputBg:     'bg-white',
  mutedText:   'text-slate-400',
  bodyText:    'text-slate-700',
  headingText: 'text-slate-900',
}

// ─── ResultsTable ─────────────────────────────────────────────────────────────
// Grid viewport shows at most MAX_VISIBLE_ROWS rows × MAX_VISIBLE_COLS columns.
//   rows ≤ 20 → grid sizes to its rows (no filler rows, no vertical scrollbar)
//   rows > 20 → grid height fixed at exactly 20 rows, vertical scroll for the rest
//   cols ≤ 5  → columns share the full width equally, no horizontal scrollbar
//   cols > 5  → each column is 1/5 of the width, horizontal scroll for the rest
const MAX_VISIBLE_ROWS = 20
const MAX_VISIBLE_COLS = 5
const HEADER_H = 40
const ROW_H    = 36

function ResultsTable({ results }) {
  const scrollRef = useRef(null)
  const tableRef  = useRef(null)
  const [viewportH, setViewportH] = useState(null)

  const colCount = results.columns.length
  const rowCount = results.rows.length
  const wideMode = colCount > MAX_VISIBLE_COLS
  const tallMode = rowCount > MAX_VISIBLE_ROWS

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
  }, [results, tallMode, wideMode])

  // table width as % of the viewport: 100% for ≤5 cols, 20% per column beyond that
  const tableWidthPct = wideMode ? (colCount / MAX_VISIBLE_COLS) * 100 : 100
  const colWidthPct   = 100 / colCount

  return (
    <div
      ref={scrollRef}
      className="results-grid relative rounded-lg border border-slate-200 bg-white"
      style={{
        overflowX: wideMode ? 'auto' : 'hidden',
        overflowY: tallMode ? 'auto' : 'hidden',
        height: tallMode ? (viewportH ?? HEADER_H + MAX_VISIBLE_ROWS * ROW_H) : undefined,
      }}
    >
      <table
        ref={tableRef}
        className="border-separate border-spacing-0 text-sm"
        style={{ width: `${tableWidthPct}%`, tableLayout: 'fixed' }}
      >
        <colgroup>
          {results.columns.map(col => <col key={col} style={{ width: `${colWidthPct}%` }} />)}
        </colgroup>
        <thead>
          <tr>
            {results.columns.map((col, ci) => (
              <th
                key={col}
                title={col}
                className={`sticky top-0 z-10 bg-slate-100 px-4 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600 border-b border-slate-200 whitespace-nowrap overflow-hidden text-ellipsis ${ci < colCount - 1 ? 'border-r border-r-slate-200' : ''}`}
                style={{ height: `${HEADER_H}px` }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.rows.map((row, i) => (
            <tr
              key={i}
              className={`group transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'} hover:bg-blue-50/70`}
            >
              {results.columns.map((col, ci) => {
                const v = row[col]
                const isNull = v === null || v === undefined
                return (
                  <td
                    key={col}
                    title={isNull ? 'null' : String(v)}
                    className={`px-4 text-slate-700 whitespace-nowrap overflow-hidden text-ellipsis ${i < rowCount - 1 ? 'border-b border-slate-100' : ''} ${ci < colCount - 1 ? 'border-r border-r-slate-100' : ''}`}
                    style={{ height: `${ROW_H}px` }}
                  >
                    {isNull
                      ? <span className="text-slate-400 italic text-xs">null</span>
                      : String(v)}
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

// ─── QueryPane ────────────────────────────────────────────────────────────────
// Exposes execute(payload, endpoint, addLog) via ref so parent can trigger runs.
const QueryPane = forwardRef(function QueryPane({ addLog }, ref) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState(null)
  const [executing, setExecuting] = useState(false)
  const [activeTab, setActiveTab] = useState('editor') // 'editor' | 'results'
  const editorRef               = useRef(null)
  const [copied, setCopied]     = useState(false) // transient "Copied" feedback on the copy button

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  // Expose execute + getQueryToRun to parent
  useImperativeHandle(ref, () => ({
    execute: async (endpoint, payload) => {
      const toRun = editorRef.current?.getQueryToRun() ?? query.trim()
      if (!toRun) { addLog('warn', 'Query is empty.'); return }

      setExecuting(true)
      addLog('info', `Executing: ${toRun.slice(0, 80)}${toRun.length > 80 ? '…' : ''}`)
      try {
        const res = await api.post(endpoint, { ...payload, query: toRun })
        setResults(res.data)
        setActiveTab('results')
        addLog('info', `Query returned ${res.data.rows.length} row(s) in ${res.data.duration}ms.`)
      } catch (err) {
        setResults(null)
        addLog('error', `Query failed: ${err.response?.data?.error || err.message}`)
      } finally {
        setExecuting(false)
      }
    },
    getQueryToRun: () => editorRef.current?.getQueryToRun() ?? query.trim(),
    isExecuting: () => executing,
  }))

  const handleCopyResults = () => {
    if (!results) return
    const lines = [
      results.columns.join('\t'),
      ...results.rows.map(r => results.columns.map(c => r[c] ?? '').join('\t')),
    ]
    navigator.clipboard.writeText(lines.join('\n'))
    addLog('info', 'Results copied to clipboard (tab-delimited).')
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* inner tab bar: Editor | Results */}
      <div className="flex items-center gap-1 px-3 sm:px-4 border-b border-slate-200 shrink-0 overflow-x-auto">
        {[
          { id: 'editor',  label: 'Query Editor' },
          { id: 'results', label: 'Results' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`relative -mb-px flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            {label}
            {id === 'results' && results && (
              <span className={`text-[11px] font-semibold rounded-full px-2 py-px tabular-nums ${
                activeTab === id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {results.rows.length}
              </span>
            )}
            {id === 'results' && executing && (
              <LoaderCircle size={13} strokeWidth={2.5} className="animate-spin" />
            )}
          </button>
        ))}
      </div>

      {/* panel body */}
      <div className={`${C.cardBg} rounded-b-2xl flex flex-col flex-1 min-w-0`}>

        {/* Query Editor */}
        {activeTab === 'editor' && (
          <div className="flex flex-col p-3 sm:p-4 gap-3" style={{ height: '420px' }}>
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">SQL Query</span>
              {executing ? (
                <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5 flex items-center gap-1.5">
                  <LoaderCircle size={14} strokeWidth={2.5} className="animate-spin" />
                  Running…
                </span>
              ) : (
                <span className="hidden sm:inline text-[11px] text-slate-400">Runs the selection, or the statement under the cursor</span>
              )}
            </div>
            <div className="flex-1 min-h-0 rounded-lg border border-slate-200 overflow-hidden shadow-inner focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/15 transition-colors">
              <SqlEditor
                ref={editorRef}
                value={query}
                onChange={setQuery}
                placeholder="SELECT * FROM your_dataset LIMIT 10;"
              />
            </div>
          </div>
        )}

        {/* Results */}
        {activeTab === 'results' && (
          <div className="flex flex-col p-3 sm:p-4 gap-3 min-w-0" style={{ minHeight: '420px' }}>
            <div className="flex items-center justify-between gap-3 shrink-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Results
                {results && (
                  <span className="ml-2 normal-case tracking-normal text-slate-400 font-normal">
                    {results.rows.length} row{results.rows.length !== 1 ? 's' : ''} · {results.columns.length} col{results.columns.length !== 1 ? 's' : ''}
                    {results.duration !== undefined && ` · ${results.duration}ms`}
                  </span>
                )}
              </span>
              <Btn
                variant="secondary"
                size="sm"
                icon={copied ? Check : Copy}
                iconClassName={copied ? 'text-emerald-600' : ''}
                onClick={() => { handleCopyResults(); setCopied(true) }}
                disabled={!results || results.rows.length === 0}
              >
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy Results'}</span>
                <span className="sm:hidden">{copied ? 'Copied' : 'Copy'}</span>
              </Btn>
            </div>
            {executing && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <LoaderCircle size={32} strokeWidth={2} className="animate-spin text-blue-600" />
                <p className="text-sm text-slate-500">Executing query, please wait…</p>
              </div>
            )}
            {!executing && !results && (
              <EmptyState
                title="No results yet"
                text="Execute a query to see data here."
                icon={Table2}
              />
            )}
            {!executing && results && results.rows.length === 0 && (
              <EmptyState
                title="Query executed successfully"
                text="No rows returned."
                icon={CircleCheck}
              />
            )}
            {!executing && results && results.rows.length > 0 && (
              <ResultsTable results={results} />
            )}
          </div>
        )}
      </div>
    </div>
  )
})

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 py-10">
      <div className="w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400">
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="text-xs text-slate-400">{text}</p>
    </div>
  )
}

export default QueryPane
