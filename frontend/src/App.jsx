import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import {
  SlidersHorizontal, Upload, ShieldCheck, Layers, Plug, Unplug, ChevronDown,
  SquareTerminal, Plus, X, Play, Square, Eraser, History, ListTree,
} from 'lucide-react'
import api, { SESSION_EXPIRED, getServerConfig, notifySessionExpired } from './api.js'
import QueryPane from './QueryPane.jsx'
import DatasetExplorer from './DatasetExplorer.jsx'
import Btn, { IconBtn } from './Button.jsx'
import { isRunShortcut, RUN_SHORTCUT, RUN_SHORTCUT_ARIA } from './sqlStatements.js'
import { useTheme } from './theme.js'
import ThemeToggle from './ThemeToggle.jsx'
import { SessionTimer, SessionWarning } from './Session.jsx'
import HistoryPanel from './HistoryPanel.jsx'
import { loadHistory, addHistory, removeHistory, clearHistory } from './queryHistory.js'
import ConnectionProfiles from './ConnectionProfiles.jsx'
import { loadProfiles, saveProfiles } from './profiles.js'
import { STORAGE_KEYS, loadJSON, saveJSON } from './storage.js'

// ─── helpers ─────────────────────────────────────────────────────────────────
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 23)

// ─── query tabs ──────────────────────────────────────────────────────────────
// Tabs (name, SQL, order) and the active tab are saved to localStorage and
// restored on reload. Only editor state comes back — nothing is re-run.
const MAX_PANES = 5
const MAX_TAB_NAME = 40

/** Saved tabs → { panes: [{ id, label, custom }], sql: { [id]: text }, active }, or null. */
function loadSavedTabs() {
  const saved = loadJSON(STORAGE_KEYS.tabs, null)
  if (!saved || !Array.isArray(saved.tabs)) return null
  const seen = new Set()
  const tabs = saved.tabs
    .filter(t => t && Number.isFinite(t.id) && typeof t.name === 'string' && !seen.has(t.id) && seen.add(t.id))
    .slice(0, MAX_PANES)
  if (!tabs.length) return null
  return {
    panes: tabs.map((t, i) => {
      const name = t.name.trim().slice(0, MAX_TAB_NAME)
      return { id: t.id, label: name || `Query ${i + 1}`, custom: !!t.custom && !!name }
    }),
    sql: Object.fromEntries(tabs.map(t => [t.id, typeof t.sql === 'string' ? t.sql : ''])),
    active: Math.min(Math.max(0, Number(saved.active) || 0), tabs.length - 1),
  }
}

// Parses a Postgres connect string into { host, port, dbName, user, password, sslmode }.
// Accepts the libpq key=value form — optionally wrapped as `psql "…"`, as AEP's
// "Credentials" panel copies it — or a postgres:// / postgresql:// URI.
// Only keys present in the string are returned. Throws on unparseable input.
function parseConnectString(raw) {
  let s = raw.trim().replace(/^psql\s+/i, '').trim()
  if (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0]) s = s.slice(1, -1).trim()
  if (!s) throw new Error('Connect string is empty.')

  if (/^postgres(ql)?:\/\//i.test(s)) {
    let u
    try { u = new URL(s) } catch { throw new Error('Invalid postgres:// URI.') }
    const out = {}
    if (u.hostname) out.host = decodeURIComponent(u.hostname)
    if (u.port) out.port = u.port
    const db = decodeURIComponent(u.pathname.replace(/^\//, ''))
    if (db) out.dbName = db
    if (u.username) out.user = decodeURIComponent(u.username)
    if (u.password) out.password = decodeURIComponent(u.password)
    for (const [k, v] of u.searchParams) {
      if (k === 'host') out.host = v
      else if (k === 'port') out.port = v
      else if (k === 'dbname') out.dbName = v
      else if (k === 'user') out.user = v
      else if (k === 'password') out.password = v
      else if (k === 'sslmode') out.sslmode = v
    }
    return out
  }

  // libpq key=value pairs; values may be single-quoted with \' and \\ escapes.
  const kv = {}
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    const keyStart = i
    while (i < s.length && s[i] !== '=' && !/\s/.test(s[i])) i++
    const key = s.slice(keyStart, i).toLowerCase()
    while (i < s.length && /\s/.test(s[i])) i++
    if (!key || s[i] !== '=') throw new Error(`Expected "=" after "${key || s.slice(keyStart, keyStart + 10)}".`)
    i++
    while (i < s.length && /\s/.test(s[i])) i++
    let val = ''
    if (s[i] === "'") {
      i++
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) i++
        val += s[i++]
      }
      if (s[i] !== "'") throw new Error(`Unterminated quoted value for "${key}".`)
      i++
    } else {
      while (i < s.length && !/\s/.test(s[i])) {
        if (s[i] === '\\' && i + 1 < s.length) i++
        val += s[i++]
      }
    }
    kv[key] = val
  }
  const out = {}
  if (kv.host ?? kv.hostaddr) out.host = kv.host ?? kv.hostaddr
  if (kv.port) out.port = kv.port
  if (kv.dbname) out.dbName = kv.dbname
  if (kv.user) out.user = kv.user
  if (kv.password) out.password = kv.password
  if (kv.sslmode) out.sslmode = kv.sslmode
  if (!Object.keys(out).length) throw new Error('No host, port, dbname, user or password found.')
  return out
}

