import { useState, useRef, forwardRef, useImperativeHandle } from 'react'
import axios from 'axios'
import SqlEditor from './SqlEditor.jsx'

const api = axios.create({ baseURL: '/api' })

// ─── shared design tokens (keep in sync with App.jsx C object) ───────────────
const C = {
  cardBg:      'bg-[#1a1d27]',
  cardBorder:  'border-[#2a2d3e]',
  inputBg:     'bg-[#12141c]',
  mutedText:   'text-[#555870]',
  bodyText:    'text-[#c9ccd8]',
  headingText: 'text-[#e8eaf0]',
}

function Btn({ onClick, disabled, variant = 'primary', loading = false, children, className = '' }) {
  const variants = {
    primary: 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white',
    success: 'bg-[#059669] hover:bg-[#047857] text-white',
    ghost:   'bg-transparent border border-[#2a2d3e] text-[#c9ccd8] hover:bg-[#22253a]',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {loading && (
        <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      )}
      {children}
    </button>
  )
}

function ResultsTable({ results }) {
  const colCount = results.columns.length
  const wideMode = colCount > 5
  const colWidth = 200
  const tableStyle = wideMode
    ? { minWidth: `${colCount * colWidth}px` }
    : { width: '100%', tableLayout: 'fixed' }
  const cellStyle = wideMode
    ? { width: `${colWidth}px`, minWidth: `${colWidth}px` }
    : { width: `${100 / colCount}%` }

  // header row ~38px + 50 rows × 34px = 1738px; beyond that vertical scrollbar appears
  const MAX_VISIBLE_HEIGHT = 38 + 50 * 34

  return (
    <div
      className="overflow-auto rounded-lg border border-[#2a2d3e]"
      style={{ maxHeight: `${MAX_VISIBLE_HEIGHT}px`, flex: '1 1 auto' }}
    >
      <table className="border-collapse text-sm" style={tableStyle}>
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#12141c]">
            {results.columns.map(col => (
              <th
                key={col}
                className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[#8b8fa8] border-b border-[#2a2d3e] border-r border-r-[#1e2030] whitespace-nowrap overflow-hidden text-ellipsis"
                style={cellStyle}
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
              className={`border-b border-[#1e2030] hover:bg-[#22253a] transition-colors ${i % 2 === 0 ? 'bg-[#1a1d27]' : 'bg-[#15172040]'}`}
              style={{ height: '34px' }}
            >
              {results.columns.map(col => (
                <td
                  key={col}
                  className="px-4 py-2 text-[#c9ccd8] border-r border-r-[#1e2030] whitespace-nowrap overflow-hidden text-ellipsis"
                  style={cellStyle}
                >
                  {row[col] === null || row[col] === undefined
                    ? <span className="text-[#3a3d52] italic">null</span>
                    : String(row[col])}
                </td>
              ))}
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
    <div className="flex flex-col h-full">
      {/* inner tab bar: Editor | Results */}
      <div className="flex items-center gap-1 px-1 shrink-0">
        {[
          { id: 'editor',  label: 'Query Editor' },
          { id: 'results', label: `Results${results ? ` (${results.rows.length})` : ''}` },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-5 py-2.5 text-sm font-medium rounded-t-lg border-t border-x transition-all ${
              activeTab === id
                ? `${C.cardBg} border-[#2a2d3e] text-[#e8eaf0] border-b-0`
                : `bg-transparent border-transparent text-[#555870] hover:text-[#e8eaf0]`
            }`}
          >
            {label}
            {id === 'results' && executing && (
              <svg className="inline-block ml-2 w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
          </button>
        ))}
      </div>

      {/* panel body */}
      <div className={`${C.cardBg} rounded-b-xl rounded-tr-xl border border-[#2a2d3e] flex flex-col flex-1`} style={{ minHeight: '340px', height: '400px' }}>

        {/* Query Editor */}
        {activeTab === 'editor' && (
          <div className="flex flex-col h-full p-4 gap-3">
            <div className="flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold uppercase tracking-widest text-[#555870]">SQL Query</span>
              {executing && (
                <span className="text-xs text-amber-400 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Running…
                </span>
              )}
            </div>
            <div className="flex-1 rounded-lg border border-[#2a2d3e] overflow-hidden">
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
          <div className="flex flex-col h-full p-4 gap-3">
            <div className="flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold uppercase tracking-widest text-[#555870]">
                Results
                {results && (
                  <span className="ml-2 normal-case text-[#3a3d52] font-normal">
                    {results.rows.length} row{results.rows.length !== 1 ? 's' : ''} · {results.columns.length} col{results.columns.length !== 1 ? 's' : ''}
                  </span>
                )}
              </span>
              <Btn variant="ghost" onClick={handleCopyResults} disabled={!results || results.rows.length === 0}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Results
              </Btn>
            </div>
            {executing && (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <svg className="w-8 h-8 animate-spin text-[#2563eb]" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <p className="text-sm text-[#555870]">Executing query, please wait…</p>
              </div>
            )}
            {!executing && !results && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-[#555870]">No results yet. Execute a query to see data here.</p>
              </div>
            )}
            {!executing && results && results.rows.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-[#555870]">Query executed successfully — no rows returned.</p>
              </div>
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

export default QueryPane
