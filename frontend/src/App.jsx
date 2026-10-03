import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import {
  SlidersHorizontal, Upload, ShieldCheck, Layers, Plug, Unplug, ChevronDown,
  SquareTerminal, Plus, X, Play, Eraser,
} from 'lucide-react'
import api, { SESSION_EXPIRED } from './api.js'
import QueryPane from './QueryPane.jsx'
import DatasetExplorer from './DatasetExplorer.jsx'
import Btn from './Button.jsx'

// ─── helpers ─────────────────────────────────────────────────────────────────
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 23)

// ─── design tokens (single source of truth) ──────────────────────────────────
// Palette: derived from the project logo (public/favicon.svg) —
// deep navy brand (#0F172A → #1E3A8A), sky accent (#0EA5E9), slate neutrals.
const C = {
  pageBg:       'bg-[#f4f6fb]',
  cardBg:       'bg-white',
  cardBorder:   'border-slate-200',
  inputBg:      'bg-white',
  inputBorder:  'border-slate-300',
  labelText:    'text-slate-500',
  bodyText:     'text-slate-700',
  headingText:  'text-slate-900',
  mutedText:    'text-slate-400',
  accentBg:     'bg-blue-600',
  accentHover:  'hover:bg-blue-700',
  accentText:   'text-blue-600',
  successBg:    'bg-emerald-600',
  successHover: 'hover:bg-emerald-700',
  dangerBg:     'bg-rose-600',
  dangerHover:  'hover:bg-rose-700',
  divider:      'border-slate-200',
  tabActiveBg:  'bg-white',
  tabActiveText:'text-slate-900',
  tabInactiveText: 'text-slate-500',
  consoleBg:    'bg-[#0b1220]',
  consoleBorder:'border-[#1e293b]',
  brandGradient:'bg-gradient-to-r from-[#0F172A] via-[#132257] to-[#1E3A8A]',
}

// shared text-input styling
const inputCls = `w-full rounded-lg border ${C.inputBorder} ${C.inputBg} px-3 py-2 text-sm ${C.bodyText} placeholder-slate-400 shadow-sm transition-colors focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed`

// ─── small primitives ─────────────────────────────────────────────────────────
function Logo({ className = 'w-9 h-9' }) {
  return <img src="/favicon.svg" alt="AEP Query Editor logo" className={`${className} shrink-0`} />
}