// ─── design tokens (single source of truth) ──────────────────────────────────
// Palette: derived from the project logo (public/favicon.svg) —
// deep navy brand (#0F172A → #1E3A8A), sky accent (#0EA5E9), slate neutrals.
const C = {
  pageBg:       'bg-[var(--page-bg)]',
  cardBg:       'bg-surface',
  cardBorder:   'border-slate-200',
  inputBg:      'bg-surface',
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
  tabActiveBg:  'bg-surface',
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

const labelCls = `block text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${C.labelText}`

function Label({ children }) {
  return <label className={labelCls}>{children}</label>
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
    <span title={label} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-2.5 sm:px-3 py-1 text-xs font-medium text-white backdrop-blur-sm whitespace-nowrap">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {/* dot only on phones, where the header also holds the theme switch and session timer */}
      <span className="sr-only sm:not-sr-only">{label}</span>
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
  const [directPort, setDirectPort]       = useState('')
  // Port used when the field is left blank — owned by the backend (GET /api/config)
  // so a blank port means the same thing in the UI and on the server.
  const [defaultPort, setDefaultPort]     = useState('')
  const shownPort = directPort.trim() || defaultPort
  const [directDb, setDirectDb]           = useState('')
  const [directUser, setDirectUser]       = useState('')
  const [directPwd, setDirectPwd]         = useState('')
  // Pasted connect string; cleared after a successful parse since it holds the password.
  const [connectString, setConnectString] = useState('')

  const [connStatus, setConnStatus]       = useState('idle')
  // Configuration card can only be collapsed while connected; it auto-collapses
  // on a successful connect and is always expanded when not connected.
  const [configCollapsed, setConfigCollapsed] = useState(false)
  const configOpen = connStatus !== 'connected' || !configCollapsed

  // ── theme ────────────────────────────────────────────────────────────────
  const [themePref, setThemePref, resolvedTheme] = useTheme()
  const dark = resolvedTheme === 'dark'

  // ── multi-pane state (restored from localStorage) ────────────────────────
  const [savedTabs]                       = useState(loadSavedTabs)
  const [panes, setPanes]                 = useState(() => savedTabs?.panes ?? [{ id: Date.now() + 1, label: 'Query 1', custom: false }])
  const [activePane, setActivePane]       = useState(savedTabs?.active ?? 0) // index into panes[]
  const paneRefs                          = useRef({})  // keyed by pane.id
  const paneSql                           = useRef(savedTabs?.sql ?? {}) // pane.id → editor text, for persistence
  const [runningPanes, setRunningPanes]   = useState({}) // pane.id → 'running' | 'cancelling' while its query runs
  const tabBarRef                         = useRef(null)
  const [renaming, setRenaming]           = useState(null) // id of the tab whose name is being edited
  const renameCancelled                   = useRef(false)

  // ── query history / session warning / profiles ───────────────────────────
  const [historyAnchor, setHistoryAnchor] = useState(null) // History button while the panel is open
  const [historyCache, setHistoryCache]   = useState({ target: null, list: [] }) // stored history of one target
  const [sessionWarning, setSessionWarning] = useState(false)
  const renewingRef                       = useRef(false)   // next config upload renews the session
  const [profiles, setProfilesState]      = useState(loadProfiles)

  // Dataset Explorer collapse — only offered while connected (AEP mode)
  const [explorerCollapsed, setExplorerCollapsed] = useState(false)

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
    getServerConfig().then(cfg => { if (cfg?.defaultPort) setDefaultPort(String(cfg.defaultPort)) })
    const storedDirect = sessionStorage.getItem('direct_conn')
    if (storedDirect) {
      try {
        const d = JSON.parse(storedDirect)
        setDirectHost(d.host || '')
        setDirectPort(d.port || '')
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
  // A renewal (Renew session in the expiry warning) with a config for the same
  // org keeps the sandbox list and connection; only the session is replaced.
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    const renewing = renewingRef.current
    renewingRef.current = false
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
        const keep = renewing && session && res.data.IMS_ORG === session.IMS_ORG
        if (!keep) resetAepState()
        setSession(res.data)
        setOrg(res.data.IMS_ORG || '')
        setSessionWarning(false)
        addLog('info', keep
          ? `Session renewed — now expires ${new Date(res.data.expiresAt).toLocaleTimeString()}.`
          : `Config verified and secured in an encrypted session (expires ${new Date(res.data.expiresAt).toLocaleTimeString()}).`)
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
      setSessionWarning(false)
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

  // ── connect string ───────────────────────────────────────────────────────
  // Fills the Direct fields from a pasted connect string. The password is never logged.
  const handleParseConnectString = () => {
    let parsed
    try {
      parsed = parseConnectString(connectString)
    } catch (err) {
      addLog('error', `Connect string: ${err.message}`)
      return
    }
    if (parsed.host)     setDirectHost(parsed.host)
    if (parsed.port)     setDirectPort(parsed.port)
    if (parsed.dbName)   setDirectDb(parsed.dbName)
    if (parsed.user)     setDirectUser(parsed.user)
    if (parsed.password) setDirectPwd(parsed.password)
    setConnectString('')
    const filled = ['host', 'port', 'dbName', 'user', 'password'].filter(k => parsed[k])
    addLog('info', `Connect string parsed — filled ${filled.join(', ')}.`)
    if (parsed.sslmode && parsed.sslmode !== 'require') {
      addLog('warn', `sslmode=${parsed.sslmode} ignored — connections always use SSL.`)
    }
  }

  // ── connect ──────────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true)
    setConnStatus('connecting')

    if (connMode === 'direct') {
      addLog('info', `Connecting directly to ${directHost}:${shownPort}/${directDb}…`)
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
    cancelAllQueries()
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
  const explorerIsCollapsed = explorerCollapsed && !!explorerCreds

  // ── session expiry countdown ─────────────────────────────────────────────
  // The countdown reached zero: reset now rather than let the next query fail
  // on the expired cookie (the SESSION_EXPIRED handler above does the reset).
  const handleSessionLapsed = useCallback(() => notifySessionExpired(), [])
  const sessionLapsed = () => connMode === 'aep' && !!session && session.expiresAt <= Date.now()

  // Renew from the expiry warning: re-upload the config (see handleFileUpload)
  const handleRenewSession = () => {
    renewingRef.current = true
    fileInputRef.current?.click()
  }

  // ── execute query (delegates to active pane ref) ─────────────────────────
  // endpoint + payload for the current connection
  const queryTarget = () => (connMode === 'direct'
    ? { endpoint: '/query/direct', payload: { host: directHost, port: directPort, dbName: directDb, user: directUser, password: directPwd } }
    : { endpoint: '/query', payload: { SANDBOX_NAME: selectedSandbox } })

  // the active pane's handle when it can start a request, else null (and says why)
  const readyPane = () => {
    if (connStatus !== 'connected') { addLog('error', 'Not connected. Please connect first.'); return null }
    if (sessionLapsed()) { handleSessionLapsed(); return null }
    const pane = panes[activePane]
    return (pane && paneRefs.current[pane.id]) || null
  }

  const handleExecute = () => {
    const paneRef = readyPane()
    // isExecuting() reads the pane's live ref — runningPanes state can lag a fast double Ctrl+Enter
    if (!paneRef || paneRef.isExecuting()) return // already running — no double execution
    const { endpoint, payload } = queryTarget()
    paneRef.execute(endpoint, payload)
  }

  // ── explain the active pane's query ──────────────────────────────────────
  const handleExplain = () => {
    const paneRef = readyPane()
    if (!paneRef || paneRef.isExecuting() || paneRef.isExplaining()) return
    const { endpoint, payload } = queryTarget()
    paneRef.explain(endpoint, payload)
  }

  // ── query history (per sandbox / Direct host) ────────────────────────────
  const historyTarget = connMode === 'aep'
    ? (session?.IMS_ORG && selectedSandbox ? `aep:${session.IMS_ORG}:${selectedSandbox}` : '')
    : (directHost.trim() ? `direct:${directHost.trim().toLowerCase()}:${shownPort}/${directDb.trim()}` : '')
  const historyLabel = connMode === 'aep'
    ? (selectedSandbox ? `Sandbox ${selectedSandbox}` : '')
    : (directHost.trim() ? `${directHost.trim()}${directDb.trim() ? `/${directDb.trim()}` : ''}` : '')
  // read from storage only when the target changes (state adjusted during render)
  let history = historyCache.list
  if (historyCache.target !== historyTarget) {
    history = loadHistory(historyTarget)
    setHistoryCache({ target: historyTarget, list: history })
  }

  // the target is captured when the run starts (QueryPane keeps that render's callback)
  const recordHistory = (entry) => {
    if (!historyTarget) return
    setHistoryCache({ target: historyTarget, list: addHistory(historyTarget, entry) })
  }

  const handleHistorySelect = (entry) => {
    const pane = panes[activePane]
    paneRefs.current[pane?.id]?.loadQuery(entry.query)
    setHistoryAnchor(null)
    addLog('info', `Loaded a query from history into "${pane?.label}" — it has not been run.`)
  }

  // ── saved Direct Connection profiles ─────────────────────────────────────
  const setProfiles = (list) => {
    setProfilesState(list)
    if (!saveProfiles(list)) addLog('warn', 'Could not save profiles — browser storage is unavailable or full.')
  }

  const applyProfile = (p) => {
    setDirectHost(p.host)
    setDirectPort(p.port)
    setDirectDb(p.dbName)
    if (p.user !== directUser) setDirectPwd('') // a password typed for another user doesn't carry over
    setDirectUser(p.user)
  }

  // ── cancel the active pane's running query ───────────────────────────────
  const handleCancel = () => {
    const pane = panes[activePane]
    const paneRef = pane && paneRefs.current[pane.id]
    if (paneRef?.isExecuting()) paneRef.cancel()
  }

  const cancelAllQueries = () => {
    Object.values(paneRefs.current).forEach(r => r?.cancel())
  }

  // Ctrl+Enter outside the editor (the editor handles it itself and marks the
  // event handled). Text inputs keep their own Enter behaviour.
  const executeRef = useRef(handleExecute)
  useLayoutEffect(() => { executeRef.current = handleExecute })
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.repeat || !isRunShortcut(e)) return
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      executeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep the active tab visible when the strip scrolls (narrow screens, 5 tabs).
  // Adjusts only the strip's scrollLeft, never the page scroll.
  useEffect(() => {
    const bar = tabBarRef.current
    const tab = bar?.querySelector('[aria-selected="true"]')
    if (!tab) return
    const left = tab.offsetLeft - bar.offsetLeft
    if (left < bar.scrollLeft) bar.scrollLeft = left - 4
    else if (left + tab.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = left + tab.offsetWidth - bar.clientWidth + 4
  }, [activePane, panes.length])

  const activePaneId  = panes[activePane]?.id
  const activeRunning    = !!runningPanes[activePaneId]
  const activeCancelling = runningPanes[activePaneId] === 'cancelling'

  // ── tab persistence ──────────────────────────────────────────────────────
  // Saved on every tab change, shortly after typing stops, and when the page
  // is hidden or closed. Only names, SQL, order and the active tab are kept.
  const tabsRef = useRef({ panes, activePane })
  useLayoutEffect(() => { tabsRef.current = { panes, activePane } })
  const persistTimer = useRef(0)
  const persistTabs = useCallback(() => {
    clearTimeout(persistTimer.current)
    const { panes: ps, activePane: active } = tabsRef.current
    saveJSON(STORAGE_KEYS.tabs, {
      tabs: ps.map(p => ({ id: p.id, name: p.label, custom: !!p.custom, sql: paneSql.current[p.id] ?? '' })),
      active,
    })
  }, [])
  useEffect(() => { persistTabs() }, [panes, activePane, persistTabs])
  useEffect(() => {
    window.addEventListener('pagehide', persistTabs)
    return () => window.removeEventListener('pagehide', persistTabs)
  }, [persistTabs])

  const handlePaneQueryChange = (id, text) => {
    paneSql.current[id] = text
    clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(persistTabs, 400)
  }

  // ── pane management ──────────────────────────────────────────────────────
  const handleAddPane = () => {
    if (panes.length >= MAX_PANES) return
    const newPane = { id: Date.now(), label: `Query ${panes.length + 1}`, custom: false }
    const newPanes = [...panes, newPane]
    setPanes(newPanes)
    setActivePane(newPanes.length - 1)
  }

  const handleClosePane = (idx) => {
    if (panes.length === 1) return // always keep at least one
    const pane = panes[idx]
    delete paneRefs.current[pane.id]
    delete paneSql.current[pane.id]
    setRunningPanes(prev => { const next = { ...prev }; delete next[pane.id]; return next })
    const newPanes = panes.filter((_, i) => i !== idx)
    // relabel default names to keep them tidy; renamed tabs keep their names
    const relabeled = newPanes.map((p, i) => (p.custom ? p : { ...p, label: `Query ${i + 1}` }))
    setPanes(relabeled)
    setActivePane(Math.min(idx, relabeled.length - 1))
  }

  // Rename: double-click a tab (or F2). An empty name restores the default.
  const startRename = (id) => {
    renameCancelled.current = false
    setRenaming(id)
  }

  const commitRename = (id, value) => {
    setRenaming(null)
    if (renameCancelled.current) return
    const name = value.trim().slice(0, MAX_TAB_NAME)
    setPanes(ps => ps.map((p, i) => {
      if (p.id !== id) return p
      return name ? { ...p, label: name, custom: true } : { ...p, label: `Query ${i + 1}`, custom: false }
    }))
  }

  const onTabKeyDown = (e, idx) => {
    if (e.target !== e.currentTarget) return // keys typed in the rename field
    if (e.key === 'F2') { e.preventDefault(); startRename(panes[idx].id) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActivePane(idx) }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + panes.length) % panes.length
      setActivePane(next)
      e.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus()
    }
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${C.pageBg} flex flex-col text-slate-700 antialiased`}>

      {/* config file picker — outside the collapsible card so "Renew session" can open it while collapsed */}
      <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {/* ── HEADER (sticky — stays visible while page content scrolls) ── */}
      {/* theme-fixed: the brand header looks the same in light and dark themes */}
      <header className={`theme-fixed sticky top-0 z-40 ${C.brandGradient} border-b border-white/10 shadow-lg shadow-slate-900/10`}>
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Logo className="w-9 h-9 rounded-[10px] ring-1 ring-white/20 shadow-md" />
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-white leading-tight tracking-tight truncate">AEP Query Editor</h1>
              <p className="hidden sm:block text-[11px] text-sky-200/70 truncate">Adobe Experience Platform · Query Service</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* only while connected — the credential session outlives a disconnect, but the clock is
                about the working connection; an expiry while disconnected is caught on the next API call */}
            {connMode === 'aep' && session && connStatus === 'connected' && (
              <SessionTimer
                key={session.expiresAt}
                expiresAt={session.expiresAt}
                onWarn={() => setSessionWarning(true)}
                onExpire={handleSessionLapsed}
              />
            )}
            <ThemeToggle value={themePref} onChange={setThemePref} />
            <StatusPill status={connStatus} />
          </div>
        </div>
      </header>

      {sessionWarning && connMode === 'aep' && session && connStatus === 'connected' && (
        <SessionWarning
          expiresAt={session.expiresAt}
          onRenew={handleRenewSession}
          onDismiss={() => setSessionWarning(false)}
        />
      )}

      <main className="flex flex-col gap-5 px-3 sm:px-6 py-5 sm:py-6 flex-1 max-w-screen-2xl w-full mx-auto">

        {/* ── CONFIGURATION CARD ── */}
        <section className={`${C.cardBg} rounded-2xl border ${C.cardBorder} shadow-sm p-4 sm:p-6`}>

          {/* Card header + mode toggle / collapsed summary */}
          <CardTitle
            title="Configuration"
            className={configOpen ? 'mb-5' : 'mb-0'}
            subtitle={
              connStatus === 'connected'
                ? `Connected · ${connMode === 'direct' ? `${directHost}:${shownPort}/${directDb}` : `${selectedSandbox}${tenant ? ` · ${tenant}` : ''}`}`
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
                          ? 'bg-surface text-blue-700 shadow-sm ring-1 ring-slate-200'
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
                  <Btn variant="secondary" icon={Upload} onClick={() => { renewingRef.current = false; fileInputRef.current?.click() }} loading={uploading} className="w-full">
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
            <>
            {connStatus !== 'connected' && (
              <>
                <ConnectionProfiles
                  profiles={profiles}
                  onChange={setProfiles}
                  fields={{ host: directHost, port: directPort, dbName: directDb, user: directUser }}
                  onApply={applyProfile}
                  addLog={addLog}
                  inputClassName={inputCls}
                  labelClassName={labelCls}
                />
                <div className={`border-t ${C.divider} my-4`} />
                <div className="grid grid-cols-12 gap-x-4 gap-y-3 items-end">
                  <div className="col-span-12 md:col-span-9 lg:col-span-10">
                    <Label>Connect String (optional)</Label>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={connectString}
                      onChange={e => setConnectString(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && connectString.trim()) handleParseConnectString() }}
                      placeholder='Paste psql "sslmode=require host=… port=… dbname=… user=… password=…" or postgresql://…'
                      className={`${inputCls} font-mono`}
                    />
                  </div>
                  <div className="col-span-12 md:col-span-3 lg:col-span-2">
                    <Btn variant="secondary" icon={SlidersHorizontal} onClick={handleParseConnectString} disabled={!connectString.trim()} className="w-full">
                      Fill Fields
                    </Btn>
                  </div>
                </div>
                <div className={`border-t ${C.divider} my-4`} />
              </>
            )}
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
                  placeholder={defaultPort}
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
            </>
          )}
          </div>
          </div>
        </section>

        {/* ── EXPLORER + WORKSPACE ── */}
        {/* Dataset Explorer relies on AEP APIs, so it is hidden in Direct mode */}
        {/* Collapsing the explorer animates its column down to a slim rail (see .workbench-grid) */}
        <div className={`grid grid-cols-1 ${connMode === 'aep' ? `workbench-grid ${explorerIsCollapsed ? 'workbench-grid--rail' : 'workbench-grid--explorer'}` : ''} gap-5 flex-1 items-stretch`}>

        {connMode === 'aep' && (
          <DatasetExplorer
            credentials={explorerCreds}
            addLog={addLog}
            collapsed={explorerIsCollapsed}
            onToggleCollapsed={explorerCreds ? () => setExplorerCollapsed(c => !c) : undefined}
          />
        )}

        {/* ── PANE AREA (workspace card) — fills the viewport height on large screens ── */}
        <section className={`${C.cardBg} rounded-2xl border ${C.cardBorder} shadow-sm flex flex-col flex-1 min-w-0 lg:min-h-[calc(100vh-7rem)]`}>

          {/* Toolbar: Query 1 … Query 5 / [+] / [Run] [Cancel] */}
          <div className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b ${C.divider} bg-slate-50/70 rounded-t-2xl`}>
            <div ref={tabBarRef} role="tablist" aria-label="Query tabs" className="flex items-center gap-1 min-w-0 overflow-x-auto">
              {panes.map((pane, idx) => (
                <div
                  key={pane.id}
                  role="tab"
                  aria-selected={activePane === idx}
                  tabIndex={activePane === idx ? 0 : -1}
                  onClick={() => setActivePane(idx)}
                  onDoubleClick={() => startRename(pane.id)}
                  onKeyDown={e => onTabKeyDown(e, idx)}
                  title={renaming === pane.id ? undefined : `${pane.label} — double-click or F2 to rename`}
                  className={`group flex items-center gap-2 pl-3 ${panes.length > 1 ? 'pr-2' : 'pr-3'} py-1.5 text-sm font-medium rounded-lg border cursor-pointer transition-all select-none whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                    activePane === idx
                      ? `bg-surface border-slate-200 ${C.tabActiveText} shadow-sm`
                      : `bg-transparent border-transparent ${C.tabInactiveText} hover:text-slate-900 hover:bg-surface/70`
                  }`}
                >
                  <SquareTerminal size={15} strokeWidth={2} className={`shrink-0 hidden sm:block ${activePane === idx ? 'text-blue-600' : 'text-slate-400'}`} />
                  {renaming === pane.id ? (
                    <input
                      autoFocus
                      defaultValue={pane.label}
                      maxLength={MAX_TAB_NAME}
                      aria-label="Tab name"
                      onFocus={e => e.target.select()}
                      onClick={e => e.stopPropagation()}
                      onDoubleClick={e => e.stopPropagation()}
                      onBlur={e => commitRename(pane.id, e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        else if (e.key === 'Escape') { renameCancelled.current = true; e.currentTarget.blur() }
                      }}
                      className="w-32 rounded border border-blue-400 bg-surface px-1.5 py-0 text-sm font-medium text-slate-900 outline-none ring-2 ring-blue-500/20"
                    />
                  ) : (
                    <span className="max-w-[12rem] truncate">{pane.label}</span>
                  )}
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

            {/* History / Explain / Run / Cancel — right-aligned, compact icon controls */}
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <IconBtn
                icon={History}
                label="Query history"
                onClick={e => { const anchor = e.currentTarget; setHistoryAnchor(a => (a ? null : anchor)) }}
                align="end"
              />
              <IconBtn
                icon={ListTree}
                label="Explain — show the plan for the selection, or the statement under the cursor"
                onClick={handleExplain}
                disabled={connStatus !== 'connected' || activeRunning}
                align="end"
              />
              {activeRunning && (
                <IconBtn
                  variant="stop"
                  icon={Square}
                  iconClassName="fill-current"
                  label={activeCancelling ? 'Cancelling…' : 'Cancel query'}
                  loading={activeCancelling}
                  onClick={handleCancel}
                  align="end"
                />
              )}
              <IconBtn
                variant="success"
                icon={Play}
                iconClassName="fill-current"
                label={activeRunning ? 'Query running…' : 'Run query — the selection, or the statement under the cursor'}
                shortcut={RUN_SHORTCUT}
                keyShortcuts={RUN_SHORTCUT_ARIA}
                onClick={handleExecute}
                disabled={connStatus !== 'connected'}
                loading={activeRunning}
                align="end"
              />
            </div>
          </div>

          {/* Render all panes but only show the active one (keeps state alive) */}
          {panes.map((pane, idx) => (
            <div key={pane.id} className={idx === activePane ? 'flex flex-col flex-1 min-w-0' : 'hidden'}>
              <QueryPane
                ref={el => { paneRefs.current[pane.id] = el }}
                addLog={addLog}
                onRun={handleExecute}
                onExecutingChange={running => setRunningPanes(prev => ({ ...prev, [pane.id]: running }))}
                initialQuery={savedTabs?.sql[pane.id] ?? ''}
                onQueryChange={text => handlePaneQueryChange(pane.id, text)}
                onRunComplete={recordHistory}
                dark={dark}
              />
            </div>
          ))}
        </section>

        {historyAnchor && (
          <HistoryPanel
            anchor={historyAnchor}
            entries={history}
            targetLabel={historyLabel}
            onSelect={handleHistorySelect}
            onRemove={id => setHistoryCache({ target: historyTarget, list: removeHistory(historyTarget, id) })}
            onClear={() => {
              setHistoryCache({ target: historyTarget, list: clearHistory(historyTarget) })
              addLog('info', `Query history cleared for ${historyLabel}.`)
            }}
            onClose={() => setHistoryAnchor(null)}
          />
        )}

        </div>

        {/* ── CONSOLE LOG ── */}
        <section className={`theme-fixed ${C.consoleBg} rounded-2xl border ${C.consoleBorder} shadow-sm flex flex-col overflow-hidden`} style={{ height: '200px' }}>
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
