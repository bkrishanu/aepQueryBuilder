import { useState, useRef, useMemo, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'
import api, { isSessionError, notifySessionExpired } from './api.js'
import {
  LoaderCircle, Copy, Check, Table2, CircleCheck, CircleAlert, OctagonX, Square,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, TriangleAlert, X, LocateFixed,
  FileSpreadsheet, FileJson, Columns3, ListTree, Braces,
} from 'lucide-react'
import SqlEditor from './SqlEditor.jsx'
import Btn, { IconBtn } from './Button.jsx'
import { Modal } from './Overlay.jsx'
import JsonTree from './JsonTree.jsx'
import { ResultsTable, FilterBar, ColumnFilterPopover, ColumnPickerPopover } from './ResultGrid.jsx'
import { useResultView } from './resultView.js'
import { cellText, jsonValue, prettyValue, tsvField, toCSV, toJSON, downloadFile, exportFileName } from './cellValues.js'
import { splitStatements, RUN_SHORTCUT, isQsCancellable, isQueryServiceTarget } from './sqlStatements.js'

// ─── shared design tokens (keep in sync with App.jsx C object) ───────────────
const C = {
  cardBg:      'bg-surface',
  cardBorder:  'border-slate-200',
  inputBg:     'bg-surface',
  mutedText:   'text-slate-400',
  bodyText:    'text-slate-700',
  headingText: 'text-slate-900',
}

// ─── result helpers ───────────────────────────────────────────────────────────
const plural  = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
const oneLine = (sql) => sql.replace(/\s+/g, ' ').trim()
const preview = (sql) => { const s = oneLine(sql); return s.length > 80 ? `${s.slice(0, 80)}…` : s }

/** 1-based character position inside `text` → { line, col }. */
function lineCol(text, pos) {
  const before = text.slice(0, Math.max(0, pos - 1)).split('\n')
  return { line: before.length, col: before[before.length - 1].length + 1 }
}

/** One-line description of a result set, for headers and the console. */
function describeSet(set) {
  if (set.status !== 'success') return `${set.duration ?? 0}ms`
  if (set.columns.length) return `${plural(set.rows.length, 'row')}${set.truncated ? ' (limit reached)' : ''} · ${plural(set.columns.length, 'col')} · ${set.duration}ms`
  const affected = set.rowCount != null && set.command !== 'SELECT' ? ` · ${plural(set.rowCount, 'row')} affected` : ''
  return `${set.command || 'Statement'}${affected} · ${set.duration}ms`
}

// ─── query streaming ──────────────────────────────────────────────────────────
// How long Cancel waits for the server to confirm before giving up on the run
// (the Query Service API lookup retries for ~10s, then the batch job stops).
const CANCEL_CONFIRM_MS = 30000

/**
 * POST a run to /api/query or /api/query/direct and read its NDJSON stream,
 * calling onMessage for each message ('started' | 'statement' | 'done' | 'error').
 */
async function streamQuery(endpoint, body, signal, onMessage) {
  const res = await fetch(`/api${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    if (isSessionError(res.status, data)) notifySessionExpired()
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.trim()) onMessage(JSON.parse(line))
    }
  }
  if (buf.trim()) onMessage(JSON.parse(buf))
}

// ─── QueryPane ────────────────────────────────────────────────────────────────
// Exposes execute(endpoint, payload) and cancel() via ref so the parent toolbar
// (Run / Cancel buttons, Ctrl+Enter) can drive it; onExecutingChange reports
// false | 'running' | 'cancelling'. onRun is wired to the editor's Ctrl+Enter.
// Also exposes explain(endpoint, payload) — runs EXPLAIN for the statements
// that Run would execute and shows the plan in a dialog — and loadQuery(text),
// which replaces the editor content (query history).
//
// The SQL starts as `initialQuery` (a restored tab); every edit is reported
// through onQueryChange so the parent can persist it. onRunComplete receives
// { query, duration, rowCount, status } after each finished run (history).
//
// Cancel sends the run's cancel token and the running statement to
// /api/query/cancel (Postgres CancelRequest + Query Service API cancel), then
// keeps reading the stream: the running statement coming back cancelled or
// failed confirms that the database stopped it. Without confirmation within
// CANCEL_CONFIRM_MS the request is abandoned and the UI says so.
//
// On Query Service a SELECT can't be cancelled at all (see isQsCancellable).
// Cancel then "detaches": the UI stops waiting at once and says the query
// will finish on the server, while the stream is still read in the
// background so later INSERT INTO / CTAS statements of the run get cancelled.
//
// Rows stream in as 'rows' batches (arrays in column order, at most
// limits.maxRows per result set) and are kept here, so paging through them
// never re-runs the query; the grid renders one page at a time.
//
// results: null
//        | { sets: [{ statement, index, status, columns: [{ name, label }], rows: [[…]], rowCount,
//                    command, duration, truncated?, error?, code?, position? }],
//            duration, limits: { maxRows, pageSize }, runId }
//        | { cancelled: true, unconfirmed?: true, detached?: true }
//        | { error }   — the request itself failed (auth, connection, …)
const QueryPane = forwardRef(function QueryPane({
  addLog, onExecutingChange, onRun, initialQuery = '', onQueryChange, onRunComplete, dark = false,
}, ref) {
  const [query, setQuery]         = useState(initialQuery)
  const [results, setResults]     = useState(null)
  const [executing, setExecuting] = useState(false)
  const [startedAt, setStartedAt] = useState(null)
  const [received, setReceived]   = useState(0)        // rows streamed so far by the running query
  const [activeTab, setActiveTab] = useState('editor') // 'editor' | 'results'
  const [copiedKey, setCopiedKey] = useState(null)     // transient "Copied" feedback per result set
  const [viewCell, setViewCell]   = useState(null)     // { column, row, value } shown in the value viewer
  // first SQL error with a position, for the editor: { from, statement, position, message }
  const [editorError, setEditorError] = useState(null)
  const editorRef  = useRef(null)
  const [cancelling, setCancelling] = useState(false)
  const runRef     = useRef(null)  // { ac, token, cancelRequested, timer } of the run in flight
  const detachedRef = useRef(new Set()) // cancelled runs still read in the background
  const runningRef = useRef(false) // synchronous guard: state updates land too late to stop a double run
  // EXPLAIN dialog: null | { loading, startedAt, items: [{ statement, status, plan, error, code, hint }], error }
  const [explain, setExplain] = useState(null)
  const explainRef = useRef(null)  // AbortController of the EXPLAIN request in flight

  useEffect(() => {
    if (copiedKey === null) return
    const t = setTimeout(() => setCopiedKey(null), 1600)
    return () => clearTimeout(t)
  }, [copiedKey])

  const sendCancel = (run) => {
    const cur = run.current
    run.cancelSentFor = cur?.index ?? -1
    api.post('/query/cancel', {
      token: run.token,
      statement: cur ? run.statements[cur.index] : undefined,
      startedAt: cur?.startedAt,
    })
      .then(({ data }) => {
        addLog(data.sent ? 'info' : 'warn', data.sent
          ? 'Postgres cancel request delivered to the database server.'
          : 'Postgres cancel request could not be delivered to the database server.')
        logApiCancel(data.api)
      })
      .catch(err => addLog('warn', `Cancel request failed: ${err.response?.data?.error || err.message}`))
  }

  const logApiCancel = (r) => {
    if (!r) return // Direct mode: no Query Service API credentials
    if (r.cancelled) {
      addLog('info', `Query Service API: cancel issued for query ${r.queryId} (was ${r.state}) — waiting for confirmation…`)
    } else if (r.unsupported) {
      // the client skips these; only reached if a statement was misclassified
      addLog('warn', 'Query Service API: this statement type cannot be cancelled.')
    } else if (r.finished) {
      addLog('warn', `Query Service API: query ${r.queryId} had already finished (${r.state}) — nothing left to cancel.`)
    } else if (r.error) {
      addLog('warn', `Query Service API cancel failed${r.status ? ` (HTTP ${r.status})` : ''}: ${r.error}`)
    } else {
      addLog('warn', `Query Service API: query not found after ${r.attempts} lookups (${r.scanned} recent queries).`)
      ;(r.recent || []).forEach(q => addLog('info', `  recent: [${q.state}] [${q.client || '—'}] ${q.sql}`))
    }
  }

  // Query Service can't stop this statement: free the UI now, keep reading the
  // stream in the background so later cancellable statements are cancelled.
  const detach = (run) => {
    if (run.detached) return
    run.detached = true
    clearTimeout(run.timer)
    detachedRef.current.add(run)
    if (runRef.current === run) runRef.current = null
    setRunning(false)
    setResults({ cancelled: true, detached: true })
    setActiveTab('results')
    const more = (run.current?.index ?? 0) < run.statements.length - 1
    addLog('warn', 'Stopped waiting. Query Service can\'t cancel a SELECT sent from a SQL client (only INSERT INTO and CREATE TABLE AS can be cancelled) — it will finish on the server and its results are discarded.'
      + (more ? ' Later INSERT INTO / CREATE TABLE AS statements in this run are cancelled as they start.' : ''))
  }

  // the server reports statement `index` running after Cancel: cancel it, or detach if it can't be
  const cancelStatement = (run) => {
    const index = run.current.index
    if (index === run.cancelSentFor) return
    if (run.isQS && !isQsCancellable(run.statements[index])) {
      run.cancelSentFor = index
      detach(run)
    } else if (run.token) {
      sendCancel(run)
    }
  }

  const requestCancel = (run) => {
    if (!run || run.cancelRequested) return
    run.cancelRequested = true
    run.cancelIndex = run.current?.index ?? 0
    addLog('info', 'Cancelling query…')
    if (run.current && run.isQS && !isQsCancellable(run.statements[run.current.index])) {
      run.cancelSentFor = run.current.index
      detach(run)
      return
    }
    setCancelling(true)
    onExecutingChange?.('cancelling')
    if (run.token && run.current) sendCancel(run)
    else if (run.started && !run.token) run.ac.abort() // server can't issue cancel tokens — drop the request
    // otherwise the cancel goes out when the server reports the first statement
    run.timer = setTimeout(() => run.ac.abort(), CANCEL_CONFIRM_MS)
  }

  // closing the pane mid-run cancels it and stops background reads
  useEffect(() => () => {
    const run = runRef.current
    if (run?.token) api.post('/query/cancel', { token: run.token }).catch(() => {})
    run?.ac.abort()
    detachedRef.current.forEach(r => r.ac.abort())
  }, [])

  const setRunning = (running) => {
    runningRef.current = running
    setExecuting(running)
    setCancelling(false)
    setStartedAt(running ? Date.now() : null)
    setReceived(0)
    onExecutingChange?.(running ? 'running' : false)
  }

  // point the editor at the first error the server located in the SQL
  const locateError = (sets, planned) => {
    const set = sets.find(s => s.status === 'error' && s.position && planned[s.index])
    if (!set) return
    const stmt = planned[set.index]
    setEditorError({ from: stmt.from, statement: stmt.text, position: set.position, message: set.error })
  }

  const showErrorInEditor = () => {
    setEditorError(e => e && { ...e }) // a fresh object makes the editor jump to it again
    setActiveTab('editor')
  }

  const logOutcome = (sets) => {
    sets.forEach((set, i) => {
      const tag = sets.length > 1 ? `Query ${i + 1}` : 'Query'
      if (set.status === 'success') {
        addLog('info', `${tag} succeeded: ${describeSet(set)}.`)
        if (set.truncated) addLog('warn', `${tag}: results limited to the first ${plural(set.rows.length, 'row')} — add a LIMIT or WHERE clause to narrow them.`)
      }
      else if (set.status === 'error') addLog('error', `${tag} failed${set.code ? ` [${set.code}]` : ''}: ${set.error}`)
      else if (set.status === 'cancelled') addLog('warn', `${tag} cancelled on the server: ${set.error}`)
      else addLog('warn', `${tag} ${set.error}`)
    })
  }

  // EXPLAIN for the statements Run would execute (the selection, or the one
  // under the cursor). The editor text, results and error marks are untouched.
  const runExplain = async (endpoint, payload) => {
    if (explainRef.current) return
    const plan = editorRef.current?.getStatementsToRun() ?? { statements: splitStatements(query) }
    const statements = plan.statements.map(s => s.text.replace(/;\s*$/, '').trim()).filter(Boolean)
    if (!statements.length) { addLog('warn', 'Query is empty — nothing to explain.'); return }
    const queries = statements.map(s => (/^\s*explain\b/i.test(s) ? s : `EXPLAIN ${s}`))

    const ac = new AbortController()
    explainRef.current = ac
    setExplain({ loading: true, startedAt: Date.now(), items: [] })
    addLog('info', statements.length === 1 ? `Explaining: ${preview(statements[0])}` : `Explaining ${statements.length} statements…`)
    const rowsBySeq = []
    let done = null
    try {
      await streamQuery(endpoint, { ...payload, queries }, ac.signal, (msg) => {
        if (msg.type === 'rows') (rowsBySeq[msg.seq] ??= []).push(...msg.rows)
        else if (msg.type === 'done') done = msg
        else if (msg.type === 'error') throw new Error(msg.error)
      })
      if (!done) throw new Error('The server closed the connection before EXPLAIN finished.')
      const items = (done.results || []).map((s, seq) => ({
        statement: statements[s.index] ?? s.statement,
        status: s.status,
        // one plan line per row; multi-column output is joined with two spaces
        plan: s.status === 'success' ? (rowsBySeq[seq] || []).map(r => r.map(cellText).join('  ')).join('\n') : '',
        error: s.error, code: s.code, hint: s.hint,
      }))
      setExplain(e => e && { loading: false, items })
      const failedCount = items.filter(i => i.status !== 'success').length
      if (failedCount) items.filter(i => i.status === 'error').forEach(i => addLog('error', `EXPLAIN failed${i.code ? ` [${i.code}]` : ''}: ${i.error}`))
      else addLog('info', `Explain plan ready (${done.duration}ms).`)
    } catch (err) {
      if (err.name === 'AbortError') return // dialog closed
      setExplain(e => e && { loading: false, items: [], error: err.message })
      addLog('error', `EXPLAIN failed: ${err.message}`)
    } finally {
      if (explainRef.current === ac) explainRef.current = null
    }
  }

  const closeExplain = useCallback(() => {
    explainRef.current?.abort()
    explainRef.current = null
    setExplain(null)
  }, [])

  useEffect(() => () => explainRef.current?.abort(), [])

  // Copies the displayed rows — visible columns, filtered and sorted, every page — as TSV.
  const handleCopy = ({ labels, rows }, key) => {
    const lines = [
      labels.map(tsvField).join('\t'),
      ...rows.map(r => r.map(tsvField).join('\t')),
    ]
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => {
        setCopiedKey(key)
        addLog('info', `${plural(rows.length, 'row')} copied to clipboard (tab-delimited).`)
      })
      .catch(err => addLog('error', `Copy failed: ${err.message}`))
  }

  // Downloads the displayed rows as CSV or JSON, built in the browser.
  const handleExport = ({ labels, rows }, format, suffix) => {
    try {
      if (format === 'csv') downloadFile(exportFileName('csv', suffix), toCSV(labels, rows), 'text/csv;charset=utf-8')
      else downloadFile(exportFileName('json', suffix), toJSON(labels, rows), 'application/json')
      addLog('info', `${plural(rows.length, 'row')} × ${plural(labels.length, 'column')} downloaded as ${format.toUpperCase()}.`)
    } catch (err) {
      addLog('error', `Download failed: ${err.message}`)
    }
  }

  const closeViewer = useCallback(() => setViewCell(null), [])

  const handleQueryChange = (text) => {
    setQuery(text)
    setEditorError(null) // positions no longer match once the SQL changes
    onQueryChange?.(text)
  }

  useImperativeHandle(ref, () => ({
    execute: async (endpoint, payload) => {
      if (runningRef.current) return // a run is in flight — ignore repeated Run / Ctrl+Enter
      const plan = editorRef.current?.getStatementsToRun() ?? { statements: splitStatements(query) }
      const statements = plan.statements.map(s => s.text)
      if (!statements.length) { addLog('warn', 'Query is empty.'); return }

      const run = {
        ac: new AbortController(), statements, token: null, started: false,
        isQS: isQueryServiceTarget(endpoint, payload), detached: false,
        current: null,       // { index, startedAt } of the statement running on the server
        cancelRequested: false, cancelIndex: -1, cancelSentFor: null, timer: 0,
        limits: null,        // { maxRows, pageSize, batchSize } from the server
        rowsBySeq: [],       // streamed rows per result set
        received: 0,
      }
      runRef.current = run
      setRunning(true)
      setEditorError(null)
      addLog('info', statements.length === 1
        ? `Executing: ${preview(statements[0])}`
        : `Executing ${statements.length} selected statements sequentially…`)
      let done = null
      try {
        await streamQuery(endpoint, { ...payload, queries: statements }, run.ac.signal, (msg) => {
          if (msg.type === 'started') {
            run.started = true
            run.token = msg.cancelToken
            run.limits = msg.limits || null
            if (run.cancelRequested && !run.token) run.ac.abort()
          } else if (msg.type === 'columns') {
            run.rowsBySeq[msg.seq] = []
          } else if (msg.type === 'rows') {
            if (run.detached) return // results of a detached run are discarded
            const rows = (run.rowsBySeq[msg.seq] ??= [])
            for (const r of msg.rows) rows.push(r)
            run.received += msg.rows.length
            setReceived(run.received)
          } else if (msg.type === 'statement') {
            run.current = { index: msg.index, startedAt: msg.startedAt }
            // Cancel came before this statement was known, or the server moved on
            // to the next statement after a cancel — cancel (or detach from) this one
            if (run.cancelRequested) cancelStatement(run)
          } else if (msg.type === 'done') {
            done = msg
          } else if (msg.type === 'error') {
            throw new Error(msg.error)
          }
        })
        if (!done) throw new Error('The server closed the connection before the query finished.')
        if (run.detached) {
          addLog('info', 'The cancelled run has finished on the server; its results were discarded.')
          return
        }
        // results[seq] is the summary of the rows streamed under that seq
        let sets = (done.results || []).map((s, seq) => ({
          ...s,
          columns: s.columns || [],
          rows: s.status === 'success' ? (run.rowsBySeq[seq] || []) : [],
        }))
        run.rowsBySeq = []
        if (run.cancelRequested && !sets.some(s => s.status === 'cancelled')) {
          // Query Service reports an API cancel as an ordinary error on the statement
          const at = sets.findIndex(s => s.index >= run.cancelIndex && s.status === 'error')
          if (at >= 0) sets = sets.map((s, i) => i === at ? { ...s, status: 'cancelled' } : s)
        }
        setResults({ sets, duration: done.duration, limits: run.limits, runId: Date.now() })
        setActiveTab('results')
        logOutcome(sets)
        locateError(sets, plan.statements)
        if (run.cancelRequested && !sets.some(s => s.status === 'cancelled')) {
          addLog('warn', 'The query finished before the cancel took effect.')
        }
        onRunComplete?.({
          query: statements.join('\n\n'),
          duration: done.duration,
          rowCount: sets.reduce((n, s) => n + (s.status !== 'success' ? 0 : s.columns.length ? s.rows.length : (s.rowCount ?? 0)), 0),
          status: sets.some(s => s.status === 'cancelled') ? 'cancelled' : sets.some(s => s.status !== 'success') ? 'error' : 'success',
        })
      } catch (err) {
        if (run.detached) return // the UI has moved on
        if (err.name === 'AbortError') {
          if (!run.cancelRequested) return // pane closed
          setResults({ cancelled: true, unconfirmed: true })
          setActiveTab('results')
          addLog('warn', `Cancel not confirmed by the server within ${CANCEL_CONFIRM_MS / 1000}s — the query may still be running in Query Service (check Queries > Logs).`)
        } else {
          setResults({ error: err.message })
          addLog('error', `Query failed: ${err.message}`)
        }
      } finally {
        clearTimeout(run.timer)
        detachedRef.current.delete(run)
        if (!run.detached) {
          if (runRef.current === run) runRef.current = null
          setRunning(false)
        }
      }
    },
    cancel: () => requestCancel(runRef.current),
    // read from the ref, not `executing` state: this handle may have been created
    // in an earlier render, and state from that render would be stale
    isExecuting: () => runningRef.current,
    explain: (endpoint, payload) => runExplain(endpoint, payload),
    isExplaining: () => !!explainRef.current,
    loadQuery: (text) => {
      handleQueryChange(text)
      setActiveTab('editor')
    },
  }))

  const sets      = results?.sets
  const failed    = sets ? sets.filter(s => s.status === 'error').length : 0
  const badgeText = sets && (sets.length === 1 ? (sets[0].rows?.length ?? 0) : `${sets.length} sets`)

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
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
            {id === 'results' && sets && (
              <span
                title={failed ? `${plural(failed, 'statement')} did not succeed` : undefined}
                className={`text-[11px] font-semibold rounded-full px-2 py-px tabular-nums ${
                  failed ? 'bg-rose-100 text-rose-700'
                    : activeTab === id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {badgeText}
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
          // grows with the workspace card (viewport height on large screens); 420px floor
          <div className="flex flex-col flex-1 min-h-[420px] p-3 sm:p-4 gap-3">
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">SQL Query</span>
              {executing ? (
                <span role="status" className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5 flex items-center gap-1.5">
                  <LoaderCircle size={14} strokeWidth={2.5} className="animate-spin" />
                  Running… <Elapsed since={startedAt} />
                </span>
              ) : (
                <span className="hidden sm:inline text-[11px] text-slate-400">
                  <kbd className="font-mono text-slate-500">{RUN_SHORTCUT}</kbd> runs the selection, or the statement under the cursor
                </span>
              )}
            </div>
            <div className="relative flex-1 min-h-0 rounded-lg border border-slate-200 overflow-hidden shadow-inner focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/15 transition-colors">
              {/* absolute fill gives CodeMirror a definite height to size against */}
              <div className="absolute inset-0">
              <SqlEditor
                ref={editorRef}
                value={query}
                onChange={handleQueryChange}
                onRun={onRun}
                error={editorError}
                dark={dark}
                placeholder="SELECT * FROM your_dataset LIMIT 10;"
              />
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {activeTab === 'results' && (
          <div className="flex flex-col flex-1 min-h-[420px] p-3 sm:p-4 gap-3 min-w-0">
            {executing ? (
              <div role="status" className="flex-1 flex flex-col items-center justify-center gap-3">
                <LoaderCircle size={32} strokeWidth={2} className="animate-spin text-blue-600" />
                <p className="text-sm text-slate-500">
                  {received > 0 ? 'Loading results…' : 'Executing query, please wait…'} <Elapsed since={startedAt} />
                </p>
                {received > 0 && (
                  <p className="text-xs text-slate-400 tabular-nums">{plural(received, 'row')} received</p>
                )}
                <Btn variant="danger" size="sm" icon={Square} iconClassName="fill-current" loading={cancelling} onClick={() => requestCancel(runRef.current)}>
                  {cancelling ? 'Cancelling…' : 'Cancel query'}
                </Btn>
              </div>
            ) : !results ? (
              <EmptyState title="No results yet" text="Execute a query to see data here." icon={Table2} />
            ) : results.cancelled ? (
              <EmptyState
                title={results.detached ? 'Stopped waiting' : results.unconfirmed ? 'Cancel not confirmed' : 'Query cancelled'}
                text={results.detached
                  ? 'Query Service can\'t cancel SELECT queries sent from a SQL client — this one will finish on the server. Its results are discarded.'
                  : results.unconfirmed
                    ? 'The server did not confirm the cancel — the query may still be running in Query Service.'
                    : 'Execution was stopped and the database connection was closed.'}
                icon={OctagonX}
                tone="warn"
              />
            ) : results.error ? (
              <ErrorPanel title="Query failed" message={results.error} />
            ) : sets.length === 1 ? (
              <ResultSet
                key={results.runId}
                set={sets[0]}
                title="Results"
                pageSize={results.limits?.pageSize}
                copied={copiedKey === 0}
                onCopy={view => handleCopy(view, 0)}
                onExport={(view, format) => handleExport(view, format)}
                onOpenCell={setViewCell}
                onShowError={editorError && sets[0].index === 0 ? showErrorInEditor : undefined}
              />
            ) : (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Results
                  <span className="ml-2 normal-case tracking-normal text-slate-400 font-normal">
                    {plural(sets.length, 'statement')} · {sets.length - failed} succeeded
                    {failed > 0 && <span className="text-rose-600"> · {failed} failed</span>}
                    {results.duration !== undefined && ` · ${results.duration}ms`}
                  </span>
                </p>
                {sets.map((set, i) => (
                  <ResultSet
                    key={`${results.runId}-${i}`}
                    set={set}
                    title={`Query ${i + 1}`}
                    multi
                    pageSize={results.limits?.pageSize}
                    copied={copiedKey === i}
                    onCopy={view => handleCopy(view, i)}
                    onExport={(view, format) => handleExport(view, format, `-q${i + 1}`)}
                    onOpenCell={setViewCell}
                    onShowError={editorError && set.status === 'error' && editorError.statement === set.statement && set.position === editorError.position
                      ? showErrorInEditor : undefined}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {viewCell && <CellViewer cell={viewCell} onClose={closeViewer} />}
      {explain && <ExplainDialog explain={explain} onClose={closeExplain} />}
    </div>
  )
})

/** Copy button with transient "Copied" feedback. */
function CopyIconBtn({ text, label = 'Copy', align = 'end' }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <IconBtn
      size="sm"
      icon={copied ? Check : Copy}
      iconClassName={copied ? 'text-emerald-600' : ''}
      label={copied ? 'Copied' : label}
      onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {})}
      align={align}
    />
  )
}

/**
 * Modal showing a cell's complete value with copy. JSON — objects, arrays and
 * nested XDM fields, or JSON held in a text column — opens as a collapsible
 * tree, with a toggle to the pretty-printed text.
 * Closes on Escape, the close button, or a click on the backdrop.
 */
function CellViewer({ cell, onClose }) {
  const json = useMemo(() => jsonValue(cell.value), [cell.value])
  const text = useMemo(() => prettyValue(cell.value), [cell.value])
  const [mode, setMode] = useState(json !== undefined ? 'tree' : 'text') // 'tree' | 'text'
  const [tree, setTree] = useState({ n: 0, depth: 2 }) // remounting the tree expands / collapses all

  return (
    <Modal label={`Value of ${cell.column}, row ${cell.row}`} onClose={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{cell.column}</p>
          <p className="text-[11px] text-slate-400 tabular-nums">Row {cell.row.toLocaleString()} · {text.length.toLocaleString()} characters</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {json !== undefined && (
            <div role="radiogroup" aria-label="View as" className="mr-1 flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
              {[['tree', ListTree, 'Tree'], ['text', Braces, 'JSON']].map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={mode === id}
                  onClick={() => setMode(id)}
                  className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-semibold transition-colors ${mode === id ? 'bg-surface text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  <Icon size={12} strokeWidth={2.25} /> {label}
                </button>
              ))}
            </div>
          )}
          <CopyIconBtn text={text} label="Copy value" />
          <IconBtn size="sm" icon={X} label="Close (Esc)" onClick={onClose} align="end" />
        </div>
      </div>
      {mode === 'tree' && json !== undefined ? (
        <>
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-1.5 text-[11px]">
            <button type="button" onClick={() => setTree(t => ({ n: t.n + 1, depth: Infinity }))} className="font-semibold text-blue-600 hover:underline">Expand all</button>
            <button type="button" onClick={() => setTree(t => ({ n: t.n + 1, depth: 1 }))} className="font-semibold text-blue-600 hover:underline">Collapse all</button>
          </div>
          {/* focusable so arrow keys / PageDown scroll the value */}
          <div data-autofocus tabIndex={0} className="min-h-0 flex-1 overflow-auto px-3 py-3 focus:outline-none">
            <JsonTree key={tree.n} value={json} expandDepth={tree.depth} />
          </div>
        </>
      ) : (
        <pre data-autofocus tabIndex={0} className="min-h-0 focus:outline-none flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-700">{text}</pre>
      )}
    </Modal>
  )
}

/**
 * EXPLAIN output for each explained statement: the plan in a monospace,
 * scrollable block that keeps its indentation, with copy; errors are shown as
 * in the results. Closing while it loads abandons the request.
 */
function ExplainDialog({ explain, onClose }) {
  const { loading, items, error } = explain
  const ok = items.filter(i => i.status === 'success')
  const allPlans = ok.map(i => (ok.length > 1 ? `-- ${oneLine(i.statement)}\n${i.plan}` : i.plan)).join('\n\n')
  return (
    <Modal label="Explain plan" onClose={onClose} className="max-w-5xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <ListTree size={15} strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Explain plan</p>
            <p className="text-[11px] text-slate-400">
              {loading ? 'Asking the database for its plan…' : items.length > 1 ? plural(items.length, 'statement') : 'Execution plan chosen by the database'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!loading && allPlans && <CopyIconBtn text={allPlans} label={ok.length > 1 ? 'Copy all plans' : 'Copy plan'} />}
          <IconBtn size="sm" icon={X} label={loading ? 'Cancel (Esc)' : 'Close (Esc)'} onClick={onClose} align="end" />
        </div>
      </div>
      <div data-autofocus tabIndex={-1} className="explorer-scroll min-h-0 flex-1 overflow-y-auto p-4 space-y-4 focus:outline-none">
        {loading && (
          <div role="status" className="flex flex-col items-center justify-center gap-3 py-12">
            <LoaderCircle size={28} strokeWidth={2} className="animate-spin text-blue-600" />
            <p className="text-sm text-slate-500">Running EXPLAIN… <Elapsed since={explain.startedAt} /></p>
          </div>
        )}
        {!loading && error && <ErrorPanel title="EXPLAIN failed" message={error} />}
        {!loading && items.map((item, i) => (
          <section key={i} className="space-y-2">
            {items.length > 1 && (
              <code title={item.statement} className="block truncate rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[12px] text-slate-600">
                {oneLine(item.statement)}
              </code>
            )}
            {item.status === 'success' ? (
              <div className="relative">
                <pre tabIndex={0} className="results-grid max-h-[60vh] overflow-auto whitespace-pre rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30">
                  {item.plan || '(no plan returned)'}
                </pre>
                {items.length > 1 && item.plan && (
                  <div className="absolute right-2 top-2"><CopyIconBtn text={item.plan} label="Copy plan" /></div>
                )}
              </div>
            ) : (
              <ErrorPanel
                tone={item.status === 'error' ? 'error' : 'warn'}
                title={item.status === 'skipped' ? 'Not executed' : 'EXPLAIN failed'}
                message={item.error}
                code={item.status === 'error' ? item.code : undefined}
                hint={item.hint}
              />
            )}
          </section>
        ))}
        {!loading && (
          <p className="text-[11px] text-slate-400">Your query in the editor is unchanged.</p>
        )}
      </div>
    </Modal>
  )
}

/** Live "1.2s" counter from a start timestamp. */
function Elapsed({ since }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])
  return <span className="tabular-nums">{(Math.max(0, now - (since ?? now)) / 1000).toFixed(1)}s</span>
}

const STATUS_CHIP = {
  success: { label: 'Success', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  error:   { label: 'Failed',  cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  skipped:   { label: 'Skipped',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
}

// used until the server reports its page size (QUERY_PAGE_SIZE)
const FALLBACK_PAGE_SIZE = 100

/**
 * One statement's outcome: header (title, status, stats, column picker, copy,
 * CSV / JSON download) and its table, empty state or error. `multi` adds the
 * status chip, the statement text and a card frame so several result sets
 * read as separate blocks.
 * Rows are shown `pageSize` at a time after the view's filters and sort
 * (useResultView); paging, sorting and filtering only work on the rows already
 * fetched, so they never re-run the query. Copy and downloads take the same
 * view: visible columns, filtered and sorted, every page.
 */
function ResultSet({ set, title, multi = false, pageSize = FALLBACK_PAGE_SIZE, copied, onCopy, onExport, onOpenCell, onShowError }) {
  const [popover, setPopover] = useState(null) // { type: 'filter', col, anchor } | { type: 'columns', anchor }
  const view    = useResultView(set)
  // the page belongs to the rows it was chosen on: a new sort or filter starts at page 1
  const [paging, setPaging] = useState({ rows: null, page: 0 })
  const page    = paging.rows === view.viewRows ? paging.page : 0
  const setPage = (p) => setPaging({ rows: view.viewRows, page: p })
  const ok      = set.status === 'success'
  const hasCols = ok && set.columns.length > 0
  const chip    = STATUS_CHIP[set.status] || STATUS_CHIP.error
  const where   = !ok && set.position ? lineCol(set.statement, set.position) : null

  const fetched   = ok ? set.rows.length : 0
  const total     = ok ? view.viewRows.length : 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current   = Math.min(page, pageCount - 1)
  const first     = current * pageSize
  const pageRows  = useMemo(() => view.viewRows.slice(first, first + pageSize), [view.viewRows, first, pageSize])

  const closePopover = useCallback(() => setPopover(null), [])
  const openFilter = (col, anchor) => setPopover(p => (p?.type === 'filter' && p.col === col ? null : { type: 'filter', col, anchor }))
  const rowsLabel = plural(total, 'row')

  return (
    <section
      aria-label={`${title}: ${chip.label}`}
      className={`flex flex-col gap-2.5 min-w-0 ${multi ? 'rounded-xl border border-slate-200 p-3' : 'flex-1'}`}
    >
      <div className="flex items-center justify-between gap-3 min-h-8">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">{title}</span>
          {(multi || !ok) && (
            <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-px ${chip.cls}`}>
              {chip.label}
            </span>
          )}
          <span className="truncate text-[11px] text-slate-400 tabular-nums">{describeSet(set)}</span>
        </div>
        {hasCols && (
          <div className="flex shrink-0 items-center gap-1">
            {fetched > 0 && (
              <span className="relative">
                <IconBtn
                  size="sm"
                  icon={Columns3}
                  label={`Columns — ${view.visibleCols.length} of ${set.columns.length} shown`}
                  onClick={e => { const anchor = e.currentTarget; setPopover(p => (p?.type === 'columns' ? null : { type: 'columns', anchor })) }}
                  align="end"
                />
                {view.visibleCols.length < set.columns.length && (
                  <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-surface" aria-hidden="true" />
                )}
              </span>
            )}
            <IconBtn
              size="sm"
              icon={copied ? Check : Copy}
              iconClassName={copied ? 'text-emerald-600' : ''}
              label={copied ? 'Copied' : `Copy ${rowsLabel} (tab-delimited)`}
              onClick={() => onCopy(view.exportView())}
              disabled={total === 0}
              align="end"
            />
            <IconBtn
              size="sm"
              icon={FileSpreadsheet}
              label={`Download CSV — ${rowsLabel}`}
              onClick={() => onExport(view.exportView(), 'csv')}
              disabled={total === 0}
              align="end"
            />
            <IconBtn
              size="sm"
              icon={FileJson}
              label={`Download JSON — ${rowsLabel}`}
              onClick={() => onExport(view.exportView(), 'json')}
              disabled={total === 0}
              align="end"
            />
          </div>
        )}
      </div>

      {multi && (
        <code title={set.statement} className="block truncate rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[12px] text-slate-600">
          {oneLine(set.statement)}
        </code>
      )}

      {ok && set.truncated && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert size={14} strokeWidth={2.25} className="mt-px shrink-0 text-amber-600" />
          <span>
            <span className="font-medium">Maximum result limit reached.</span>{' '}
            Results limited to the first {plural(fetched, 'row')} — add a LIMIT or WHERE clause to narrow the query.
          </span>
        </div>
      )}

      {ok && fetched > 0 && (
        <FilterBar columns={set.columns} view={view} onEdit={openFilter} />
      )}
      {ok && fetched > 0 && (
        <ResultsTable
          columns={set.columns}
          rows={pageRows}
          rowOffset={first}
          view={view}
          onOpenCell={onOpenCell}
          onOpenFilter={openFilter}
        />
      )}
      {ok && fetched > 0 && total === 0 && (
        <p role="status" className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-4 text-center text-xs text-slate-500">
          No rows match the active filters.{' '}
          <button type="button" onClick={view.clearFilters} className="font-semibold text-blue-600 hover:underline">Clear filters</button>
        </p>
      )}
      {ok && total > 0 && (
        <Pager
          first={first}
          shown={pageRows.length}
          total={total}
          fetched={fetched}
          page={current}
          pageCount={pageCount}
          truncated={!!set.truncated}
          onPage={setPage}
        />
      )}
      {ok && fetched === 0 && (
        <EmptyState
          compact={multi}
          title="Query executed successfully"
          text={hasCols ? 'No records found.' : describeSet(set)}
          icon={CircleCheck}
        />
      )}
      {!ok && (
        <ErrorPanel
          tone={set.status === 'error' ? 'error' : 'warn'}
          title={set.status === 'skipped' ? 'Not executed'
            : set.status === 'cancelled' ? 'Cancelled on the server'
            : where ? `Failed at line ${where.line}, column ${where.col}` : 'Statement failed'}
          message={set.error}
          code={set.status === 'error' ? set.code : undefined}
          hint={set.hint}
          action={onShowError && (
            <Btn variant="secondary" size="sm" icon={LocateFixed} onClick={onShowError}>Show in editor</Btn>
          )}
        />
      )}

      {popover?.type === 'filter' && (
        <ColumnFilterPopover
          key={popover.col}
          anchor={popover.anchor}
          column={set.columns[popover.col]}
          col={popover.col}
          rows={set.rows}
          view={view}
          onClose={closePopover}
        />
      )}
      {popover?.type === 'columns' && (
        <ColumnPickerPopover anchor={popover.anchor} columns={set.columns} view={view} onClose={closePopover} />
      )}
    </section>
  )
}

/**
 * "Showing rows 101–200 of 10,000" with first / previous / next / last page
 * controls; notes how many fetched rows the filters hide.
 */
function Pager({ first, shown, total, fetched = total, page, pageCount, truncated, onPage }) {
  const of = total < fetched
    ? `${total.toLocaleString()} (filtered from ${fetched.toLocaleString()}${truncated ? '+' : ''})`
    : `${total.toLocaleString()}${truncated ? '+' : ''}`
  const range = pageCount === 1
    ? (total < fetched ? `Showing ${plural(total, 'row')} of ${fetched.toLocaleString()}` : `Showing all ${plural(total, 'row')}`)
    : `Showing rows ${(first + 1).toLocaleString()}–${(first + shown).toLocaleString()} of ${of}`
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <span className="tabular-nums" aria-live="polite">{range}</span>
      {pageCount > 1 && (
        <nav aria-label="Result pages" className="flex items-center gap-1">
          <IconBtn size="sm" variant="ghost" icon={ChevronsLeft}  label="First page"    onClick={() => onPage(0)}             disabled={page === 0} />
          <IconBtn size="sm" variant="ghost" icon={ChevronLeft}   label="Previous page" onClick={() => onPage(page - 1)}      disabled={page === 0} />
          <span className="px-1.5 tabular-nums">Page {(page + 1).toLocaleString()} of {pageCount.toLocaleString()}</span>
          <IconBtn size="sm" variant="ghost" icon={ChevronRight}  label="Next page"     onClick={() => onPage(page + 1)}      disabled={page >= pageCount - 1} align="end" />
          <IconBtn size="sm" variant="ghost" icon={ChevronsRight} label="Last page"     onClick={() => onPage(pageCount - 1)} disabled={page >= pageCount - 1} align="end" />
        </nav>
      )}
    </div>
  )
}

function ErrorPanel({ title, message, code, hint, action, tone = 'error' }) {
  const warn = tone === 'warn'
  return (
    <div role="alert" className={`rounded-lg border px-4 py-3 text-sm ${warn ? 'border-amber-200 bg-amber-50/70' : 'border-rose-200 bg-rose-50/70'}`}>
      <div className="flex items-start gap-2.5">
        <CircleAlert size={16} strokeWidth={2.25} className={`mt-0.5 shrink-0 ${warn ? 'text-amber-600' : 'text-rose-600'}`} />
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${warn ? 'text-amber-800' : 'text-rose-800'}`}>
            {title}
            {code && <span className="ml-2 font-mono text-[11px] font-normal text-rose-500">SQLSTATE {code}</span>}
          </p>
          <p className={`mt-0.5 font-mono text-[12px] whitespace-pre-wrap break-words ${warn ? 'text-amber-700' : 'text-rose-700'}`}>{message}</p>
          {hint && <p className="mt-1 text-xs text-rose-600">Hint: {hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}

function EmptyState({ icon: Icon, title, text, tone, compact = false }) {
  const warn = tone === 'warn'
  return (
    <div className={`flex-1 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed ${
      warn ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-slate-50/50'
    } ${compact ? 'py-5' : 'py-10'}`}>
      <div className={`w-10 h-10 rounded-full bg-surface border shadow-sm flex items-center justify-center ${
        warn ? 'border-amber-200 text-amber-600' : 'border-slate-200 text-slate-400'
      }`}>
        <Icon size={20} strokeWidth={1.75} />
      </div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="text-xs text-slate-400">{text}</p>
    </div>
  )
}

export default QueryPane
