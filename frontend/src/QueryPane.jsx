import { useState, useRef, useEffect, useLayoutEffect, forwardRef, useImperativeHandle } from 'react'
import api, { isSessionError, notifySessionExpired } from './api.js'
import { LoaderCircle, Copy, Check, Table2, CircleCheck, CircleAlert, OctagonX, Square } from 'lucide-react'
import SqlEditor from './SqlEditor.jsx'
import Btn, { IconBtn } from './Button.jsx'
import { splitStatements, RUN_SHORTCUT } from './sqlStatements.js'

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
          {results.columns.map((col, ci) => <col key={ci} style={{ width: `${colWidthPct}%` }} />)}
        </colgroup>
        <thead>
          <tr>
            {results.columns.map((col, ci) => (
              <th
                key={ci}
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
                    key={ci}
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

// ─── result helpers ───────────────────────────────────────────────────────────
const plural  = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
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
  if (set.columns.length) return `${plural(set.rows.length, 'row')} · ${plural(set.columns.length, 'col')} · ${set.duration}ms`
  const affected = set.rowCount != null && set.command !== 'SELECT' ? ` · ${plural(set.rowCount, 'row')} affected` : ''
  return `${set.command || 'Statement'}${affected} · ${set.duration}ms`
}

// ─── query streaming ──────────────────────────────────────────────────────────
// How long Cancel waits for the server to confirm before giving up on the run.
const CANCEL_CONFIRM_MS = 10000

/**
 * POST a run to /api/query or /api/query/direct and read its NDJSON stream,
 * calling onMessage for each message ('started' | 'done' | 'error').
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
//
// Cancel sends the run's cancel token to /api/query/cancel, then keeps reading
// the stream: a statement coming back with status 'cancelled' confirms that the
// database stopped it. Without confirmation within CANCEL_CONFIRM_MS the request
// is abandoned and the UI says the query may still be running on the server.
//
// results: null
//        | { sets: [{ statement, status, columns, rows, rowCount, command, duration, error? }], duration }
//        | { cancelled: true, unconfirmed?: true }
//        | { error }   — the request itself failed (auth, connection, …)
const QueryPane = forwardRef(function QueryPane({ addLog, onExecutingChange, onRun }, ref) {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState(null)
  const [executing, setExecuting] = useState(false)
  const [startedAt, setStartedAt] = useState(null)
  const [activeTab, setActiveTab] = useState('editor') // 'editor' | 'results'
  const [copiedKey, setCopiedKey] = useState(null)     // transient "Copied" feedback per result set
  const editorRef  = useRef(null)
  const [cancelling, setCancelling] = useState(false)
  const runRef     = useRef(null)  // { ac, token, cancelRequested, timer } of the run in flight
  const runningRef = useRef(false) // synchronous guard: state updates land too late to stop a double run

  useEffect(() => {
    if (copiedKey === null) return
    const t = setTimeout(() => setCopiedKey(null), 1600)
    return () => clearTimeout(t)
  }, [copiedKey])

  const sendCancel = (run) => {
    api.post('/query/cancel', { token: run.token })
      .then(res => addLog(res.data.sent ? 'info' : 'warn', res.data.sent
        ? 'Cancel request delivered to the database server — waiting for confirmation…'
        : 'Cancel request could not be delivered to the database server.'))
      .catch(err => addLog('warn', `Cancel request failed: ${err.response?.data?.error || err.message}`))
  }

  const requestCancel = (run) => {
    if (!run || run.cancelRequested) return
    run.cancelRequested = true
    setCancelling(true)
    onExecutingChange?.('cancelling')
    addLog('info', 'Cancelling query…')
    if (run.token) sendCancel(run)
    else if (run.started) run.ac.abort() // server can't issue cancel tokens — drop the request
    // otherwise the token is sent as soon as the server reports the run started
    run.timer = setTimeout(() => run.ac.abort(), CANCEL_CONFIRM_MS)
  }

  // closing the pane mid-run cancels it
  useEffect(() => () => {
    const run = runRef.current
    if (!run) return
    if (run.token) api.post('/query/cancel', { token: run.token }).catch(() => {})
    run.ac.abort()
  }, [])

  const setRunning = (running) => {
    runningRef.current = running
    setExecuting(running)
    setCancelling(false)
    setStartedAt(running ? Date.now() : null)
    onExecutingChange?.(running ? 'running' : false)
  }

  const logOutcome = (sets) => {
    sets.forEach((set, i) => {
      const tag = sets.length > 1 ? `Query ${i + 1}` : 'Query'
      if (set.status === 'success') addLog('info', `${tag} succeeded: ${describeSet(set)}.`)
      else if (set.status === 'error') addLog('error', `${tag} failed: ${set.error}`)
      else if (set.status === 'cancelled') addLog('warn', `${tag} cancelled on the server: ${set.error}`)
      else addLog('warn', `${tag} ${set.error}`)
    })
  }

  useImperativeHandle(ref, () => ({
    execute: async (endpoint, payload) => {
      if (runningRef.current) return // a run is in flight — ignore repeated Run / Ctrl+Enter
      const plan = editorRef.current?.getStatementsToRun() ?? { statements: splitStatements(query) }
      const statements = plan.statements.map(s => s.text)
      if (!statements.length) { addLog('warn', 'Query is empty.'); return }

      const run = { ac: new AbortController(), token: null, started: false, cancelRequested: false, timer: 0 }
      runRef.current = run
      setRunning(true)
      addLog('info', statements.length === 1
        ? `Executing: ${preview(statements[0])}`
        : `Executing ${statements.length} selected statements sequentially…`)
      let done = null
      try {
        await streamQuery(endpoint, { ...payload, queries: statements }, run.ac.signal, (msg) => {
          if (msg.type === 'started') {
            run.started = true
            run.token = msg.cancelToken
            if (run.cancelRequested) {
              if (run.token) sendCancel(run)
              else run.ac.abort()
            }
          } else if (msg.type === 'done') {
            done = msg
          } else if (msg.type === 'error') {
            throw new Error(msg.error)
          }
        })
        if (!done) throw new Error('The server closed the connection before the query finished.')
        const sets = done.results || []
        setResults({ sets, duration: done.duration })
        setActiveTab('results')
        logOutcome(sets)
        if (run.cancelRequested && !sets.some(s => s.status === 'cancelled')) {
          addLog('warn', 'The query finished before the cancel took effect.')
        }
      } catch (err) {
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
        if (runRef.current === run) runRef.current = null
        setRunning(false)
      }
    },
    cancel: () => requestCancel(runRef.current),
  }))

  const handleCopy = (set, key) => {
    const lines = [
      set.columns.join('\t'),
      ...set.rows.map(r => set.columns.map(c => r[c] ?? '').join('\t')),
    ]
    navigator.clipboard.writeText(lines.join('\n'))
    setCopiedKey(key)
    addLog('info', 'Results copied to clipboard (tab-delimited).')
  }

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
                onChange={setQuery}
                onRun={onRun}
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
                <p className="text-sm text-slate-500">Executing query, please wait… <Elapsed since={startedAt} /></p>
                <Btn variant="danger" size="sm" icon={Square} iconClassName="fill-current" loading={cancelling} onClick={() => requestCancel(runRef.current)}>
                  {cancelling ? 'Cancelling…' : 'Cancel query'}
                </Btn>
              </div>
            ) : !results ? (
              <EmptyState title="No results yet" text="Execute a query to see data here." icon={Table2} />
            ) : results.cancelled ? (
              <EmptyState
                title={results.unconfirmed ? 'Cancel not confirmed' : 'Query cancelled'}
                text={results.unconfirmed
                  ? 'The server did not confirm the cancel — the query may still be running in Query Service.'
                  : 'Execution was stopped and the database connection was closed.'}
                icon={OctagonX}
                tone="warn"
              />
            ) : results.error ? (
              <ErrorPanel title="Query failed" message={results.error} />
            ) : sets.length === 1 ? (
              <ResultSet
                set={sets[0]}
                title="Results"
                copied={copiedKey === 0}
                onCopy={() => handleCopy(sets[0], 0)}
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
                    key={i}
                    set={set}
                    title={`Query ${i + 1}`}
                    multi
                    copied={copiedKey === i}
                    onCopy={() => handleCopy(set, i)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

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

/**
 * One statement's outcome: header (title, status, stats, copy) and its table,
 * empty state or error. `multi` adds the status chip, the statement text and
 * a card frame so several result sets read as separate blocks.
 */
function ResultSet({ set, title, multi = false, copied, onCopy }) {
  const ok      = set.status === 'success'
  const hasCols = ok && set.columns.length > 0
  const chip    = STATUS_CHIP[set.status] || STATUS_CHIP.error
  const where   = !ok && set.position ? lineCol(set.statement, set.position) : null

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
          <IconBtn
            size="sm"
            icon={copied ? Check : Copy}
            iconClassName={copied ? 'text-emerald-600' : ''}
            label={copied ? 'Copied' : 'Copy results (tab-delimited)'}
            onClick={onCopy}
            disabled={set.rows.length === 0}
            align="end"
          />
        )}
      </div>

      {multi && (
        <code title={set.statement} className="block truncate rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[12px] text-slate-600">
          {oneLine(set.statement)}
        </code>
      )}

      {ok && set.rows.length > 0 && <ResultsTable results={set} />}
      {ok && set.rows.length === 0 && (
        <EmptyState
          compact={multi}
          title="Query executed successfully"
          text={hasCols ? 'No rows returned.' : describeSet(set)}
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
          hint={set.hint}
        />
      )}
    </section>
  )
}

function ErrorPanel({ title, message, hint, tone = 'error' }) {
  const warn = tone === 'warn'
  return (
    <div role="alert" className={`rounded-lg border px-4 py-3 text-sm ${warn ? 'border-amber-200 bg-amber-50/70' : 'border-rose-200 bg-rose-50/70'}`}>
      <div className="flex items-start gap-2.5">
        <CircleAlert size={16} strokeWidth={2.25} className={`mt-0.5 shrink-0 ${warn ? 'text-amber-600' : 'text-rose-600'}`} />
        <div className="min-w-0">
          <p className={`font-medium ${warn ? 'text-amber-800' : 'text-rose-800'}`}>{title}</p>
          <p className={`mt-0.5 font-mono text-[12px] whitespace-pre-wrap break-words ${warn ? 'text-amber-700' : 'text-rose-700'}`}>{message}</p>
          {hint && <p className="mt-1 text-xs text-rose-600">Hint: {hint}</p>}
        </div>
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
      <div className={`w-10 h-10 rounded-full bg-white border shadow-sm flex items-center justify-center ${
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
