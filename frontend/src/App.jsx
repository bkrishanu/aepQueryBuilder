import { useState, useRef, useCallback, useEffect } from 'react'
import axios from 'axios'

// ─── helpers ─────────────────────────────────────────────────────────────────
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 23)
const api = axios.create({ baseURL: '/api' })

// ─── design tokens (single source of truth) ──────────────────────────────────
// Palette: deep navy bg, cool-grey surface, slate text, teal accent
const C = {
  pageBg:       'bg-[#0f1117]',
  cardBg:       'bg-[#1a1d27]',
  cardBorder:   'border-[#2a2d3e]',
  inputBg:      'bg-[#12141c]',
  inputBorder:  'border-[#2a2d3e]',
  labelText:    'text-[#8b8fa8]',
  bodyText:     'text-[#c9ccd8]',
  headingText:  'text-[#e8eaf0]',
  mutedText:    'text-[#555870]',
  accentBg:     'bg-[#2563eb]',
  accentHover:  'hover:bg-[#1d4ed8]',
  accentText:   'text-[#2563eb]',
  successBg:    'bg-[#059669]',
  successHover: 'hover:bg-[#047857]',
  dangerBg:     'bg-[#dc2626]',
  dangerHover:  'hover:bg-[#b91c1c]',
  divider:      'border-[#2a2d3e]',
  tabActiveBg:  'bg-[#22253a]',
  tabActiveText:'text-[#e8eaf0]',
  tabInactiveText: 'text-[#555870]',
  consoleBg:    'bg-[#0b0d14]',
  consoleBorder:'border-[#1e2030]',
}

// ─── small primitives ─────────────────────────────────────────────────────────
function Label({ children }) {
  return (
    <label className={`block text-[11px] font-semibold uppercase tracking-widest mb-1.5 ${C.labelText}`}>
      {children}
    </label>
  )
}

function ReadonlyField({ value, placeholder }) {
  return (
    <input
      readOnly
      value={value}
      placeholder={placeholder}
      className={`w-full rounded-lg border ${C.inputBorder} ${C.inputBg} px-3 py-2 text-sm ${C.bodyText} placeholder-[#3a3d52] focus:outline-none font-mono`}
    />
  )
}

