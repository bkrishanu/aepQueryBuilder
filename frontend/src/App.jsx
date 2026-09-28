import { useState, useRef, useCallback } from 'react'
import axios from 'axios'

// ─── helpers ────────────────────────────────────────────────────────────────
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 23)
const api = axios.create({ baseURL: '/api' })

// ─── small UI primitives ─────────────────────────────────────────────────────
function Label({ children }) {
  return <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{children}</label>
}

function ReadonlyField({ value, placeholder }) {
  return (
    <input
      readOnly
      value={value}
      placeholder={placeholder}
      className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none"
    />
  )
}

function StatusDot({ status }) {
  // status: 'idle' | 'connecting' | 'connected' | 'error'
  const map = {
    idle: 'bg-slate-300',
    connecting: 'bg-amber-400 animate-pulse',
    connected: 'bg-emerald-500',
    error: 'bg-red-500',
  }
  const label = {
    idle: 'Not connected',
    connecting: 'Connecting…',
    connected: 'Connected',
    error: 'Connection failed',
  }
  return (
    <span className="flex items-center gap-2 text-sm text-slate-600">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${map[status]}`} />
      {label[status]}
    </span>
  )
}

// ─── main app ────────────────────────────────────────────────────────────────
export default function App() {
  // config
  const [config, setConfig] = useState(null)
  const fileInputRef = useRef()

  // fields
  const [org, setOrg] = useState('')
  const [tenant, setTenant] = useState('')
  const [sandboxes, setSandboxes] = useState([])
  const [selectedSandbox, setSelectedSandbox] = useState('')
  const [connStatus, setConnStatus] = useState('idle') // idle | connecting | connected | error

  // query
  const [activeTab, setActiveTab] = useState('editor') // editor | results
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // { columns, rows } | null
  const [executing, setExecuting] = useState(false)
  const [loadingSandboxes, setLoadingSandboxes] = useState(false)
  const [connecting, setConnecting] = useState(false)

  // logs
  const [logs, setLogs] = useState([])

  const addLog = useCallback((level, message) => {
    setLogs(prev => [...prev, { ts: ts(), level, message }])
  }, [])

  // ── config file upload ───────────────────────────────────────────────────
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result)
        sessionStorage.setItem('aep_config', JSON.stringify(parsed))
        setConfig(parsed)
        setOrg(parsed.IMS_ORG || '')
        addLog('info', `Config file loaded: ${file.name}`)
      } catch {
        addLog('error', 'Failed to parse config JSON file.')
      }
    }
    reader.readAsText(file)
  }

  // on mount — restore config from session storage
  const loadFromSession = () => {
    const stored = sessionStorage.getItem('aep_config')
    if (stored && !config) {
      try {
        const parsed = JSON.parse(stored)
        setConfig(parsed)
        setOrg(parsed.IMS_ORG || '')
      } catch { /* ignore */ }
    }
  }
  if (!config) loadFromSession()

  // ── load sandboxes ───────────────────────────────────────────────────────
  const handleLoadSandboxes = async () => {
    if (!config) { addLog('error', 'Upload a config file first.'); return }
    setLoadingSandboxes(true)
    addLog('info', 'Loading sandboxes…')
    try {
      const res = await api.post('/sandboxes', {
        API_KEY: config.API_KEY,
        CLIENT_SECRET: config.CLIENT_SECRET,
        SCOPES: config.SCOPES,
        IMS_ORG: config.IMS_ORG,
      })
      setSandboxes(res.data.sandboxes)
      setTenant(res.data.tenant || '')
      addLog('info', `Loaded ${res.data.sandboxes.length} sandbox(es). Tenant: ${res.data.tenant}`)
    } catch (err) {
      addLog('error', `Failed to load sandboxes: ${err.response?.data?.error || err.message}`)
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
      addLog('info', `Connected successfully. DB: ${res.data.dbName}, Host: ${res.data.host}`)
    } catch (err) {
      setConnStatus('error')
      addLog('error', `Connection failed: ${err.response?.data?.error || err.message}`)
    } finally {
      setConnecting(false)
    }
  }

  // ── execute query ────────────────────────────────────────────────────────
  const handleExecute = async () => {
    if (!query.trim()) { addLog('warn', 'Query is empty.'); return }
    if (connStatus !== 'connected') { addLog('error', 'Not connected. Please connect first.'); return }
    setExecuting(true)
    setActiveTab('results')
    addLog('info', `Executing query: ${query.trim().slice(0, 80)}${query.length > 80 ? '…' : ''}`)
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

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* ── header ── */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h7" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-800 leading-tight">AEP Query Connector</h1>
            <p className="text-xs text-slate-500">Adobe Experience Platform · Query Service</p>
          </div>
        </div>
        <StatusDot status={connStatus} />
      </header>

      <div className="flex flex-col gap-4 p-5 flex-1">
        {/* ── top config card ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Configuration</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Config upload */}
            <div className="sm:col-span-2 lg:col-span-1 flex flex-col gap-1">
              <Label>Config File</Label>
              <input
                type="file"
                accept=".json"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition cursor-pointer w-full"
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4" />
                </svg>
                {config ? 'Re-upload Config' : 'Upload Config JSON'}
              </button>
              {config && (
                <span className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Config loaded
                </span>
              )}
            </div>

            {/* Organization */}
            <div>
              <Label>Organization (IMS_ORG)</Label>
              <ReadonlyField value={org} placeholder="Upload config to populate" />
            </div>

            {/* Tenant */}
            <div>
              <Label>Tenant</Label>
              <ReadonlyField value={tenant} placeholder="Load sandboxes to populate" />
            </div>

            {/* Load Sandboxes */}
            <div className="flex flex-col justify-end">
              <button
                onClick={handleLoadSandboxes}
                disabled={!config || loadingSandboxes}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loadingSandboxes ? 'Loading…' : 'Load Sandboxes'}
              </button>
            </div>
          </div>

          {/* Sandbox + Connect row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div className="sm:col-span-2">
              <Label>Sandbox</Label>
              <select
                value={selectedSandbox}
                onChange={e => { setSelectedSandbox(e.target.value); setConnStatus('idle') }}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={sandboxes.length === 0}
              >
                <option value="">— Select a Sandbox —</option>
                {sandboxes.map(s => (
                  <option key={s.name} value={s.name}>{s.title}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col justify-end">
              <button
                onClick={handleConnect}
                disabled={!selectedSandbox || connecting}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {connecting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </div>
        </div>

        {/* ── main work area: tabs + console ── */}
        <div className="flex flex-col gap-4 flex-1">
          {/* tab bar */}
          <div className="flex gap-0.5 bg-slate-200 rounded-lg p-1 w-fit">
            {['editor', 'results'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                  activeTab === tab
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                {tab === 'editor' ? 'Query Editor' : 'Results'}
              </button>
            ))}
          </div>

          {/* tab panels */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col" style={{ minHeight: '320px' }}>
            {/* Query Editor */}
            {activeTab === 'editor' && (
              <div className="flex flex-col flex-1 h-full p-4 gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">Query Editor</h3>
                  <button
                    onClick={handleExecute}
                    disabled={executing || connStatus !== 'connected'}
                    className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {executing ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        Executing…
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                        </svg>
                        Execute
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="SELECT * FROM your_dataset LIMIT 10;"
                  spellCheck={false}
                  className="flex-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  style={{ minHeight: '240px' }}
                />
              </div>
            )}

            {/* Results */}
            {activeTab === 'results' && (
              <div className="flex flex-col flex-1 p-4 gap-3 overflow-hidden">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700">
                    Results {results ? <span className="text-slate-400 font-normal">({results.rows.length} rows)</span> : ''}
                  </h3>
                  <button
                    onClick={handleCopyResults}
                    disabled={!results}
                    className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Results
                  </button>
                </div>

                {!results && (
                  <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                    No results yet. Execute a query to see results here.
                  </div>
                )}

                {results && results.rows.length === 0 && (
                  <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                    Query executed successfully — no rows returned.
                  </div>
                )}

                {results && results.rows.length > 0 && (
                  <div className="overflow-auto flex-1 rounded-md border border-slate-200">
                    <table className="min-w-full text-sm border-collapse">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          {results.columns.map(col => (
                            <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-slate-600 border-b border-slate-200 whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.rows.map((row, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                            {results.columns.map(col => (
                              <td key={col} className="px-3 py-1.5 text-slate-700 border-b border-slate-100 whitespace-nowrap max-w-xs truncate">
                                {row[col] === null || row[col] === undefined ? (
                                  <span className="text-slate-400 italic">null</span>
                                ) : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Console Log panel */}
          <div className="bg-slate-900 rounded-xl border border-slate-700 shadow-sm flex flex-col" style={{ minHeight: '180px', maxHeight: '260px' }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Console Log</span>
              <button
                onClick={() => setLogs([])}
                className="text-xs text-slate-500 hover:text-slate-300 transition"
              >
                Clear Logs
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs space-y-0.5">
              {logs.length === 0 && (
                <span className="text-slate-600">No log entries yet.</span>
              )}
              {logs.map((entry, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-slate-500 shrink-0">{entry.ts}</span>
                  <span className={
                    entry.level === 'error' ? 'text-red-400' :
                    entry.level === 'warn'  ? 'text-amber-400' :
                    'text-emerald-400'
                  }>
                    [{entry.level.toUpperCase()}]
                  </span>
                  <span className="text-slate-300 break-all">{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <footer className="text-center text-xs text-slate-400 py-3 border-t border-slate-200 bg-white">
        AEP Query Connector · Adobe Experience Platform Query Service
      </footer>
    </div>
  )
}