function Label({ children }) {
  return (
    <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${C.labelText}`}>
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
      className={`w-full rounded-lg border ${C.cardBorder} bg-slate-50 px-3 py-2 text-sm ${C.bodyText} placeholder-slate-400 focus:outline-none font-mono truncate`}
    />
  )
}

// Rendered on the dark brand header
function StatusPill({ status }) {
  const cfg = {
    idle:       { dot: 'bg-slate-400',                            label: 'Not connected' },
    connecting: { dot: 'bg-amber-400 animate-pulse',              label: 'Connecting…'   },
    connected:  { dot: 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.25)]', label: 'Connected' },
    error:      { dot: 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.25)]',      label: 'Failed'    },
  }
  const { dot, label } = cfg[status] || cfg.idle
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm whitespace-nowrap">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

function CardTitle({ icon, title, subtitle, children, className = 'mb-5' }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 transition-[margin] duration-300 ${className}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className={`text-sm font-semibold ${C.headingText} leading-tight`}>{title}</h2>
          {subtitle && <p className={`text-xs ${C.mutedText} mt-0.5 truncate`}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

// ─── main app ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── connection mode ─────────────────────────────────────────────────────
  // 'aep' = use AEP API + sandbox flow  |  'direct' = manual DB credentials
  const [connMode, setConnMode]           = useState('aep')

  // AEP mode state
  // Non-secret summary of the server-side credential session ({ IMS_ORG, expiresAt }).
  // The config's secrets are held only in an encrypted HttpOnly cookie.
  const [session, setSession]             = useState(null)
  const [uploading, setUploading]         = useState(false)
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
  // Configuration card can only be collapsed while connected; it auto-collapses
  // on a successful connect and is always expanded when not connected.
  const [configCollapsed, setConfigCollapsed] = useState(false)
  const configOpen = connStatus !== 'connected' || !configCollapsed

  // ── multi-pane state ─────────────────────────────────────────────────────
  const MAX_PANES = 3
  const mkPane = (n) => ({ id: Date.now() + n, label: `Query ${n}` })
  const [panes, setPanes]                 = useState(() => [mkPane(1)])
  const [activePane, setActivePane]       = useState(0) // index into panes[]
  const paneRefs                          = useRef({})  // keyed by pane.id

  const [loadingSandboxes, setLoadingSandboxes] = useState(false)
  const [connecting, setConnecting]       = useState(false)

  const [logs, setLogs]                   = useState([])
  const consoleRef                        = useRef(null)
  const fileInputRef                      = useRef()

  const addLog = useCallback((level, message) => {
    setLogs(prev => [...prev, { ts: ts(), level, message }])
  }, [])

  // Auto-scroll the console box to its newest entry. Scrolls only the console's
  // own container — scrollIntoView() would also scroll the page to the console.
  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [logs])

  // Restore state from sessionStorage on mount
  useEffect(() => {
    // Older versions kept the full config (incl. CLIENT_SECRET) here — purge it.
    sessionStorage.removeItem('aep_config')
    api.get('/session')
      .then(res => { setSession(res.data); setOrg(res.data.IMS_ORG || '') })
      .catch(() => { /* no active session */ })
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
  const resetAepState = () => {
    setSession(null)
    setOrg('')
    setTenant('')
    setSandboxes([])
    setSelectedSandbox('')
    if (connMode === 'aep') setConnStatus('idle')
  }

  // The file is parsed only to validate it and is posted straight to the backend,
  // which verifies it with Adobe IMS and seals it into an HttpOnly cookie. Nothing
  // from it is kept in browser storage or React state except IMS_ORG.
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    // reset input so same file can be re-uploaded
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = async (ev) => {
      let parsed
      try {
        parsed = JSON.parse(ev.target.result)
      } catch {
        addLog('error', 'Failed to parse config — ensure the file is valid JSON.')
        return
      }
      setUploading(true)
      addLog('info', `Verifying config ${file.name} with Adobe IMS…`)
      try {
        const res = await api.post('/session', parsed)
        resetAepState()
        setSession(res.data)
        setOrg(res.data.IMS_ORG || '')
        addLog('info', `Config verified and secured in an encrypted session (expires ${new Date(res.data.expiresAt).toLocaleTimeString()}).`)
      } catch (err) {
        addLog('error', `Config rejected: ${err.response?.data?.error || err.message}`)
      } finally {
        setUploading(false)
      }
    }
    reader.readAsText(file)
  }

  // ── forget credentials ───────────────────────────────────────────────────
  const handleForgetConfig = async () => {
    try {
      await api.delete('/session')
    } catch { /* cookie may already be gone */ }
    resetAepState()
    addLog('info', 'Credentials cleared from this browser session.')
  }

  // ── session expiry (reported by any API call) ────────────────────────────
  useEffect(() => {
    const onExpired = () => {
      setSession(null)
      setOrg('')
      setConnStatus(s => (connMode === 'aep' ? 'idle' : s))
      addLog('warn', 'Credential session expired — please re-upload your config file.')
    }
    window.addEventListener(SESSION_EXPIRED, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired)
  }, [connMode, addLog])

  // ── load sandboxes ───────────────────────────────────────────────────────
  const handleLoadSandboxes = async () => {
    if (!session) { addLog('error', 'Upload a config file first.'); return }
    setLoadingSandboxes(true)
    addLog('info', 'Fetching sandboxes…')
    try {
      const res = await api.post('/sandboxes', {})
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
        setConfigCollapsed(true)
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
    if (!session || !selectedSandbox) { setConnecting(false); setConnStatus('idle'); return }
    addLog('info', `Connecting to sandbox "${selectedSandbox}"…`)
    try {
      const res = await api.post('/connect', { SANDBOX_NAME: selectedSandbox })
      setConnStatus('connected')
      setConfigCollapsed(true)
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
    const label = connMode === 'direct'
      ? `${directHost}/${directDb}`
      : `sandbox "${selectedSandbox}"`
    addLog('info', `Disconnected from ${label}.`)
  }

  // ── dataset explorer credentials (AEP mode only, while connected) ────────
  const explorerCreds = useMemo(() => (
    connMode === 'aep' && connStatus === 'connected' && session && selectedSandbox
      ? { IMS_ORG: session.IMS_ORG, SANDBOX_NAME: selectedSandbox }
      : null
  ), [connMode, connStatus, session, selectedSandbox])

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
      : { SANDBOX_NAME: selectedSandbox }
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
    <div className={`min-h-screen ${C.pageBg} flex flex-col text-slate-700 antialiased`}>

      {/* ── HEADER (sticky — stays visible while page content scrolls) ── */}
      <header className={`sticky top-0 z-40 ${C.brandGradient} border-b border-white/10 shadow-lg shadow-slate-900/10`}>
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="w-9 h-9 rounded-[10px] ring-1 ring-white/20 shadow-md" />
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-white leading-tight tracking-tight truncate">AEP Query Editor</h1>
              <p className="hidden sm:block text-[11px] text-sky-200/70 truncate">Adobe Experience Platform · Query Service</p>
            </div>
          </div>
          <StatusPill status={connStatus} />
        </div>
      </header>

      <main className="flex flex-col gap-5 px-3 sm:px-6 py-5 sm:py-6 flex-1 max-w-screen-2xl w-full mx-auto">

        {/* ── CONFIGURATION CARD ── */}
        <section className={`${C.cardBg} rounded-2xl border ${C.cardBorder} shadow-sm p-4 sm:p-6`}>

          {/* Card header + mode toggle / collapsed summary */}
          <CardTitle
            title="Configuration"
            className={configOpen ? 'mb-5' : 'mb-0'}
            subtitle={
              connStatus === 'connected'
                ? `Connected · ${connMode === 'direct' ? `${directHost}:${directPort}/${directDb}` : `${selectedSandbox}${tenant ? ` · ${tenant}` : ''}`}`
                : connMode === 'aep' ? 'Authenticate with AEP API credentials and pick a sandbox' : 'Connect with raw database parameters'
            }
            icon={<SlidersHorizontal size={16} strokeWidth={2.25} />}
          >
            <div className="flex items-center gap-2 ml-auto">
              {/* Mode toggle (segmented control) — hidden while collapsed */}
              {configOpen && (
                <div className="flex rounded-lg bg-slate-100 p-1 gap-1 border border-slate-200">
                  {[
                    { id: 'aep',    label: 'AEP API' },
                    { id: 'direct', label: 'Direct Connection' },
                  ].map(({ id, label }) => (
                    <button
                      key={id}
                      onClick={() => { if (connStatus !== 'connected') { setConnMode(id); setConnStatus('idle') } }}
                      disabled={connStatus === 'connected'}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all disabled:cursor-not-allowed ${
                        connMode === id
                          ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200'
                          : 'text-slate-500 hover:text-slate-800 disabled:hover:text-slate-500'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Disconnect stays reachable while the card is collapsed */}
              {!configOpen && (
                <Btn variant="danger" size="sm" icon={Unplug} onClick={handleDisconnect}>
                  Disconnect
                </Btn>
              )}

              {connStatus === 'connected' && (
                <Btn
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfigCollapsed(c => !c)}
                  title={configOpen ? 'Collapse configuration' : 'Expand configuration'}
                  className="!px-2"
                >
                  <ChevronDown
                    size={16}
                    strokeWidth={2.25}
                    className={`transition-transform duration-300 ${configOpen ? 'rotate-180' : ''}`}
                  />
                  <span className="sr-only">{configOpen ? 'Collapse configuration' : 'Expand configuration'}</span>
                </Btn>
              )}
            </div>
          </CardTitle>

          {/* Collapsible body (animated via grid-template-rows 1fr ↔ 0fr) */}
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${configOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            inert={!configOpen}
          >
          <div className="min-h-0 overflow-hidden -m-1 p-1">

          {/* ── AEP API mode ── */}
          {connMode === 'aep' && (
            <>
              <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-start">
                {/* Config File — 3 cols */}
                <div className="col-span-12 md:col-span-6 lg:col-span-3">
                  <Label>Config File</Label>
                  <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                  <Btn variant="secondary" icon={Upload} onClick={() => fileInputRef.current?.click()} loading={uploading} className="w-full">
                    {uploading ? 'Verifying…' : session ? 'Re-upload Config' : 'Upload Config JSON'}
                  </Btn>
                  <p className="h-5 mt-1.5 text-[11px] flex items-center gap-1">
                    {session && (
                      <>
                        <span
                          className="text-emerald-600 font-medium flex items-center gap-1"
                          title={`Credentials are encrypted in an HttpOnly cookie and never stored in the browser. Expires ${new Date(session.expiresAt).toLocaleString()}.`}
                        >
                          <ShieldCheck size={13} strokeWidth={2.25} />
                          Secured in session
                        </span>
                        <button
                          type="button"
                          onClick={handleForgetConfig}
                          disabled={connStatus === 'connected'}
                          title={connStatus === 'connected' ? 'Disconnect first' : 'Remove credentials from this browser session'}
                          className="ml-auto font-semibold text-slate-400 hover:text-rose-600 disabled:opacity-40 disabled:hover:text-slate-400 disabled:cursor-not-allowed"
                        >
                          Forget
                        </button>
                      </>
                    )}
                  </p>
                </div>

                {/* Organization — 4 cols */}
                <div className="col-span-12 md:col-span-6 lg:col-span-4">
                  <Label>Organization (IMS_ORG)</Label>
                  <ReadonlyField value={org} placeholder="Upload config to populate" />
                  <div className="hidden lg:block h-5 mt-1.5" />
                </div>

                {/* Tenant — 3 cols */}
                <div className="col-span-12 md:col-span-6 lg:col-span-3">
                  <Label>Tenant</Label>
                  <ReadonlyField value={tenant} placeholder="Load sandboxes to populate" />
                  <div className="hidden lg:block h-5 mt-1.5" />
                </div>

                {/* Load Sandboxes — 2 cols */}
                <div className="col-span-12 md:col-span-6 lg:col-span-2">
                  <span className="hidden md:block"><Label>&#8203;</Label></span>
                  <Btn variant="secondary" icon={Layers} onClick={handleLoadSandboxes} disabled={!session} loading={loadingSandboxes} className="w-full">
                    {loadingSandboxes ? 'Loading…' : 'Load Sandboxes'}
                  </Btn>
                  <div className="hidden lg:block h-5 mt-1.5" />
                </div>
              </div>

              <div className={`border-t ${C.divider} my-4`} />

              {/* Sandbox + Connect row */}
              <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-end">
                <div className="col-span-12 md:col-span-9 lg:col-span-10">
                  <Label>Sandbox</Label>
                  <div className="relative">
                    <select
                      value={selectedSandbox}
                      onChange={e => {
                        setSelectedSandbox(e.target.value)
                        if (connStatus === 'connected') { setConnStatus('idle'); addLog('info', 'Sandbox changed — disconnected.') }
                      }}
                      disabled={sandboxes.length === 0 || connStatus === 'connected'}
                      className={`${inputCls} appearance-none pr-9 cursor-pointer`}
                    >
                      <option value="">— Select a Sandbox —</option>
                      {sandboxes.map(s => <option key={s.name} value={s.name}>{s.title}</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
                <div className="col-span-12 md:col-span-3 lg:col-span-2">
                  {connStatus === 'connected' ? (
                    <Btn variant="danger" icon={Unplug} onClick={handleDisconnect} className="w-full">
                      Disconnect
                    </Btn>
                  ) : (
                    <Btn variant="primary" icon={Plug} onClick={handleConnect} disabled={!selectedSandbox} loading={connecting} className="w-full">
                      {connecting ? 'Connecting…' : 'Connect'}
                    </Btn>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── Direct Connection mode ── */}
          {connMode === 'direct' && (
            <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-end">
              {/* Host — 4 cols */}
              <div className="col-span-12 md:col-span-8 lg:col-span-4">
                <Label>Host</Label>
                <input
                  type="text"
                  value={directHost}
                  onChange={e => setDirectHost(e.target.value)}
                  placeholder="e.g. foo.platform-query.adobe.io"
                  disabled={connStatus === 'connected'}
                  className={inputCls}
                />
              </div>

              {/* Port — 1 col */}
              <div className="col-span-6 md:col-span-4 lg:col-span-1">
                <Label>Port</Label>
                <input
                  type="text"
                  value={directPort}
                  onChange={e => setDirectPort(e.target.value)}
                  placeholder="5432"
                  disabled={connStatus === 'connected'}
                  className={inputCls}
                />
              </div>

              {/* DB Name — 2 cols */}
              <div className="col-span-6 md:col-span-4 lg:col-span-2">
                <Label>Database</Label>
                <input
                  type="text"
                  value={directDb}
                  onChange={e => setDirectDb(e.target.value)}
                  placeholder="dbname"
                  disabled={connStatus === 'connected'}
                  className={inputCls}
                />
              </div>

              {/* User — 2 cols */}
              <div className="col-span-6 md:col-span-4 lg:col-span-2">
                <Label>User</Label>
                <input
                  type="text"
                  value={directUser}
                  onChange={e => setDirectUser(e.target.value)}
                  placeholder="username"
                  disabled={connStatus === 'connected'}
                  className={inputCls}
                />
              </div>

              {/* Password — 1 col */}
              <div className="col-span-6 md:col-span-4 lg:col-span-1">
                <Label>Password</Label>
                <input
                  type="password"
                  value={directPwd}
                  onChange={e => setDirectPwd(e.target.value)}
                  placeholder="••••••"
                  disabled={connStatus === 'connected'}
                  className={inputCls}
                />
              </div>

              {/* Connect / Disconnect — 2 cols */}
              <div className="col-span-12 lg:col-span-2">
                {connStatus === 'connected' ? (
                  <Btn variant="danger" icon={Unplug} onClick={handleDisconnect} className="w-full">
                    Disconnect
                  </Btn>
                ) : (
                  <Btn
                    variant="primary"
                    icon={Plug}
                    onClick={handleConnect}
                    disabled={!directHost || !directDb || !directUser}
                    loading={connecting}
                    className="w-full"
                  >
                    {connecting ? 'Connecting…' : 'Connect'}
                  </Btn>
                )}
              </div>
            </div>
          )}
          </div>
          </div>
        </section>

        {/* ── EXPLORER + WORKSPACE ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] gap-5 flex-1 items-stretch">

        <DatasetExplorer credentials={explorerCreds} addLog={addLog} />

        {/* ── PANE AREA (workspace card) ── */}
        <section className={`${C.cardBg} rounded-2xl border ${C.cardBorder} shadow-sm flex flex-col flex-1 min-w-0`}>

          {/* Toolbar: Query 1 / Query 2 / Query 3 / [+] / [Execute] */}
          <div className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b ${C.divider} bg-slate-50/70 rounded-t-2xl`}>
            <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
              {panes.map((pane, idx) => (
                <div
                  key={pane.id}
                  onClick={() => setActivePane(idx)}
                  className={`group flex items-center gap-2 pl-3 ${panes.length > 1 ? 'pr-2' : 'pr-3'} py-1.5 text-sm font-medium rounded-lg border cursor-pointer transition-all select-none whitespace-nowrap ${
                    activePane === idx
                      ? `bg-white border-slate-200 ${C.tabActiveText} shadow-sm`
                      : `bg-transparent border-transparent ${C.tabInactiveText} hover:text-slate-900 hover:bg-white/70`
                  }`}
                >
                  <SquareTerminal size={15} strokeWidth={2} className={`shrink-0 ${activePane === idx ? 'text-blue-600' : 'text-slate-400'}`} />
                  {pane.label}
                  {/* close button — only show if more than 1 pane */}
                  {panes.length > 1 && (
                    <button
                      onClick={e => { e.stopPropagation(); handleClosePane(idx) }}
                      className={`w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-200 transition-all ${
                        activePane === idx ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                      title="Close tab"
                    >
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              ))}

              {/* + button (hidden when at max) */}
              {panes.length < MAX_PANES && (
                <button
                  onClick={handleAddPane}
                  className="flex items-center justify-center w-8 h-8 shrink-0 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50 transition-all"
                  title="Add query tab"
                >
                  <Plus size={16} strokeWidth={2.25} />
                </button>
              )}
            </div>

            {/* Execute button — right-aligned */}
            <div className="ml-auto shrink-0">
              <Btn
                variant="success"
                icon={Play}
                onClick={handleExecute}
                disabled={connStatus !== 'connected'}
                title="Run the selected text, or the statement under the cursor"
                iconClassName="fill-current"
                className="!px-5"
              >
                Execute
              </Btn>
            </div>
          </div>

          {/* Render all panes but only show the active one (keeps state alive) */}
          {panes.map((pane, idx) => (
            <div key={pane.id} className={idx === activePane ? 'flex flex-col flex-1 min-w-0' : 'hidden'}>
              <QueryPane
                ref={el => { paneRefs.current[pane.id] = el }}
                addLog={addLog}
              />
            </div>
          ))}
        </section>

        </div>

        {/* ── CONSOLE LOG ── */}
        <section className={`${C.consoleBg} rounded-2xl border ${C.consoleBorder} shadow-sm flex flex-col overflow-hidden`} style={{ height: '200px' }}>
          <div className={`flex items-center justify-between px-4 py-2.5 border-b ${C.consoleBorder} bg-[#0f172a] shrink-0`}>
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#10b981]/70" />
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 ml-1.5">Console</span>
              {logs.length > 0 && (
                <span className="text-[10px] font-medium text-slate-400 bg-white/5 border border-white/10 rounded-full px-1.5 py-px tabular-nums">{logs.length}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLogs([])}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-white px-2.5 h-7 rounded-md border border-white/10 hover:bg-white/10 hover:border-white/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
            >
              <Eraser size={13} strokeWidth={2.25} />
              Clear
            </button>
          </div>
          <div ref={consoleRef} className="console-scroll flex-1 overflow-y-auto px-4 py-2 font-mono text-[12px] space-y-0.5">
            {logs.length === 0 && (
              <span className="text-slate-600">No entries yet.</span>
            )}
            {logs.map((entry, i) => (
              <div key={i} className="flex gap-3 leading-5">
                <span className="text-slate-500 shrink-0 tabular-nums">{entry.ts}</span>
                <span className={
                  entry.level === 'error' ? 'text-red-400 shrink-0' :
                  entry.level === 'warn'  ? 'text-amber-400 shrink-0' :
                  'text-sky-400 shrink-0'
                }>
                  {entry.level === 'error' ? '✖' : entry.level === 'warn' ? '⚠' : '›'}
                </span>
                <span className={`break-all ${entry.level === 'error' ? 'text-red-300' : 'text-slate-300'}`}>{entry.message}</span>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <footer className={`border-t ${C.divider} ${C.cardBg}`}>
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Logo className="w-5 h-5 rounded-md" />
            <span className="text-xs font-semibold text-slate-700">AEP Query Editor</span>
          </div>
          <p className={`text-[11px] ${C.mutedText}`}>Adobe Experience Platform · Query Service</p>
        </div>
      </footer>
    </div>
  )
}
