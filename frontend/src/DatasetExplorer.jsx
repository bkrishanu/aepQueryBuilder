import { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue, useLayoutEffect } from 'react'
import api, { isSessionError, notifySessionExpired } from './api.js'
import {
  ChevronRight, Search, X, RefreshCw, Copy, Check, LoaderCircle, Database, UserCheck,
  Table2, Type, Hash, Calculator, ToggleLeft, Calendar, Clock, Folder, List, Layers, File,
  TriangleAlert, FolderTree, Camera, GitMerge,
} from 'lucide-react'


// ─── layout constants ─────────────────────────────────────────────────────────
// The tree is virtualized: only the rows inside the viewport (+ OVERSCAN) are
// mounted, so thousands of datasets / fields stay cheap to render and scroll.
const ROW_H    = 30
const OVERSCAN = 12
const INDENT   = 14
const PAD_TOP  = 4

const GROUPS = [
  { key: 'g:profile',    label: 'Profile Enabled',     profile: true,  icon: UserCheck },
  { key: 'g:nonprofile', label: 'Non Profile Enabled', profile: false, icon: Database  },
]
const SNAPSHOT_GROUP = { key: 'g:snapshots', label: 'Profile Snapshots', icon: Camera, snapshot: true }
const NO_POLICY = '__none__'          // snapshot datasets without a mergePolicyId tag

const isSnapshot = (d) => d.kind === 'snapshot'
const policyKey = (id) => `mp:${id}`

// Merge policy groups for the snapshot section: default policy first, then by name.
// A matching policy name keeps all its datasets; otherwise only matching datasets show.
function groupSnapshots(snapshots, policies, query) {
  const byPolicy = new Map()
  for (const d of snapshots) {
    const id = d.mergePolicyId || NO_POLICY
    if (!byPolicy.has(id)) byPolicy.set(id, [])
    byPolicy.get(id).push(d)
  }
  const out = []
  for (const [id, items] of byPolicy) {
    const p = policies[id]
    const name = id === NO_POLICY ? 'No merge policy' : p?.name || id
    const policyMatch = !query || name.toLowerCase().includes(query)
    const shown = policyMatch ? items : items.filter(d => d.name.toLowerCase().includes(query))
    if (!shown.length) continue
    out.push({
      id, name, items: shown, all: items.length,
      isDefault: !!p?.default, edge: !!p?.isActiveOnEdge,
      pending: id !== NO_POLICY && !p, error: p?.error || null,
    })
  }
  return out.sort((a, b) => (b.isDefault - a.isDefault) || a.name.localeCompare(b.name))
}

// ─── datatype → icon ──────────────────────────────────────────────────────────
const TYPE_ICONS = {
  string: Type,
  integer: Hash, int: Hash, long: Hash, short: Hash, byte: Hash,
  number: Calculator, double: Calculator, float: Calculator,
  boolean: ToggleLeft,
  date: Calendar,
  'date-time': Clock,
  object: Folder,
  array: List,
  map: Layers,
}
const TYPE_COLORS = {
  string: 'text-emerald-600', integer: 'text-violet-600', int: 'text-violet-600', long: 'text-violet-600',
  short: 'text-violet-600', byte: 'text-violet-600', number: 'text-fuchsia-600', double: 'text-fuchsia-600',
  float: 'text-fuchsia-600', boolean: 'text-orange-600', date: 'text-sky-600', 'date-time': 'text-sky-600',
  object: 'text-amber-500', array: 'text-blue-600', map: 'text-teal-600',
}

const arrayDims = (f) => f.type === 'array' ? (f.arrayDims || 1) : 0
const typeLabel = (f) => {
  const dims = arrayDims(f)
  return dims && f.itemType ? `${'array<'.repeat(dims)}${f.itemType}${'>'.repeat(dims)}` : f.type
}
// Copied path segment: arrays always address their first element, once per
// nesting level — emails → emails[0], matrix (array of arrays) → matrix[0][0].
const copySegment = (f) => f.name + '[0]'.repeat(arrayDims(f))

const fmtCount = (n) => typeof n === 'number' ? n.toLocaleString('en-US') : '—'

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fallback for insecure contexts / denied clipboard permission
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