function Btn({ onClick, disabled, variant = 'primary', loading = false, children, className = '' }) {
  const variants = {
    primary:     `${C.accentBg} ${C.accentHover} text-white`,
    success:     `${C.successBg} ${C.successHover} text-white`,
    danger:      `${C.dangerBg} ${C.dangerHover} text-white`,
    ghost:       `bg-transparent border ${C.inputBorder} ${C.bodyText} hover:bg-[#22253a]`,
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

function StatusPill({ status }) {
  const cfg = {
    idle:       { dot: 'bg-[#3a3d52]',                           label: 'Not connected' },
    connecting: { dot: 'bg-amber-400 animate-pulse',              label: 'Connecting…'   },
    connected:  { dot: 'bg-emerald-400',                          label: 'Connected'      },
    error:      { dot: 'bg-red-500',                              label: 'Failed'         },
  }
  const { dot, label } = cfg[status] || cfg.idle
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border ${C.inputBorder} ${C.inputBg} px-3 py-1 text-xs font-medium ${C.bodyText}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

// ─── main app ─────────────────────────────────────────────────────────────────
export default function App() {
  const [config, setConfig]               = useState(null)
  const [org, setOrg]                     = useState('')
  const [tenant, setTenant]               = useState('')
  const [sandboxes, setSandboxes]         = useState([])
  const [selectedSandbox, setSelectedSandbox] = useState('')
  const [connStatus, setConnStatus]       = useState('idle')

  const [activeTab, setActiveTab]         = useState('editor')
  const [query, setQuery]                 = useState('')
  const [results, setResults]             = useState(null)
  const [executing, setExecuting]         = useState(false)
  const [loadingSandboxes, setLoadingSandboxes] = useState(false)
  const [connecting, setConnecting]       = useState(false)

  const [logs, setLogs]                   = useState([])
  const logsEndRef                        = useRef(null)
  const fileInputRef                      = useRef()

  const addLog = useCallback((level, message) => {
    setLogs(prev => [...prev, { ts: ts(), level, message }])
  }, [])

  // Auto-scroll console to bottom on new log
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Restore config from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem('aep_config')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setConfig(parsed)
        setOrg(parsed.IMS_ORG || '')
      } catch { /* ignore */ }
    }
  }, [])

  // ── config upload ────────────────────────────────────────────────────────
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    // reset input so same file can be re-uploaded
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result)
        sessionStorage.setItem('aep_config', JSON.stringify(parsed))
        setConfig(parsed)
        setOrg(parsed.IMS_ORG || '')
        // reset downstream state on new config
        setTenant('')
        setSandboxes([])
        setSelectedSandbox('')
        setConnStatus('idle')
        addLog('info', `Config loaded: ${file.name}`)
      } catch {
        addLog('error', 'Failed to parse config — ensure the file is valid JSON.')
      }
    }
    reader.readAsText(file)
  }

  // ── load sandboxes ───────────────────────────────────────────────────────
  const handleLoadSandboxes = async () => {
    if (!config) { addLog('error', 'Upload a config file first.'); return }
    setLoadingSandboxes(true)
    addLog('info', 'Fetching sandboxes…')
    try {
      const res = await api.post('/sandboxes', {
        API_KEY: config.API_KEY,
        CLIENT_SECRET: config.CLIENT_SECRET,
        SCOPES: config.SCOPES,
        IMS_ORG: config.IMS_ORG,
      })
      setSandboxes(res.data.sandboxes)
      setTenant(res.data.tenant || '')
      addLog('info', `${res.data.sandboxes.length} sandbox(es) loaded. Tenant: ${res.data.tenant}`)
    } catch (err) {
      addLog('error', `Load sandboxes failed: ${err.response?.data?.error || err.message}`)
    } finally {
      setLoadingSandboxes(false)
    }
  }

  // ── connect ──────────────────────────────────────────────────────────────
  const handleConnect = async () => {
    if (!config || !selectedSandbox) return
    setConnecting(true)
    setConnStatus('connecting')
    addLog('info', `Connecting to sandbox "${selectedSandbox}"…`)
    try {
      const res = await api.post('/connect', {
        API_KEY: config.API_KEY,
        CLIENT_SECRET: config.CLIENT_SECRET,
        SCOPES: config.SCOPES,
        IMS_ORG: config.IMS_ORG,
        SANDBOX_NAME: selectedSandbox,
      })
      setConnStatus('connected')
      addLog('info', `Connected. Host: ${res.data.host} · DB: ${res.data.dbName}`)
    } catch (err) {
      setConnStatus('error')
      addLog('error', `Connection failed: ${err.response?.data?.error || err.message}`)
    } finally {
      setConnecting(false)
    }
  }

  // ── disconnect ───────────────────────────────────────────────────────────
  const handleDisconnect = () => {
    setConnStatus('idle')
    setResults(null)
    addLog('info', `Disconnected from sandbox "${selectedSandbox}".`)
  }

  // ── execute query ────────────────────────────────────────────────────────
  const handleExecute = async () => {
    if (!query.trim()) { addLog('warn', 'Query is empty.'); return }
    if (connStatus !== 'connected') { addLog('error', 'Not connected. Please connect first.'); return }
    setExecuting(true)
    // stay on editor tab — results will show a loading state in the results tab
    addLog('info', `Executing: ${query.trim().slice(0, 80)}${query.trim().length > 80 ? '…' : ''}`)
    try {
      const res = await api.post('/query', {
        API_KEY: config.API_KEY,
        CLIENT_SECRET: config.CLIENT_SECRET,
        SCOPES: config.SCOPES,
        IMS_ORG: config.IMS_ORG,
        SANDBOX_NAME: selectedSandbox,
        query: query.trim(),
      })
      setResults(res.data)
      setActiveTab('results')  // switch AFTER we have results
      addLog('info', `Query returned ${res.data.rows.length} row(s) in ${res.data.duration}ms.`)
    } catch (err) {
      setResults(null)
      addLog('error', `Query failed: ${err.response?.data?.error || err.message}`)
    } finally {
      setExecuting(false)
    }
  }

  // ── copy results ─────────────────────────────────────────────────────────
  const handleCopyResults = () => {
    if (!results) return
    const lines = [
      results.columns.join('\t'),
      ...results.rows.map(r => results.columns.map(c => r[c] ?? '').join('\t')),
    ]
    navigator.clipboard.writeText(lines.join('\n'))
    addLog('info', 'Results copied to clipboard (tab-delimited).')
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${C.pageBg} flex flex-col`} style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── HEADER ── */}
      <header className={`${C.cardBg} border-b ${C.divider} px-6 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#2563eb] flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h7" />
            </svg>
          </div>
          <div>
            <h1 className={`text-sm font-semibold ${C.headingText} leading-tight`}>AEP Query Connector</h1>
            <p className={`text-[11px] ${C.mutedText}`}>Adobe Experience Platform · Query Service</p>
          </div>
        </div>
        <StatusPill status={connStatus} />
      </header>

      <div className="flex flex-col gap-4 p-4 flex-1 max-w-screen-2xl w-full mx-auto">

        {/* ── CONFIGURATION CARD ── */}
        <div className={`${C.cardBg} rounded-xl border ${C.cardBorder} p-5`}>
          <p className={`text-[11px] font-semibold uppercase tracking-widest ${C.mutedText} mb-4`}>Configuration</p>

          {/* Row 1: Config File | Organization | Tenant | Load Sandboxes button */}
          {/* items-start so all cells are top-aligned; each cell has Label + control at fixed height */}
          <div className="grid grid-cols-12 gap-3 items-start">

            {/* Config File — 3 cols */}
            <div className="col-span-12 sm:col-span-3">
              <Label>Config File</Label>
              <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
              <Btn
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                className="w-full"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4" />
                </svg>
                {config ? 'Re-upload Config' : 'Upload Config JSON'}
              </Btn>
              {/* Fixed-height hint row so it never shifts sibling columns */}
              <p className="h-5 mt-1.5 text-[11px] flex items-center gap-1">
                {config ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Config loaded
                  </span>
                ) : null}
              </p>
            </div>

            {/* Organization — 4 cols */}
            <div className="col-span-12 sm:col-span-4">
              <Label>Organization (IMS_ORG)</Label>
              <ReadonlyField value={org} placeholder="Upload config to populate" />
              {/* matching spacer so all columns share the same total height */}
              <div className="h-5 mt-1.5" />
            </div>

            {/* Tenant — 3 cols */}
            <div className="col-span-12 sm:col-span-3">
              <Label>Tenant</Label>
              <ReadonlyField value={tenant} placeholder="Load sandboxes to populate" />
              <div className="h-5 mt-1.5" />
            </div>

            {/* Load Sandboxes button — 2 cols */}
            <div className="col-span-12 sm:col-span-2">
              <Label>&#8203;</Label>{/* zero-width space keeps label height identical */}
              <Btn
                variant="primary"
                onClick={handleLoadSandboxes}
                disabled={!config}
                loading={loadingSandboxes}
                className="w-full"
              >
                {!loadingSandboxes && (
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="2" y="3" width="20" height="5" rx="1" strokeLinecap="round" strokeLinejoin="round" />
                    <rect x="2" y="10" width="20" height="5" rx="1" strokeLinecap="round" strokeLinejoin="round" />
                    <rect x="2" y="17" width="20" height="5" rx="1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {loadingSandboxes ? 'Loading…' : 'Load Sandboxes'}
              </Btn>
              <div className="h-5 mt-1.5" />
            </div>
          </div>

          {/* Divider */}
          <div className={`border-t ${C.divider} my-4`} />

          {/* Row 2: Sandbox dropdown | Connect / Disconnect */}
          <div className="grid grid-cols-12 gap-3 items-end">

            {/* Sandbox — 10 cols */}
            <div className="col-span-12 sm:col-span-10">
              <Label>Sandbox</Label>
              <select
                value={selectedSandbox}
                onChange={e => {
                  setSelectedSandbox(e.target.value)
                  if (connStatus === 'connected') {
                    setConnStatus('idle')
                    addLog('info', 'Sandbox changed — disconnected.')
                  }
                }}
                disabled={sandboxes.length === 0 || connStatus === 'connected'}
                className={`w-full rounded-lg border ${C.inputBorder} ${C.inputBg} px-3 py-2 text-sm ${C.bodyText} focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed appearance-none`}
              >
                <option value="">— Select a Sandbox —</option>
                {sandboxes.map(s => (
                  <option key={s.name} value={s.name}>{s.title}</option>
                ))}
              </select>
            </div>

            {/* Connect / Disconnect — 2 cols */}
            <div className="col-span-12 sm:col-span-2">
              {connStatus === 'connected' ? (
                <Btn variant="danger" onClick={handleDisconnect} className="w-full">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Disconnect
                </Btn>
              ) : (
                <Btn
                  variant="success"
                  onClick={handleConnect}
                  disabled={!selectedSandbox}
                  loading={connecting}
                  className="w-full"
                >
                  {!connecting && (
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  )}
                  {connecting ? 'Connecting…' : 'Connect'}
                </Btn>
              )}
            </div>
          </div>
        </div>

        {/* ── TABS + PANELS ── */}
        <div className="flex flex-col gap-0 flex-1">

          {/* Tab bar */}
          <div className="flex items-center gap-1 px-1">
            {[
              { id: 'editor',  label: 'Query Editor' },
              { id: 'results', label: `Results${results ? ` (${results.rows.length})` : ''}` },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`px-5 py-2.5 text-sm font-medium rounded-t-lg border-t border-x transition-all ${
                  activeTab === id
                    ? `${C.cardBg} ${C.cardBorder} ${C.headingText} border-b-0`
                    : `bg-transparent border-transparent ${C.tabInactiveText} hover:${C.tabActiveText}`
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

          {/* Panel wrapper */}
          <div className={`${C.cardBg} rounded-b-xl rounded-tr-xl border ${C.cardBorder} flex flex-col`} style={{ minHeight: '380px', height: '420px' }}>

            {/* ── QUERY EDITOR ── */}
            {activeTab === 'editor' && (
              <div className="flex flex-col h-full p-4 gap-3">
                <div className="flex items-center justify-between shrink-0">
                  <span className={`text-xs font-semibold uppercase tracking-widest ${C.mutedText}`}>SQL Query</span>
                  <Btn
                    variant="success"
                    onClick={handleExecute}
                    disabled={connStatus !== 'connected'}
                    loading={executing}
                  >
                    {!executing && (
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                      </svg>
                    )}
                    {executing ? 'Executing…' : 'Execute'}
                  </Btn>
                </div>
                {/* single scrollable textarea — no wrapper div to avoid double scrollbar */}
                <textarea
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="SELECT * FROM your_dataset LIMIT 10;"
                  spellCheck={false}
                  className={`flex-1 w-full rounded-lg border border-[#2a2d3e] ${C.inputBg} px-4 py-3 text-sm font-mono ${C.bodyText} placeholder-[#3a3d52] resize-none overflow-auto focus:outline-none`}
                />
                {executing && (
                  <div className="shrink-0 flex items-center gap-2 text-xs text-amber-400">
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Query is running — results will appear in the Results tab when complete…
                  </div>
                )}
              </div>
            )}

            {/* ── RESULTS ── */}
            {activeTab === 'results' && (
              <div className="flex flex-col h-full p-4 gap-3">
                <div className="flex items-center justify-between shrink-0">
                  <span className={`text-xs font-semibold uppercase tracking-widest ${C.mutedText}`}>
                    Results
                    {results && (
                      <span className="ml-2 normal-case text-[#555870] font-normal">
                        {results.rows.length} row{results.rows.length !== 1 ? 's' : ''} · {results.columns.length} column{results.columns.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </span>
                  <Btn
                    variant="ghost"
                    onClick={handleCopyResults}
                    disabled={!results || results.rows.length === 0}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Results
                  </Btn>
                </div>

                {/* executing spinner */}
                {executing && (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3">
                    <svg className="w-8 h-8 animate-spin text-[#2563eb]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    <p className={`text-sm ${C.mutedText}`}>Executing query, please wait…</p>
                  </div>
                )}

                {/* empty state */}
                {!executing && !results && (
                  <div className="flex-1 flex items-center justify-center">
                    <p className={`text-sm ${C.mutedText}`}>No results yet. Execute a query to see data here.</p>
                  </div>
                )}

                {/* zero rows */}
                {!executing && results && results.rows.length === 0 && (
                  <div className="flex-1 flex items-center justify-center">
                    <p className={`text-sm ${C.mutedText}`}>Query executed successfully — no rows returned.</p>
                  </div>
                )}

                {/* data table */}
                {!executing && results && results.rows.length > 0 && (() => {
                  const colCount = results.columns.length
                  // ≤5 cols → fill width evenly; ≥6 cols → fixed min-width per col, horizontal scroll
                  const wideMode = colCount > 5
                  const colWidth = wideMode ? 200 : undefined   // px per col when scrolling
                  const tableStyle = wideMode
                    ? { minWidth: `${colCount * colWidth}px` }
                    : { width: '100%', tableLayout: 'fixed' }
                  const cellStyle = wideMode
                    ? { width: `${colWidth}px`, minWidth: `${colWidth}px` }
                    : { width: `${100 / colCount}%` }
                  return (
                  <div className="flex-1 overflow-auto rounded-lg border border-[#2a2d3e]">
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
                            className={`border-b border-[#1e2030] hover:bg-[#22253a] transition-colors ${
                              i % 2 === 0 ? 'bg-[#1a1d27]' : 'bg-[#15172040]'
                            }`}
                            style={{ height: '34px' }}
                          >
                            {results.columns.map(col => (
                              <td
                                key={col}
                                className="px-4 py-2 text-[#c9ccd8] border-r border-r-[#1e2030] whitespace-nowrap overflow-hidden text-ellipsis"
                                style={cellStyle}
                              >
                                {row[col] === null || row[col] === undefined ? (
                                  <span className="text-[#3a3d52] italic">null</span>
                                ) : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )
                })()}
              </div>
            )}
          </div>
        </div>

        {/* ── CONSOLE LOG ── */}
        <div className={`${C.consoleBg} rounded-xl border ${C.consoleBorder} flex flex-col`} style={{ height: '200px' }}>
          <div className={`flex items-center justify-between px-4 py-2 border-b ${C.consoleBorder} shrink-0`}>
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-[#3a3d52]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#3a3d52]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#3a3d52]" />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#3a3d52] ml-1">Console</span>
            </div>
            <button
              onClick={() => setLogs([])}
              className="text-[11px] text-[#3a3d52] hover:text-[#8b8fa8] transition-colors"
            >
              Clear
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[12px] space-y-0.5">
            {logs.length === 0 && (
              <span className="text-[#2a2d3e]">No entries yet.</span>
            )}
            {logs.map((entry, i) => (
              <div key={i} className="flex gap-3 leading-5">
                <span className="text-[#3a3d52] shrink-0 tabular-nums">{entry.ts}</span>
                <span className={
                  entry.level === 'error' ? 'text-red-500 shrink-0' :
                  entry.level === 'warn'  ? 'text-amber-400 shrink-0' :
                  'text-[#2563eb] shrink-0'
                }>
                  {entry.level === 'error' ? '✖' : entry.level === 'warn' ? '⚠' : '›'}
                </span>
                <span className="text-[#8b8fa8] break-all">{entry.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

      </div>

      {/* ── FOOTER ── */}
      <footer className={`text-center text-[11px] ${C.mutedText} py-3 border-t ${C.divider} ${C.cardBg}`}>
        AEP Query Connector · Adobe Experience Platform Query Service
      </footer>
    </div>
  )
}
