import { useState, useRef, useCallback, useEffect } from 'react'
import axios from 'axios'
import QueryPane from './QueryPane.jsx'

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
  // ── connection mode ─────────────────────────────────────────────────────
  // 'aep' = use AEP API + sandbox flow  |  'direct' = manual DB credentials
  const [connMode, setConnMode]           = useState('aep')

  // AEP mode state
  const [config, setConfig]               = useState(null)
  const [org, setOrg]                     = useState('')
  const [tenant, setTenant]               = useState('')
  const [sandboxes, setSandboxes]         = useState([])
  const [selectedSandbox, setSelectedSandbox] = useState('')

  // Direct mode state
  const [directHost, setDirectHost]       = useState('')
  const [directPort, setDirectPort]       = useState('5432')
  const [directDb, setDirectDb]           = useState('')
  const [directUser, setDirectUser]       = useState('')
  const [directPwd, setDirectPwd]         = useState('')

  const [connStatus, setConnStatus]       = useState('idle')

  // ── multi-pane state ─────────────────────────────────────────────────────
  const MAX_PANES = 3
  const mkPane = (n) => ({ id: Date.now() + n, label: `Query ${n}` })
  const [panes, setPanes]                 = useState(() => [mkPane(1)])
  const [activePane, setActivePane]       = useState(0) // index into panes[]
  const paneRefs                          = useRef({})  // keyed by pane.id

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

  // Restore state from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem('aep_config')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setConfig(parsed)
        setOrg(parsed.IMS_ORG || '')
      } catch { /* ignore */ }
    }
    const storedDirect = sessionStorage.getItem('direct_conn')
    if (storedDirect) {
      try {
        const d = JSON.parse(storedDirect)
        setDirectHost(d.host || '')
        setDirectPort(d.port || '5432')
        setDirectDb(d.dbName || '')
        setDirectUser(d.user || '')
        // password is intentionally NOT restored from storage
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
    setConnecting(true)
    setConnStatus('connecting')

    if (connMode === 'direct') {
      addLog('info', `Connecting directly to ${directHost}:${directPort}/${directDb}…`)
      // persist non-sensitive direct fields
      sessionStorage.setItem('direct_conn', JSON.stringify({
        host: directHost, port: directPort, dbName: directDb, user: directUser,
      }))
      try {
        const res = await api.post('/connect/direct', {
          host: directHost, port: directPort, dbName: directDb,
          user: directUser, password: directPwd,
        })
        setConnStatus('connected')
        addLog('info', `Connected. Host: ${res.data.host} · DB: ${res.data.dbName}`)
      } catch (err) {
        setConnStatus('error')
        addLog('error', `Connection failed: ${err.response?.data?.error || err.message}`)
      } finally {
        setConnecting(false)
      }
      return
    }

    // AEP mode
    if (!config || !selectedSandbox) { setConnecting(false); setConnStatus('idle'); return }
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
    const label = connMode === 'direct'
      ? `${directHost}/${directDb}`
      : `sandbox "${selectedSandbox}"`
    addLog('info', `Disconnected from ${label}.`)
  }

  // ── execute query (delegates to active pane ref) ─────────────────────────
  const handleExecute = () => {
    if (connStatus !== 'connected') { addLog('error', 'Not connected. Please connect first.'); return }
    const pane = panes[activePane]
    if (!pane) return
    const paneRef = paneRefs.current[pane.id]
    if (!paneRef) return
    const endpoint = connMode === 'direct' ? '/query/direct' : '/query'
    const payload  = connMode === 'direct'
      ? { host: directHost, port: directPort, dbName: directDb, user: directUser, password: directPwd }
      : { API_KEY: config.API_KEY, CLIENT_SECRET: config.CLIENT_SECRET, SCOPES: config.SCOPES, IMS_ORG: config.IMS_ORG, SANDBOX_NAME: selectedSandbox }
    paneRef.execute(endpoint, payload)
  }

  // ── pane management ──────────────────────────────────────────────────────
  const handleAddPane = () => {
    if (panes.length >= MAX_PANES) return
    const newPane = { id: Date.now(), label: `Query ${panes.length + 1}` }
    const newPanes = [...panes, newPane]
    setPanes(newPanes)
    setActivePane(newPanes.length - 1)
  }

  const handleClosePane = (idx) => {
    if (panes.length === 1) return // always keep at least one
    const pane = panes[idx]
    delete paneRefs.current[pane.id]
    const newPanes = panes.filter((_, i) => i !== idx)
    // relabel to keep names tidy
    const relabeled = newPanes.map((p, i) => ({ ...p, label: `Query ${i + 1}` }))
    setPanes(relabeled)
    setActivePane(Math.min(idx, relabeled.length - 1))
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

          {/* Card header + mode toggle */}
          <div className="flex items-center justify-between mb-4">
            <p className={`text-[11px] font-semibold uppercase tracking-widest ${C.mutedText}`}>Configuration</p>
            {/* Mode toggle pill */}
            <div className={`flex rounded-lg border ${C.cardBorder} p-0.5 gap-0.5`}>
              {[
                { id: 'aep',    label: 'AEP API' },
                { id: 'direct', label: 'Direct Connection' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => { if (connStatus !== 'connected') { setConnMode(id); setConnStatus('idle') } }}
                  disabled={connStatus === 'connected'}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all disabled:cursor-not-allowed ${
                    connMode === id
                      ? 'bg-[#2563eb] text-white'
                      : `${C.mutedText} hover:text-[#c9ccd8]`
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── AEP API mode ── */}
          {connMode === 'aep' && (
            <>
              <div className="grid grid-cols-12 gap-3 items-start">
                {/* Config File — 3 cols */}
                <div className="col-span-12 sm:col-span-3">
                  <Label>Config File</Label>
                  <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                  <Btn variant="ghost" onClick={() => fileInputRef.current?.click()} className="w-full">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4" />
                    </svg>
                    {config ? 'Re-upload Config' : 'Upload Config JSON'}
                  </Btn>
                  <p className="h-5 mt-1.5 text-[11px] flex items-center gap-1">
                    {config && (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Config loaded
                      </span>
                    )}
                  </p>
                </div>

                {/* Organization — 4 cols */}
                <div className="col-span-12 sm:col-span-4">
                  <Label>Organization (IMS_ORG)</Label>
                  <ReadonlyField value={org} placeholder="Upload config to populate" />
                  <div className="h-5 mt-1.5" />
                </div>

                {/* Tenant — 3 cols */}
                <div className="col-span-12 sm:col-span-3">
                  <Label>Tenant</Label>
                  <ReadonlyField value={tenant} placeholder="Load sandboxes to populate" />
                  <div className="h-5 mt-1.5" />
                </div>

                {/* Load Sandboxes — 2 cols */}
                <div className="col-span-12 sm:col-span-2">
                  <Label>&#8203;</Label>
                  <Btn variant="primary" onClick={handleLoadSandboxes} disabled={!config} loading={loadingSandboxes} className="w-full">
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

              <div className={`border-t ${C.divider} my-4`} />

              {/* Sandbox + Connect row */}
              <div className="grid grid-cols-12 gap-3 items-end">
                <div className="col-span-12 sm:col-span-10">
                  <Label>Sandbox</Label>
                  <select
                    value={selectedSandbox}
                    onChange={e => {
                      setSelectedSandbox(e.target.value)
                      if (connStatus === 'connected') { setConnStatus('idle'); addLog('info', 'Sandbox changed — disconnected.') }
                    }}
                    disabled={sandboxes.length === 0 || connStatus === 'connected'}
                    className={`w-full rounded-lg border ${C.inputBorder} ${C.inputBg} px-3 py-2 text-sm ${C.bodyText} focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed appearance-none`}
                  >
                    <option value="">— Select a Sandbox —</option>
                    {sandboxes.map(s => <option key={s.name} value={s.name}>{s.title}</option>)}
                  </select>
                </div>
                <div className="col-span-12 sm:col-span-2">
                  {connStatus === 'connected' ? (
                    <Btn variant="danger" onClick={handleDisconnect} className="w-full">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Disconnect
                    </Btn>
                  ) : (
                    <Btn variant="success" onClick={handleConnect} disabled={!selectedSandbox} loading={connecting} className="w-full">
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
            </>
          )}

          {/* ── Direct Connection mode ── */}
          {connMode === 'direct' && (
            <div className="grid grid-cols-12 gap-3 items-end">
              {/* Host — 4 cols */}
              <div className="col-span-12 sm:col-span-4">
                <Label>Host</Label>
                <input
                  type="text"
                  value={directHost}
                  onChange={e => setDirectHost(e.target.value)}
                  placeholder="e.g. foo.platform-query.adobe.io"
                  disabled={connStatus === 'connected'}
                  className={`w-full rounded-lg border ${C.inputBorder} ${C.inputBg} px-3 py-2 text-sm ${C.bodyText} placeholder-[#3a3d52] focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:opacity-50`}
                />
              </div>

              {/* Port — 1 col */}
              <div className="col-span-6 sm:col-span-1">
                <Label>Port</Label>
                <input
                  type="text"
                  value={directPort}
                  onChange={e => setDirectPort(e.target.value)}
                  placeholder="5432"
                  disabled={connStatus === 'connected'}
                  className={`w-full rounded-lg border ${C.inputBorder} ${C.inputBg} px-3 py-2 text-sm ${C.bodyText} placeholder-[#3a3d52] focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:opacity-50`}
                />
              </div>

              {/* DB Name — 2 cols */}
              <div className="col-span-6 sm:col-span-2">
                <Label>Database</Label>
                <input
                  type="text"
                  value={directDb}
                  onChange={e => setDirectDb(e.target.value)}
                  placeholder="dbname"
                  disabled={connStatus === 'connected'}
                  className={`w-full rounded-lg border ${C.inputBorder} ${C.inputBg} px-3 py-2 text-sm ${C.bodyText} placeholder-[#3a3d52] focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:opacity-50`}
                />
              </div>

              {/* User — 2 cols */}
              <div className="col-span-6 sm:col-span-2">
                <Label>User</Label>
                <input
                  type="text"
                  value={directUser}
                  onChange={e => setDirectUser(e.target.value)}
                  placeholder="username"
                  disabled={connStatus === 'connected'}
                  className={`w-full rounded-lg border ${C.inputBorder} ${C.inputBg} px-3 py-2 text-sm ${C.bodyText} placeholder-[#3a3d52] focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:opacity-50`}
                />
              </div>

              {/* Password — 1 col */}
              <div className="col-span-6 sm:col-span-1">
                <Label>Password</Label>
                <input
                  type="password"
                  value={directPwd}
                  onChange={e => setDirectPwd(e.target.value)}
                  placeholder="••••••"
                  disabled={connStatus === 'connected'}
                  className={`w-full rounded-lg border ${C.inputBorder} ${C.inputBg} px-3 py-2 text-sm ${C.bodyText} placeholder-[#3a3d52] focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:opacity-50`}
                />
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
                    disabled={!directHost || !directDb || !directUser}
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
          )}
        </div>

        {/* ── PANE AREA ── */}
        <div className="flex flex-col flex-1">

          {/* Outer pane tab bar: Query 1 / Query 2 / Query 3 / [+] / [Execute] */}
          <div className="flex items-center gap-1 px-1">
            {panes.map((pane, idx) => (
              <div
                key={pane.id}
                onClick={() => setActivePane(idx)}
                className={`group flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg border-t border-x cursor-pointer transition-all select-none ${
                  activePane === idx
                    ? `${C.cardBg} ${C.cardBorder} ${C.headingText} border-b-0`
                    : `bg-transparent border-transparent ${C.tabInactiveText} hover:text-[#e8eaf0]`
                }`}
              >
                {pane.label}
                {/* close button — only show if more than 1 pane */}
                {panes.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); handleClosePane(idx) }}
                    className="w-3.5 h-3.5 flex items-center justify-center rounded-full text-[#3a3d52] hover:text-[#e8eaf0] hover:bg-[#2a2d3e] transition-all opacity-0 group-hover:opacity-100"
                    title="Close tab"
                  >
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M2 2l8 8M10 2l-8 8" />
                    </svg>
                  </button>
                )}
              </div>
            ))}

            {/* + button (hidden when at max) */}
            {panes.length < MAX_PANES && (
              <button
                onClick={handleAddPane}
                className={`flex items-center justify-center w-7 h-7 rounded-lg border border-transparent text-[#3a3d52] hover:text-[#e8eaf0] hover:border-[#2a2d3e] hover:bg-[#1a1d27] transition-all`}
                title="Add query tab"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}

            {/* Execute button — right-aligned */}
            <div className="ml-auto">
              <Btn
                variant="success"
                onClick={handleExecute}
                disabled={connStatus !== 'connected'}
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                </svg>
                Execute
              </Btn>
            </div>
          </div>

          {/* Render all panes but only show the active one (keeps state alive) */}
          {panes.map((pane, idx) => (
            <div key={pane.id} className={idx === activePane ? 'flex flex-col flex-1' : 'hidden'}>
              <QueryPane
                ref={el => { paneRefs.current[pane.id] = el }}
                addLog={addLog}
              />
            </div>
          ))}
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