function Highlight({ text, query }) {
  if (!query) return text
  const i = text.toLowerCase().indexOf(query)
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-amber-200/70 text-inherit rounded-sm">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  )
}

// ─── DatasetExplorer ─────────────────────────────────────────────────────────
// Props:
//   credentials: { IMS_ORG, SANDBOX_NAME } | null — the secrets themselves stay in
//                the server's HttpOnly session cookie (null hides the tree)
//   addLog:      console logger from App
//
// State is kept per org+sandbox in `store`, so datasets, schemas and scroll
// position survive refreshes, disconnect/reconnect and sandbox switching.
// Expanded nodes and the search text are global and never reset.
export default function DatasetExplorer({ credentials, addLog }) {
  const credKey = credentials ? `${credentials.IMS_ORG}|${credentials.SANDBOX_NAME}` : ''

  // credKey → { creds, datasets, schemas, scrollTop }
  const store    = useRef(new Map())
  const keyRef   = useRef(credKey)
  const inflight = useRef(new Set())                        // `${credKey}|${schemaId}` (de-dupe)
  const entry = useCallback((key) => {
    let e = store.current.get(key)
    if (!e) { e = { creds: null, datasets: [], schemas: {}, mergePolicies: {}, scrollTop: 0 }; store.current.set(key, e) }
    return e
  }, [])

  // mirrors of the current key's store entry
  const [datasets, setDatasets]   = useState([])
  const [schemas, setSchemas]     = useState({})            // schemaId → { status, fields?, error?, stale? }
  const [mergePolicies, setMergePolicies] = useState({})    // id → { name, default, isActiveOnEdge } | { error }
  const [loadState, setLoadState] = useState('idle')        // idle | loading | done | error
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  const [expanded, setExpanded]   = useState(() => new Set([...GROUPS.map(g => g.key), SNAPSHOT_GROUP.key]))
  const expandedRef               = useRef(expanded)
  const [justOpened, setJustOpened] = useState(null)        // key whose children animate in
  const [activeKey, setActiveKey] = useState(null)          // keyboard cursor
  const [treeFocused, setTreeFocused] = useState(false)

  const [query, setQuery]         = useState('')
  const deferredQuery             = useDeferredValue(query.trim().toLowerCase())

  const [toast, setToast]         = useState(null)
  const toastTimer                = useRef(null)

  // Writes go to the store first; the React state mirrors only the active key,
  // so a late response from a previous sandbox never leaks into the current one.
  const commitDatasets = useCallback((key, list) => {
    entry(key).datasets = list
    if (key === keyRef.current) setDatasets(list)
  }, [entry])
  const commitSchemas = useCallback((key, fn) => {
    const e = entry(key)
    e.schemas = fn(e.schemas)
    if (key === keyRef.current) setSchemas(e.schemas)
  }, [entry])
  const commitMergePolicies = useCallback((key, policies) => {
    const e = entry(key)
    e.mergePolicies = { ...e.mergePolicies, ...policies }
    if (key === keyRef.current) setMergePolicies(e.mergePolicies)
  }, [entry])

  useEffect(() => {
    if (credKey) entry(credKey).creds = credentials
  }, [credentials, credKey, entry])
  useEffect(() => { expandedRef.current = expanded }, [expanded])

  // ── switch to the current key's cached state ─────────────────────────────
  const pendingScroll = useRef(null)
  useEffect(() => {
    keyRef.current = credKey
    const e = credKey ? entry(credKey) : null
    setDatasets(e?.datasets || [])
    setSchemas(e?.schemas || {})
    setMergePolicies(e?.mergePolicies || {})
    pendingScroll.current = e ? e.scrollTop : null
  }, [credKey, entry])

  // ── schema loading (lazy, cached, de-duplicated) ─────────────────────────
  // A cached schema marked stale (after a refresh) keeps rendering while it is
  // re-fetched in the background.
  const loadSchema = useCallback((key, schemaId) => {
    if (!key || !schemaId) return
    const id = `${key}|${schemaId}`
    if (inflight.current.has(id)) return
    const cur = entry(key).schemas[schemaId]
    if (cur?.status === 'ready' && !cur.stale) return
    const background = cur?.status === 'ready'
    inflight.current.add(id)
    if (!background) commitSchemas(key, s => ({ ...s, [schemaId]: { status: 'loading' } }))
    api.post('/schema', { ...entry(key).creds, schemaId })
      .then(res => {
        commitSchemas(key, s => ({ ...s, [schemaId]: { status: 'ready', fields: res.data.fields } }))
      })
      .catch(err => {
        const msg = err.response?.data?.error || err.message
        if (background) {
          // keep showing the cached fields rather than replacing them with an error
          commitSchemas(key, s => ({ ...s, [schemaId]: { ...s[schemaId], stale: false } }))
          addLog('warn', `Schema refresh failed, showing cached fields: ${msg}`)
        } else {
          commitSchemas(key, s => ({ ...s, [schemaId]: { status: 'error', error: msg } }))
          addLog('error', `Schema load failed: ${msg}`)
        }
      })
      .finally(() => inflight.current.delete(id))
  }, [entry, commitSchemas, addLog])

  // ── dataset loading (streamed, progressive) ──────────────────────────────
  // Previously loaded datasets stay visible during a reload; each page merges
  // over them, and the final list replaces them once the stream completes.
  useEffect(() => {
    if (!credKey) { setLoadState('idle'); return }
    const key = credKey
    const e = entry(key)
    const previous = e.datasets
    const ctrl = new AbortController()
    const byId = new Map()

    setLoadState('loading')
    setLoadError('')
    addLog('info', `Dataset explorer: loading datasets for sandbox "${e.creds.SANDBOX_NAME}"…`)

    // cached schemas go stale; refresh the ones currently on screen right away
    commitSchemas(key, s => Object.fromEntries(
      Object.entries(s)
        .filter(([, v]) => v.status === 'ready')
        .map(([id, v]) => [id, { ...v, stale: true }])
    ))
    for (const d of previous) {
      if (!isSnapshot(d) && expandedRef.current.has(`d:${d.id}`)) loadSchema(key, d.schemaId)
    }
    // merge policies are cached per sandbox: the server skips ids already resolved
    const knownMergePolicyIds = Object.keys(e.mergePolicies).filter(id => !e.mergePolicies[id].error)

    ;(async () => {
      try {
        const res = await fetch('/api/datasets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...e.creds, knownMergePolicyIds }),
          signal: ctrl.signal,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          if (isSessionError(res.status, body)) notifySessionExpired()
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let finished = false
        const handle = (line) => {
          if (!line.trim()) return
          const msg = JSON.parse(line)
          if (msg.type === 'page') {
            let added = false
            for (const d of msg.datasets) {
              if (!byId.has(d.id)) { byId.set(d.id, d); added = true }
            }
            if (added) commitDatasets(key, [...byId.values(), ...previous.filter(d => !byId.has(d.id))])
          } else if (msg.type === 'mergePolicies') {
            commitMergePolicies(key, msg.policies)
            const failed = Object.values(msg.policies).filter(p => p.error)
            if (failed.length) addLog('warn', `Dataset explorer: ${failed.length} merge policy lookup(s) failed — ${failed[0].error}`)
          } else if (msg.type === 'done') {
            finished = true
            commitDatasets(key, Array.from(byId.values()))
            setLoadState('done')
            addLog('info', `Dataset explorer: ${byId.size} customer dataset(s) loaded (${msg.scanned} scanned).`)
          } else if (msg.type === 'error') {
            throw new Error(msg.error)
          }
        }
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let nl
          while ((nl = buf.indexOf('\n')) >= 0) {
            handle(buf.slice(0, nl))
            buf = buf.slice(nl + 1)
          }
        }
        handle(buf)
        if (!finished) throw new Error('Dataset stream ended unexpectedly.')
      } catch (err) {
        if (ctrl.signal.aborted) return
        setLoadState('error')
        setLoadError(err.message)
        addLog('error', `Dataset explorer: ${err.message}`)
      }
    })()

    return () => ctrl.abort()
  }, [credKey, reloadTick, entry, commitDatasets, commitSchemas, commitMergePolicies, loadSchema, addLog])

  const retrySchema = (schemaId) => loadSchema(credKey, schemaId)

  // ── expand / collapse ────────────────────────────────────────────────────
  const toggle = useCallback((row) => {
    const opening = !expanded.has(row.key)
    setExpanded(prev => {
      const next = new Set(prev)
      if (opening) next.add(row.key)
      else next.delete(row.key)
      return next
    })
    if (opening) {
      setJustOpened(row.key)
      if (row.kind === 'dataset' && !isSnapshot(row.dataset)) loadSchema(credKey, row.dataset.schemaId)
    }
  }, [expanded, loadSchema, credKey])

  useEffect(() => {
    if (!justOpened) return
    const t = setTimeout(() => setJustOpened(null), 260)
    return () => clearTimeout(t)
  }, [justOpened])

  // merge policy nodes start expanded the first time they appear; after that
  // the user's expand/collapse choice is kept
  const seenPolicies = useRef(new Set())
  useEffect(() => {
    const fresh = []
    for (const d of datasets) {
      if (!isSnapshot(d)) continue
      const k = policyKey(d.mergePolicyId || NO_POLICY)
      if (!seenPolicies.current.has(k)) { seenPolicies.current.add(k); fresh.push(k) }
    }
    if (fresh.length) setExpanded(prev => new Set([...prev, ...fresh]))
  }, [datasets])

  // ── copy + toast ─────────────────────────────────────────────────────────
  const handleCopy = useCallback(async (text) => {
    const ok = await copyText(text)
    clearTimeout(toastTimer.current)
    setToast({ ok, text, id: Date.now() })
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // ── grouping + search ────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const standard = datasets.filter(d => !isSnapshot(d)).sort((a, b) => a.name.localeCompare(b.name))
    const match = deferredQuery ? (d) => d.name.toLowerCase().includes(deferredQuery) : () => true
    return GROUPS.map(g => ({
      ...g,
      all: standard.filter(d => d.profileEnabled === g.profile).length,
      items: standard.filter(d => d.profileEnabled === g.profile && match(d)),
    }))
  }, [datasets, deferredQuery])

  const snapshotGroup = useMemo(() => {
    const snapshots = datasets.filter(isSnapshot).sort((a, b) => a.name.localeCompare(b.name))
    const policies = groupSnapshots(snapshots, mergePolicies, deferredQuery)
    return {
      ...SNAPSHOT_GROUP,
      all: snapshots.length,
      matched: policies.reduce((n, p) => n + p.items.length, 0),
      policies,
    }
  }, [datasets, mergePolicies, deferredQuery])

  // ── flatten visible tree into rows ───────────────────────────────────────
  // Children are only walked for expanded nodes, so collapsed subtrees cost nothing.
  const rows = useMemo(() => {
    const out = []
    const pushFields = (fields, ds, parentPath, parentCopy, parentKey, depth) => {
      for (const f of fields) {
        const path = parentPath ? `${parentPath}.${f.name}` : f.name
        const seg = copySegment(f)
        const copyPath = parentCopy ? `${parentCopy}.${seg}` : seg
        const key = `f:${ds.id}:${path}`
        const hasChildren = !!f.children?.length
        out.push({ kind: 'field', key, parentKey, depth, field: f, copyPath, hasChildren })
        if (hasChildren && expanded.has(key)) pushFields(f.children, ds, path, copyPath, key, depth + 1)
      }
    }
    const emptyNote = (parentKey, depth) => ({
      kind: 'note', key: `${parentKey}:empty`, parentKey, depth,
      text: loadState === 'loading' ? 'Loading…' : deferredQuery ? 'No matching datasets' : 'No datasets',
    })
    // snapshot datasets stop at the dataset level — no schema, no children
    const pushDataset = (ds, parentKey, depth) => out.push({
      kind: 'dataset', key: `d:${ds.id}`, parentKey, depth, dataset: ds, hasChildren: !isSnapshot(ds),
    })

    for (const g of grouped) {
      out.push({ kind: 'group', key: g.key, depth: 0, group: g, hasChildren: true })
      if (!expanded.has(g.key)) continue
      if (g.items.length === 0) {
        out.push(emptyNote(g.key, 1))
        continue
      }
      for (const ds of g.items) {
        const dKey = `d:${ds.id}`
        pushDataset(ds, g.key, 1)
        if (!expanded.has(dKey)) continue
        if (!ds.schemaId) {
          out.push({ kind: 'note', key: `${dKey}:noschema`, parentKey: dKey, depth: 2, text: 'No schema reference' })
          continue
        }
        const s = schemas[ds.schemaId]
        if (!s || s.status === 'loading') {
          out.push({ kind: 'note', key: `${dKey}:loading`, parentKey: dKey, depth: 2, text: 'Loading schema…', loading: true })
        } else if (s.status === 'error') {
          out.push({ kind: 'note', key: `${dKey}:error`, parentKey: dKey, depth: 2, text: s.error, error: true, schemaId: ds.schemaId })
        } else if (s.fields.length === 0) {
          out.push({ kind: 'note', key: `${dKey}:nofields`, parentKey: dKey, depth: 2, text: 'No fields' })
        } else {
          pushFields(s.fields, ds, '', '', dKey, 2)
        }
      }
    }

    // Profile Snapshots → merge policy → snapshot dataset
    const sg = snapshotGroup
    out.push({ kind: 'group', key: sg.key, depth: 0, group: sg, hasChildren: true })
    if (expanded.has(sg.key)) {
      if (sg.policies.length === 0) out.push(emptyNote(sg.key, 1))
      for (const p of sg.policies) {
        const pKey = policyKey(p.id)
        out.push({ kind: 'policy', key: pKey, parentKey: sg.key, depth: 1, policy: p, hasChildren: true })
        if (expanded.has(pKey)) for (const ds of p.items) pushDataset(ds, pKey, 2)
      }
    }
    return out
  }, [grouped, snapshotGroup, expanded, schemas, loadState, deferredQuery])

  // ── virtualization ───────────────────────────────────────────────────────
  const total = datasets.length
  const showTree = !!credentials && !(loadState === 'error' && total === 0)

  const scrollRef = useRef(null)
  const roRef     = useRef(null)
  const rafRef    = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)             // quantized to whole rows
  const [viewH, setViewH] = useState(400)

  const setScrollEl = useCallback((el) => {
    roRef.current?.disconnect()
    scrollRef.current = el
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    roRef.current = ro
  }, [])
  useEffect(() => () => { roRef.current?.disconnect(); cancelAnimationFrame(rafRef.current) }, [])

  const syncScroll = useCallback(() => {
    const el = scrollRef.current
    if (el) setScrollTop(Math.floor(el.scrollTop / ROW_H) * ROW_H)
  }, [])

  const handleScroll = (e) => {
    if (keyRef.current) entry(keyRef.current).scrollTop = e.currentTarget.scrollTop
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; syncScroll() })
  }

  // restore the saved scroll position once enough rows exist to reach it
  useLayoutEffect(() => {
    const el = scrollRef.current
    const target = pendingScroll.current
    if (target == null || !el) return
    el.scrollTop = target
    if (el.scrollTop >= target - 1 || loadState !== 'loading') pendingScroll.current = null
    syncScroll()
  }, [rows.length, showTree, loadState, syncScroll])

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last  = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN)
  const visible = rows.slice(first, last)

  // ── keyboard navigation (roving cursor over the flattened rows) ──────────
  const activeIndex = useMemo(() => rows.findIndex(r => r.key === activeKey), [rows, activeKey])

  const moveTo = (i) => {
    if (!rows.length) return
    i = Math.max(0, Math.min(rows.length - 1, i))
    setActiveKey(rows[i].key)
    const el = scrollRef.current
    if (!el) return
    const top = i * ROW_H + PAD_TOP
    if (top < el.scrollTop) el.scrollTop = top - PAD_TOP
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight + PAD_TOP
  }

  const copyValue = (row) =>
    row.kind === 'dataset' ? row.dataset.name : row.kind === 'field' ? row.copyPath : null

  const handleTreeKey = (e) => {
    const i = activeIndex
    const row = rows[i]
    const page = Math.max(1, Math.floor(viewH / ROW_H) - 1)
    switch (e.key) {
      case 'ArrowDown': moveTo(i < 0 ? 0 : i + 1); break
      case 'ArrowUp':   moveTo(i < 0 ? 0 : i - 1); break
      case 'Home':      moveTo(0); break
      case 'End':       moveTo(rows.length - 1); break
      case 'PageDown':  moveTo(Math.max(i, 0) + page); break
      case 'PageUp':    moveTo(Math.max(i, 0) - page); break
      case 'ArrowRight':
        if (!row) moveTo(0)
        else if (row.hasChildren && !expanded.has(row.key)) toggle(row)
        else if (row.hasChildren) moveTo(i + 1)
        break
      case 'ArrowLeft':
        if (!row) moveTo(0)
        else if (row.hasChildren && expanded.has(row.key)) toggle(row)
        else if (row.parentKey) moveTo(rows.findIndex(r => r.key === row.parentKey))
        break
      case 'Enter':
      case ' ':
        if (row?.hasChildren) toggle(row)
        else if (row?.error) retrySchema(row.schemaId)
        break
      case 'c':
      case 'C': {
        if (e.altKey || ((e.ctrlKey || e.metaKey) && window.getSelection()?.toString())) return
        const v = row && copyValue(row)
        if (!v) return
        handleCopy(v)
        break
      }
      default: return
    }
    e.preventDefault()
  }

  const handleRowClick = (row) => {
    setActiveKey(row.key)
    if (row.hasChildren) toggle(row)
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <aside className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-w-0 h-[480px] lg:h-[calc(100vh-7rem)] lg:min-h-[420px] lg:sticky lg:top-[5.5rem] lg:self-start overflow-hidden">
      {/* header + search — fixed; only the tree below scrolls */}
      <div className="px-3.5 pt-3 pb-2.5 border-b border-slate-200 bg-slate-50/70 shrink-0">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <FolderTree size={15} strokeWidth={2.25} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900 leading-tight">Dataset Explorer</h2>
            <p className="text-[11px] text-slate-400 truncate">
              {!credentials ? 'Connect via AEP API to browse datasets'
                : loadState === 'loading' ? `Loading… ${total.toLocaleString('en-US')} found`
                : loadState === 'error' ? 'Failed to load datasets'
                : `${total.toLocaleString('en-US')} customer datasets`}
            </p>
          </div>
          {credentials && (
            <button
              type="button"
              onClick={() => setReloadTick(t => t + 1)}
              disabled={loadState === 'loading'}
              title="Refresh datasets"
              className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-200/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={14} strokeWidth={2.25} className={loadState === 'loading' ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              // ↓ from the search box jumps into the tree
              if (e.key === 'ArrowDown' && scrollRef.current) {
                e.preventDefault()
                scrollRef.current.focus()
                if (activeIndex < 0) moveTo(0)
              }
            }}
            placeholder="Search datasets…"
            disabled={!credentials}
            className="w-full h-8 rounded-lg border border-slate-300 bg-white pl-8 pr-7 text-[13px] text-slate-700 placeholder-slate-400 shadow-sm transition-colors focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:cursor-not-allowed"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              title="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* body */}
      {!credentials ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <Database size={28} strokeWidth={1.5} className="text-slate-300" />
          <p className="text-xs text-slate-400 leading-relaxed">
            The dataset explorer is available when connected in <span className="font-semibold text-slate-500">AEP API</span> mode.
          </p>
        </div>
      ) : !showTree ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <TriangleAlert size={26} strokeWidth={1.75} className="text-rose-400" />
          <p className="text-xs text-rose-600 break-words">{loadError}</p>
          <button
            type="button"
            onClick={() => setReloadTick(t => t + 1)}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <div
          ref={setScrollEl}
          onScroll={handleScroll}
          onKeyDown={handleTreeKey}
          onFocus={() => setTreeFocused(true)}
          onBlur={() => setTreeFocused(false)}
          tabIndex={0}
          role="tree"
          aria-label="Datasets"
          aria-activedescendant={activeIndex >= 0 ? `dx-row-${activeIndex}` : undefined}
          className="explorer-scroll flex-1 min-h-0 overflow-auto overscroll-contain relative focus:outline-none"
        >
          <div style={{ height: rows.length * ROW_H + PAD_TOP * 2, position: 'relative' }}>
            {visible.map((row, i) => {
              const index = first + i
              return (
                <TreeRow
                  key={row.key}
                  id={`dx-row-${index}`}
                  row={row}
                  top={index * ROW_H + PAD_TOP}
                  open={expanded.has(row.key)}
                  active={index === activeIndex}
                  treeFocused={treeFocused}
                  animate={justOpened != null && row.parentKey === justOpened}
                  query={deferredQuery}
                  onClick={handleRowClick}
                  onCopy={handleCopy}
                  onRetry={retrySchema}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* partial-load warning (some pages arrived before an error) */}
      {credentials && loadState === 'error' && total > 0 && (
        <div className="shrink-0 px-3 py-1.5 border-t border-rose-100 bg-rose-50 text-[11px] text-rose-600 truncate" title={loadError}>
          Partial load — {loadError}
        </div>
      )}

      {/* keyboard hint */}
      {showTree && (
        <div className="hidden sm:flex shrink-0 items-center gap-3 px-3.5 py-1.5 border-t border-slate-100 bg-slate-50/70 text-[10.5px] text-slate-400">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span><Kbd>←</Kbd><Kbd>→</Kbd> expand</span>
          <span><Kbd>C</Kbd> copy</span>
        </div>
      )}

      {/* copy toast */}
      {toast && (
        <div
          key={toast.id}
          role="status"
          className="toast-in fixed bottom-5 right-5 z-50 flex items-center gap-2 max-w-[min(420px,calc(100vw-2.5rem))] rounded-lg bg-slate-900 text-white text-xs font-medium px-3.5 py-2.5 shadow-xl shadow-slate-900/20 ring-1 ring-white/10"
        >
          {toast.ok
            ? <Check size={14} strokeWidth={2.5} className="text-emerald-400 shrink-0" />
            : <TriangleAlert size={14} strokeWidth={2.25} className="text-amber-400 shrink-0" />}
          <span className="shrink-0">{toast.ok ? 'Copied' : 'Copy failed'}</span>
          <code className="font-mono text-slate-300 truncate">{toast.text}</code>
        </div>
      )}
    </aside>
  )
}

function Badge({ className, children }) {
  return (
    <span className={`shrink-0 inline-flex items-center h-4 px-1.5 rounded border text-[9.5px] font-bold uppercase tracking-wider leading-none ${className}`}>
      {children}
    </span>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-4 h-4 px-1 mr-0.5 rounded border border-slate-200 bg-white font-sans text-[10px] text-slate-500">
      {children}
    </kbd>
  )
}

// ─── TreeRow ──────────────────────────────────────────────────────────────────
function TreeRow({ id, row, top, open, active, treeFocused, animate, query, onClick, onCopy, onRetry }) {
  const pad = 6 + row.depth * INDENT
  const style = { position: 'absolute', top, left: 0, right: 0, height: ROW_H, paddingLeft: pad }
  const activeCls = active ? (treeFocused ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : 'bg-slate-100') : ''
  const base = `group flex items-center gap-1.5 pr-2 text-[13px] select-none ${activeCls} ${animate ? 'tree-row-in' : ''}`

  if (row.kind === 'note') {
    return (
      <div id={id} style={{ ...style, paddingLeft: pad + 20 }} className={`${base} text-[12px] ${row.error ? 'text-rose-600' : 'text-slate-400'} italic`}>
        {row.loading && <LoaderCircle size={13} className="animate-spin shrink-0" />}
        {row.error && <TriangleAlert size={13} className="shrink-0 not-italic" />}
        <span className="truncate" title={row.text}>{row.text}</span>
        {row.error && (
          <button type="button" tabIndex={-1} onClick={() => onRetry(row.schemaId)} className="ml-auto shrink-0 not-italic font-semibold text-blue-600 hover:text-blue-700">
            Retry
          </button>
        )}
      </div>
    )
  }

  const chevron = row.hasChildren ? (
    <ChevronRight
      size={14}
      strokeWidth={2.25}
      className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
    />
  ) : <span className="w-3.5 shrink-0" />

  const hover = active ? '' : 'hover:bg-slate-100/80'
  const treeitem = {
    id, style, role: 'treeitem', 'aria-level': row.depth + 1,
    'aria-expanded': row.hasChildren ? open : undefined,
    onClick: () => onClick(row),
  }

  // copy buttons stay out of the tab order — the tree handles "C" instead
  const copyBtn = (text, title) => (
    <button
      type="button"
      tabIndex={-1}
      onClick={e => { e.stopPropagation(); onCopy(text) }}
      title={title}
      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
    >
      <Copy size={13} strokeWidth={2.25} />
    </button>
  )

  if (row.kind === 'group') {
    const g = row.group
    const Icon = g.icon
    return (
      <div {...treeitem} className={`${base} ${hover} cursor-pointer font-semibold text-slate-800`}>
        {chevron}
        <Icon size={14} strokeWidth={2.25} className={`shrink-0 ${g.profile ? 'text-emerald-600' : g.snapshot ? 'text-indigo-600' : 'text-slate-500'}`} />
        <span className="truncate text-[12px] uppercase tracking-wider">{g.label}</span>
        <span className="ml-auto shrink-0 text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-1.5 py-px tabular-nums">
          {query ? `${g.matched ?? g.items.length} / ${g.all}` : g.all}
        </span>
      </div>
    )
  }

  if (row.kind === 'policy') {
    const p = row.policy
    return (
      <div {...treeitem} className={`${base} ${hover} cursor-pointer text-slate-800`} title={p.id === NO_POLICY ? p.name : `${p.name}\nMerge policy ID: ${p.id}`}>
        {chevron}
        {p.pending
          ? <LoaderCircle size={14} strokeWidth={2.25} className="shrink-0 text-slate-400 animate-spin" />
          : p.error
            ? <span title={`Merge policy lookup failed: ${p.error}`} className="shrink-0 flex"><TriangleAlert size={14} strokeWidth={2.25} className="text-amber-500" /></span>
            : <GitMerge size={14} strokeWidth={2.25} className="shrink-0 text-indigo-600" />}
        <span className={`truncate font-medium ${p.pending ? 'text-slate-400 font-mono text-[12px]' : ''}`}>
          <Highlight text={p.name} query={query} />
        </span>
        {p.isDefault && <Badge className="bg-blue-50 text-blue-700 border-blue-200">Default</Badge>}
        {p.edge && <Badge className="bg-violet-50 text-violet-700 border-violet-200">Edge Active</Badge>}
        <span className="ml-auto shrink-0 pl-2 text-[10px] font-semibold text-slate-400 tabular-nums">
          {query && p.items.length !== p.all ? `${p.items.length} / ${p.all}` : p.all}
        </span>
      </div>
    )
  }

  if (row.kind === 'dataset') {
    const d = row.dataset
    const DsIcon = isSnapshot(d) ? Camera : Table2
    return (
      <div {...treeitem} className={`${base} ${hover} cursor-pointer text-slate-800`} title={d.name}>
        {chevron}
        <DsIcon size={14} strokeWidth={2} className={`shrink-0 ${isSnapshot(d) ? 'text-indigo-500' : 'text-blue-600'}`} />
        <span className="truncate font-mono text-[12.5px]"><Highlight text={d.name} query={query} /></span>
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-slate-400 tabular-nums" title={`${fmtCount(d.rowCount)} records`}>
          {fmtCount(d.rowCount)}
        </span>
        {copyBtn(d.name, 'Copy table name')}
      </div>
    )
  }

  // field — the tree shows the plain name; the copied path carries [0] for arrays
  const f = row.field
  const Icon = TYPE_ICONS[f.type] || File
  const color = TYPE_COLORS[f.type] || 'text-slate-400'
  return (
    <div {...treeitem} className={`${base} ${hover} ${row.hasChildren ? 'cursor-pointer' : ''} text-slate-700`}>
      {chevron}
      <span title={`Type: ${typeLabel(f)}`} className="shrink-0 flex">
        <Icon size={13} strokeWidth={2.25} className={color} />
      </span>
      <span className="truncate font-mono text-[12.5px]" title={row.copyPath}>{f.name}</span>
      <span className="ml-auto" />
      {copyBtn(row.copyPath, `Copy ${row.copyPath}`)}
    </div>
  )
}
