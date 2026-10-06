require('dotenv').config({ quiet: true })
const crypto = require('crypto')
const net = require('net')
const tls = require('tls')
const express = require('express')
const cors = require('cors')
const axios = require('axios')
const { Client } = require('pg')

const app = express()
app.use(cors())
app.use(express.json())

// ─── credential session ──────────────────────────────────────────────────────
// The uploaded config (API_KEY, CLIENT_SECRET, …) is never stored in the browser.
// It is posted once to /api/session, encrypted here with AES-256-GCM, and handed
// back as an HttpOnly + SameSite=Strict cookie that page scripts cannot read.
// Every AEP route decrypts its credentials from that cookie (requireSession), so
// secrets never travel in request bodies or sit in browser storage. Stateless by
// design: nothing is kept server-side, which also works on serverless hosts.

const SESSION_COOKIE = 'aep_session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const SESSION_AAD    = Buffer.from('aep_session_v1')
const CRED_FIELDS    = ['API_KEY', 'CLIENT_SECRET', 'SCOPES', 'IMS_ORG']

/**
 * 32-byte key from SESSION_SECRET. Without one, local dev falls back to a random
 * per-process key (sessions reset on restart); production refuses to issue
 * sessions, since a random key would differ between serverless instances.
 */
const SESSION_KEY = (() => {
  const secret = process.env.SESSION_SECRET
  if (secret && secret.length >= 32) return crypto.createHash('sha256').update(secret).digest()
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    console.error('SESSION_SECRET is missing or shorter than 32 characters — credential sessions are disabled.')
    return null
  }
  console.warn('SESSION_SECRET not set — using a random key; sessions will reset when the server restarts.')
  return crypto.randomBytes(32)
})()

function seal(payload, aad = SESSION_AAD) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv)
  cipher.setAAD(aad)
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
}

function unseal(token, aad = SESSION_AAD) {
  try {
    const buf = Buffer.from(token, 'base64url')
    if (buf.length < 29) return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, buf.subarray(0, 12))
    decipher.setAAD(aad)
    decipher.setAuthTag(buf.subarray(12, 28))
    const payload = JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8'))
    return payload.exp > Date.now() ? payload : null
  } catch {
    return null // tampered, truncated, or sealed with another key
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

function readSession(req) {
  if (!SESSION_KEY) return null
  const token = readCookie(req, SESSION_COOKIE)
  return token ? unseal(token) : null
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    path: '/api',
  }
}

const sessionMisconfigured = (res) =>
  res.status(500).json({ error: 'Server misconfigured: SESSION_SECRET (32+ characters) must be set.' })

/** Route guard: replaces any client-sent credential fields with the session's. */
function requireSession(req, res, next) {
  if (!SESSION_KEY) return sessionMisconfigured(res)
  const session = readSession(req)
  if (!session) {
    return res.status(401).json({ error: 'Session expired or missing — please re-upload your config file.', code: 'SESSION_REQUIRED' })
  }
  const body = req.body && typeof req.body === 'object' ? { ...req.body } : {}
  for (const f of CRED_FIELDS) delete body[f]
  req.body = { ...body, ...session.c }
  next()
}

/**
 * POST /api/session
 * Body: the uploaded config JSON ({ API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG, … })
 * Verifies the credentials against Adobe IMS, then sets the encrypted session
 * cookie. Only non-secret details are returned: { IMS_ORG, expiresAt }.
 */
app.post('/api/session', async (req, res) => {
  if (!SESSION_KEY) return sessionMisconfigured(res)
  const cfg = req.body || {}
  const missing = CRED_FIELDS.filter(f => typeof cfg[f] !== 'string' || !cfg[f].trim() || cfg[f].length > 4096)
  if (missing.length) return res.status(400).json({ error: `Config is missing or has invalid: ${missing.join(', ')}` })

  const creds = Object.fromEntries(CRED_FIELDS.map(f => [f, cfg[f].trim()]))
  try {
    await getAccessToken(creds)
  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.error || err.message
    return res.status(401).json({ error: `Adobe IMS rejected the credentials: ${msg}` })
  }

  const exp = Date.now() + SESSION_TTL_MS
  res.cookie(SESSION_COOKIE, seal({ c: creds, exp }), { ...cookieOptions(req), maxAge: SESSION_TTL_MS })
  res.json({ IMS_ORG: creds.IMS_ORG, expiresAt: exp })
})

/** GET /api/session → { IMS_ORG, expiresAt } for an active session, else 401. */
app.get('/api/session', (req, res) => {
  if (!SESSION_KEY) return sessionMisconfigured(res)
  const session = readSession(req)
  if (!session) return res.status(401).json({ error: 'No active session.', code: 'SESSION_REQUIRED' })
  res.json({ IMS_ORG: session.c.IMS_ORG, expiresAt: session.exp })
})

/** DELETE /api/session → clears the credential cookie. */
app.delete('/api/session', (req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions(req))
  res.status(204).end()
})

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch an OAuth access_token from Adobe IMS.
 * The token is intentionally NOT cached — a fresh token is obtained per-request
 * so it is never stored in any persistent layer.
 */
async function getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES }) {
  // Adobe IMS rejects scopes that contain spaces after commas — normalize them
  const normalizedScopes = SCOPES.split(',').map(s => s.trim()).join(',')

  const params = new URLSearchParams()
  params.append('grant_type', 'client_credentials')
  params.append('client_id', API_KEY)
  params.append('client_secret', CLIENT_SECRET)
  params.append('scope', normalizedScopes)

  const res = await axios.post(
    'https://ims-na1.adobelogin.com/ims/token/v3',
    params,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  return res.data.access_token
}

/** Extract tenant from a host string like foo.platform-query.adobe.io → foo */
function tenantFromHost(host) {
  if (!host) return ''
  return host.split('.')[0]
}

// ─── postgres execution ──────────────────────────────────────────────────────
// Every Postgres connection goes through withPgClient, which closes the client
// in a finally block — on success, SQL errors, timeouts, dropped sockets and
// client-side cancellation alike — so a failed query never strands a session
// in the Query Service connection pool.

const PG_CONNECT_TIMEOUT_MS = 15000
const MAX_STATEMENTS = 100

class QueryCancelledError extends Error {
  constructor() {
    super('Query cancelled.')
    this.cancelled = true
  }
}

/**
 * Ask the server to cancel the statement running on backend `processID`
 * (protocol CancelRequest, sent on a separate connection — Postgres does not
 * notice a dropped socket while a query is busy). SSL is negotiated first, as
 * for the main connection, with a plaintext fallback. Resolves true once the
 * packet has been written (the protocol sends no reply), false on failure.
 */
function sendCancelRequest({ host, port }, processID, secretKey) {
  const packet = Buffer.alloc(16)
  packet.writeInt32BE(16, 0)
  packet.writeInt32BE(80877102, 4) // CancelRequest code
  packet.writeInt32BE(processID, 8)
  packet.writeInt32BE(secretKey, 12)
  const sslRequest = Buffer.alloc(8)
  sslRequest.writeInt32BE(8, 0)
  sslRequest.writeInt32BE(80877103, 4) // SSLRequest code

  return new Promise(resolve => {
    const sock = net.connect(parseInt(port, 10) || 5432, host)
    let done = false
    let sent = false
    const finish = () => { if (!done) { done = true; sock.destroy(); resolve(sent) } }
    const timer = setTimeout(finish, 5000)
    sock.on('error', finish)
    sock.on('close', () => { clearTimeout(timer); finish() })
    sock.once('connect', () => sock.write(sslRequest))
    sock.once('data', (b) => {
      if (b[0] !== 0x53) { sent = true; return sock.end(packet) } // 'N' → no SSL, send in plaintext
      const tlsSock = tls.connect({ socket: sock, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false })
      tlsSock.on('error', finish)
      tlsSock.once('secureConnect', () => tlsSock.end(packet, () => { sent = true }))
    })
  })
}

/**
 * Open a Postgres client, run fn(client), and always close the client.
 * When `signal` aborts (the browser cancelled the request) the running
 * statement is cancelled server-side and the client is closed.
 */
async function withPgClient({ host, port, database, user, password }, fn, signal, onConnected) {
  const client = new Client({
    host,
    port: parseInt(port, 10) || 5432,
    database,
    user,
    password: password || '',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,
  })
  // An idle socket error must not surface as an unhandled 'error' event and
  // crash the process; errors during a query reject that query instead.
  client.on('error', () => {})
  let closing = null
  const close = () => (closing ??= client.end().catch(() => {}))
  const onAbort = async () => {
    if (client.processID != null && client.secretKey != null) {
      await sendCancelRequest({ host, port }, client.processID, client.secretKey).catch(() => {})
    }
    await close()
  }
  let aborting = null
  const abortListener = () => { aborting = onAbort() }
  signal?.addEventListener('abort', abortListener, { once: true })
  try {
    if (signal?.aborted) throw new QueryCancelledError()
    await client.connect()
    onConnected?.(client)
    return await fn(client)
  } catch (err) {
    throw signal?.aborted ? new QueryCancelledError() : err
  } finally {
    signal?.removeEventListener('abort', abortListener)
    await aborting
    await close()
  }
}

/** Aborts when the client disconnects before the response has been sent. */
function clientAbortSignal(res) {
  const ac = new AbortController()
  res.on('close', () => { if (!res.writableEnded) ac.abort() })
  return ac.signal
}

/**
 * Statements to execute from a request body: `queries` (array, as the editor
 * sends) or a single `query` string. Returns null when there is nothing to run.
 */
function statementsFromBody({ queries, query }) {
  const list = Array.isArray(queries) ? queries : [query]
  const stmts = list.filter(q => typeof q === 'string').map(q => q.trim()).filter(Boolean)
  return stmts.length ? stmts : null
}

/** Postgres error → { error, code?, position?, hint?, detail? } for the client. */
function pgErrorInfo(err) {
  const info = { error: err.message || String(err) }
  if (err.code) info.code = err.code
  if (err.position) info.position = parseInt(err.position, 10)
  if (err.hint) info.hint = err.hint
  if (err.detail) info.detail = err.detail
  return info
}

/**
 * Run statements one at a time on a single connection. A failing statement is
 * reported and execution continues with the next one; if the connection itself
 * is lost, the remaining statements are reported as skipped. A statement that
 * yields several result sets (pg returns an array) produces one entry each.
 * A statement cancelled through /api/query/cancel ends the run: it is reported
 * as 'cancelled' and the remaining statements as skipped.
 * Returns [{ statement, status: 'success'|'error'|'cancelled'|'skipped', columns, rows,
 *            rowCount, command, duration, error?, … }]
 */
async function runStatements(client, statements, signal, onStatement) {
  let lost = false
  client.on('end', () => { lost = true })
  const results = []
  for (const [i, statement] of statements.entries()) {
    if (signal?.aborted) throw new QueryCancelledError()
    if (lost) {
      results.push({ statement, status: 'skipped', error: 'Skipped — the database connection was lost.' })
      continue
    }
    const t0 = Date.now()
    onStatement?.(i, t0)
    try {
      const out = await client.query(statement)
      const duration = Date.now() - t0
      for (const r of Array.isArray(out) ? out : [out]) {
        results.push({
          statement,
          status: 'success',
          command: r.command || null,
          rowCount: typeof r.rowCount === 'number' ? r.rowCount : null,
          columns: (r.fields || []).map(f => f.name),
          rows: r.rows || [],
          duration,
        })
      }
    } catch (err) {
      if (signal?.aborted) throw new QueryCancelledError()
      if (isUserCancel(err)) {
        // cancelled via /api/query/cancel: report it and run nothing further
        results.push({ statement, status: 'cancelled', duration: Date.now() - t0, ...pgErrorInfo(err) })
        const rest = statements.slice(i + 1)
        for (const s of rest) results.push({ statement: s, status: 'skipped', error: 'Skipped — the run was cancelled.' })
        break
      }
      results.push({ statement, status: 'error', duration: Date.now() - t0, ...pgErrorInfo(err) })
    }
  }
  return results
}

/** SQLSTATE 57014 (query_canceled) that isn't a statement_timeout. */
const isUserCancel = (err) => err?.code === '57014' && !/timeout/i.test(err.message || '')

const CANCEL_AAD = Buffer.from('aep_query_cancel_v1')
const CANCEL_TOKEN_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Shared body of /api/query and /api/query/direct. Streams newline-delimited JSON:
 *   { type: 'started', cancelToken }   — once connected; cancelToken is null when
 *                                        no SESSION_SECRET is configured
 *   { type: 'statement', index, startedAt } — before each statement runs
 *   { type: 'done', results, duration }
 *   { type: 'error', error }           — the run could not start (auth, connection, …)
 * The cancel token lets any server instance cancel this run through
 * /api/query/cancel — on serverless hosts the browser dropping the request is
 * not reliably reported to the function that is running the query.
 */
async function executeQueryRequest(res, statements, signal, getPgConfig, cancelContext = {}) {
  const t0 = Date.now()
  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  const send = (obj) => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n') }
  try {
    const pgConfig = await getPgConfig()
    const onConnected = (client) => {
      const canCancel = SESSION_KEY && client.processID != null && client.secretKey != null
      send({
        type: 'started',
        cancelToken: canCancel
          ? seal({ ...cancelContext, host: pgConfig.host, port: pgConfig.port, pid: client.processID, key: client.secretKey, exp: Date.now() + CANCEL_TOKEN_TTL_MS }, CANCEL_AAD)
          : null,
      })
    }
    const onStatement = (index, startedAt) => send({ type: 'statement', index, startedAt })
    const results = await withPgClient(pgConfig, client => runStatements(client, statements, signal, onStatement), signal, onConnected)
    send({ type: 'done', results, duration: Date.now() - t0 })
  } catch (err) {
    if (!(signal.aborted || err.cancelled)) {
      send({ type: 'error', error: err.response?.data?.title || err.response?.data?.message || err.message })
    }
  }
  res.end()
}

// ─── routes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/sandboxes
 * Body: {} — credentials come from the session cookie
 * Returns: { sandboxes: [{name, title}], tenant }
 */
app.post('/api/sandboxes', requireSession, async (req, res) => {
  const { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG } = req.body
  try {
    const token = await getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES })

    // List all sandboxes (x-sandbox-name header uses prod as default)
    const sbRes = await axios.get(
      'https://platform.adobe.io/data/foundation/sandbox-management/sandboxes',
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'x-api-key': API_KEY,
          'x-gw-ims-org-id': IMS_ORG,
          'x-sandbox-name': 'prod',
        },
      }
    )

    const sandboxes = (sbRes.data.sandboxes || []).map(s => ({
      name: s.name,
      title: s.title,
    }))

    // Get tenant from connection params (using prod sandbox)
    let tenant = ''
    try {
      const cpRes = await axios.get(
        'https://platform.adobe.io/data/foundation/query/connection_parameters',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-api-key': API_KEY,
            'x-gw-ims-org-id': IMS_ORG,
            'x-sandbox-name': 'prod',
          },
        }
      )
      tenant = tenantFromHost(cpRes.data.host)
    } catch {
      // tenant derivation is best-effort
    }

    res.json({ sandboxes, tenant })
  } catch (err) {
    const msg = err.response?.data?.title || err.response?.data?.message || err.message
    res.status(500).json({ error: msg })
  }
})

/**
 * POST /api/connect
 * Body: { SANDBOX_NAME } — credentials come from the session cookie
 * Returns: { host, port, dbName, username }
 * Tests the Postgres connection and returns connection metadata.
 */
app.post('/api/connect', requireSession, async (req, res) => {
  const { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG, SANDBOX_NAME } = req.body
  try {
    const token = await getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES })

    // 1. Retrieve sandbox details
    await axios.get(
      `https://platform.adobe.io/data/foundation/sandbox-management/sandboxes/${SANDBOX_NAME}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'x-api-key': API_KEY,
          'x-gw-ims-org-id': IMS_ORG,
          'x-sandbox-name': SANDBOX_NAME,
        },
      }
    )

    // 2. Get connection parameters
    const cpRes = await axios.get(
      'https://platform.adobe.io/data/foundation/query/connection_parameters',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-api-key': API_KEY,
          'x-gw-ims-org-id': IMS_ORG,
          'x-sandbox-name': SANDBOX_NAME,
        },
      }
    )

    const { host, port, dbName, username, token: pgToken } = cpRes.data

    // 3. Verify Postgres connectivity
    await withPgClient({ host, port, database: dbName, user: username, password: pgToken }, () => {})

    res.json({ host, port, dbName, username })
  } catch (err) {
    const msg = err.response?.data?.title || err.response?.data?.message || err.message
    res.status(500).json({ error: msg })
  }
})

/**
 * POST /api/query
 * Body: { SANDBOX_NAME, queries: [sql, …] } (or a single `query` string) —
 * credentials come from the session cookie.
 * Streams NDJSON (see executeQueryRequest); the final 'done' message carries
 *   { results: [{ statement, status, columns, rows, rowCount, command, duration, error? }], duration }
 * Statements run sequentially on one connection; cancel through /api/query/cancel.
 */
app.post('/api/query', requireSession, async (req, res) => {
  const { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG, SANDBOX_NAME } = req.body
  const statements = statementsFromBody(req.body)
  if (!statements) return res.status(400).json({ error: 'Query cannot be empty.' })
  if (statements.length > MAX_STATEMENTS) return res.status(400).json({ error: `At most ${MAX_STATEMENTS} statements can run at once.` })

  const signal = clientAbortSignal(res)
  await executeQueryRequest(res, statements, signal, async () => {
    const token = await getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES })
    const cpRes = await axios.get(
      'https://platform.adobe.io/data/foundation/query/connection_parameters',
      { headers: aepHeaders({ token, API_KEY, IMS_ORG, SANDBOX_NAME }), signal }
    )
    const { host, port, dbName, username, token: pgToken } = cpRes.data
    return { host, port, database: dbName, user: username, password: pgToken }
  }, { mode: 'aep', org: IMS_ORG, sandbox: SANDBOX_NAME })
})

const QS_TERMINAL_STATES = new Set(['SUCCESS', 'FAILED', 'KILLED', 'CANCELLED', 'CANCELED', 'DELETED'])
const QS_CLOCK_SKEW_MS = 60 * 1000
const normalizeSql = (sql) => String(sql || '').replace(/\s+/g, ' ').replace(/[\s;]+$/, '').trim()

/**
 * Cancel a statement through the Query Service API (PATCH /queries/{id}
 * { op: 'cancel' }). Query Service does not act on the Postgres CancelRequest,
 * and the API has no SQL filter, so recent queries are listed and the newest
 * unfinished one whose SQL matches the running statement is cancelled.
 * Returns diagnostics: { cancelled, queryId?, state?, scanned, error?, recent? }.
 */
async function cancelViaQueryApi(creds, sandbox, statement, startedAt) {
  const token = await getAccessToken(creds)
  const headers = { Accept: 'application/json', ...aepHeaders({ token, API_KEY: creds.API_KEY, IMS_ORG: creds.IMS_ORG, SANDBOX_NAME: sandbox }) }
  const since = new Date((Number(startedAt) || Date.now()) - QS_CLOCK_SKEW_MS).toISOString()
  const list = await axios.get('https://platform.adobe.io/data/foundation/query/queries', {
    headers,
    params: { orderby: '-created', limit: 50, property: `created>=${since}` },
  })
  const queries = Array.isArray(list.data?.queries) ? list.data.queries : []
  const target = normalizeSql(statement)
  const match = queries.find(q => !QS_TERMINAL_STATES.has(String(q.state).toUpperCase()) && normalizeSql(q.request?.sql) === target)
  if (!match) {
    return {
      cancelled: false,
      scanned: queries.length,
      // what the API did return, to show why nothing matched
      recent: queries.slice(0, 5).map(q => ({ state: q.state, client: q.client, sql: normalizeSql(q.request?.sql).slice(0, 80) })),
    }
  }
  await axios.patch(
    `https://platform.adobe.io/data/foundation/query/queries/${encodeURIComponent(match.id)}`,
    { op: 'cancel' },
    { headers: { ...headers, 'Content-Type': 'application/json' } }
  )
  return { cancelled: true, queryId: match.id, state: match.state, scanned: queries.length }
}

/**
 * POST /api/query/cancel
 * Body: { token, statement?, startedAt? } — token is the cancelToken streamed by
 * /api/query or /api/query/direct; statement / startedAt identify the running
 * statement (from the stream's 'statement' messages).
 * 1. Sends a PostgreSQL CancelRequest (works on plain Postgres).
 * 2. AEP runs only: also cancels the matching query through the Query Service
 *    API, using the session cookie's credentials.
 * The token is sealed by this server, so it cannot be forged to target another host.
 * Returns { sent, api } — whether each path was delivered; whether the database
 * honoured it shows up in the original run's results.
 */
app.post('/api/query/cancel', async (req, res) => {
  if (!SESSION_KEY) return sessionMisconfigured(res)
  const t = typeof req.body?.token === 'string' ? unseal(req.body.token, CANCEL_AAD) : null
  if (!t) return res.status(400).json({ error: 'Invalid or expired cancel token.' })
  const { statement, startedAt } = req.body

  const viaApi = async () => {
    if (t.mode !== 'aep') return null
    if (typeof statement !== 'string' || !statement.trim()) return { cancelled: false, error: 'No statement given.' }
    const session = readSession(req)
    if (!session || session.c.IMS_ORG !== t.org) return { cancelled: false, error: 'No matching credential session.' }
    try {
      return await cancelViaQueryApi(session.c, t.sandbox, statement, startedAt)
    } catch (err) {
      return { cancelled: false, error: err.response?.data?.title || err.response?.data?.message || err.message, status: err.response?.status }
    }
  }
  const [sent, api] = await Promise.all([
    sendCancelRequest({ host: t.host, port: t.port }, t.pid, t.key),
    viaApi(),
  ])
  res.json({ sent, api })
})

/**
 * POST /api/connect/direct
 * Body: { host, port, dbName, user, password }
 * Verifies a direct Postgres connection without any AEP API calls.
 * Returns: { host, port, dbName, user }
 */
app.post('/api/connect/direct', async (req, res) => {
  const { host, port, dbName, user, password } = req.body
  if (!host || !dbName || !user) {
    return res.status(400).json({ error: 'host, dbName and user are required.' })
  }
  try {
    await withPgClient({ host, port, database: dbName, user, password }, () => {})
    res.json({ host, port, dbName, user })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/query/direct
 * Body: { host, port, dbName, user, password, queries: [sql, …] } (or a single `query` string)
 * Executes statements using raw Postgres credentials — no AEP API calls.
 * Streams the same NDJSON messages as /api/query.
 */
app.post('/api/query/direct', async (req, res) => {
  const { host, port, dbName, user, password } = req.body
  const statements = statementsFromBody(req.body)
  if (!statements) return res.status(400).json({ error: 'Query cannot be empty.' })
  if (statements.length > MAX_STATEMENTS) return res.status(400).json({ error: `At most ${MAX_STATEMENTS} statements can run at once.` })

  const signal = clientAbortSignal(res)
  await executeQueryRequest(res, statements, signal, async () => ({ host, port, database: dbName, user, password }))
})

// ─── dataset explorer helpers ────────────────────────────────────────────────

const CATALOG_PAGE_SIZE = 100
const CATALOG_MAX_PAGES = 500 // hard stop (50,000 datasets) against runaway paging

function aepHeaders({ token, API_KEY, IMS_ORG, SANDBOX_NAME }) {
  return {
    Authorization: `Bearer ${token}`,
    'x-api-key': API_KEY,
    'x-gw-ims-org-id': IMS_ORG,
    'x-sandbox-name': SANDBOX_NAME,
  }
}

const SNAPSHOT_PREFIX = 'Profile-Snapshot'
const SEGMENT_SNAPSHOT_PREFIX = 'segmentdefinition-snapshot' // compared lower-cased
const MERGE_POLICY_CONCURRENCY = 8

// System (AJO / journey) datasets shown in the explorer's "System" group,
// matched case-insensitively on the Catalog dataset name.
const SYSTEM_DATASET_NAMES = new Set([
  'AJO Message Feedback Event Dataset',
  'AJO Push Tracking Experience Event Dataset',
  'AJO Push Profile Dataset',
  'AJO Consent Service Dataset',
  'AJO Email Tracking Experience Event Dataset',
  'AJO Classification Dataset',
  'AJO Profile Counters Extension',
  'AJO Entity Dataset',
  'AJO Secondary Recipient Feedback Event Dataset',
  'AJO Interactive Messaging Profile Dataset',
  'AJO STO Summary Dataset',
  'AJO Inbound Activity Event Dataset',
  'AJO Surfaces Dataset',
  'Journeys',
  'Journey Step Events',
  'AJO ExD Decision Event Dataset',
  'AJO Live Activities Feedback Event Dataset',
  'AJO Channel Tracking Event Dataset',
  'AJO Message Export Dataset',
  'AJO Message Event Metadata Dataset',
].map(n => n.toLowerCase()))

/**
 * Reduce a raw Catalog dataset to the fields the explorer needs, or null if it
 * should be hidden. Shown:
 *   - datasets named "Segmentdefinition-Snapshot*", whoever manages them (kind: 'segmentSnapshot')
 *   - every other CUSTOMER-managed dataset (kind: 'standard')
 *   - SYSTEM-managed datasets whose name starts with "Profile-Snapshot" (kind: 'snapshot')
 *   - non-customer datasets named in SYSTEM_DATASET_NAMES (kind: 'system')
 * Segment snapshot and system datasets carry a schemaId like standard ones.
 */
function toExplorerDataset(id, ds) {
  const managedBy = ds?.classification?.managedBy
  const rawName = typeof ds?.name === 'string' ? ds.name.trim() : ''
  const lower = rawName.toLowerCase()
  const segmentSnapshot = lower.startsWith(SEGMENT_SNAPSHOT_PREFIX)
  const snapshot = !segmentSnapshot && managedBy === 'SYSTEM' && rawName.startsWith(SNAPSHOT_PREFIX)
  const system = !segmentSnapshot && managedBy !== 'CUSTOMER' && SYSTEM_DATASET_NAMES.has(lower)
  if (managedBy !== 'CUSTOMER' && !snapshot && !segmentSnapshot && !system) return null
  const tags = ds.tags || {}
  const table = tags['adobe/pqs/table']
  const rowCount = ds.extensions?.adobe_lakeHouse?.metrics?.rowCount
  const unifiedProfile = Array.isArray(tags.unifiedProfile) ? tags.unifiedProfile : []
  const base = {
    id,
    name: (Array.isArray(table) ? table[0] : table) || ds.name || id,
    rowCount: typeof rowCount === 'number' ? rowCount : null,
  }
  if (snapshot) {
    // tags.unifiedProfile: ["mergePolicyId:dde2d674-…"] → merge policy id
    const mp = unifiedProfile.find(t => typeof t === 'string' && t.startsWith('mergePolicyId:'))
    return { ...base, kind: 'snapshot', mergePolicyId: mp ? mp.slice('mergePolicyId:'.length).trim() || null : null }
  }
  return {
    ...base,
    kind: segmentSnapshot ? 'segmentSnapshot' : system ? 'system' : 'standard',
    profileEnabled: unifiedProfile[0] === 'enabled:true',
    schemaId: ds.schemaRef?.id || null,
  }
}

/** Fetch merge policies by id (bounded concurrency) → { id: { name, default, isActiveOnEdge } | { error } }. */
async function fetchMergePolicies(ids, ctx) {
  const out = {}
  const queue = [...ids]
  const worker = async () => {
    for (let id; (id = queue.shift()) !== undefined;) {
      try {
        const r = await axios.get(
          `https://platform.adobe.io/data/core/ups/config/mergePolicies/${encodeURIComponent(id)}`,
          { headers: { Accept: 'application/json', ...aepHeaders(ctx) } }
        )
        out[id] = { name: r.data?.name || id, default: r.data?.default === true, isActiveOnEdge: r.data?.isActiveOnEdge === true }
      } catch (err) {
        out[id] = { error: err.response?.data?.title || err.response?.data?.message || err.message }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MERGE_POLICY_CONCURRENCY, queue.length) }, worker))
  return out
}

/**
 * https://ns.adobe.com/{tenant}/schemas/{schemaId} → _{tenant}.schemas.{schemaId}
 * Anything else (e.g. a global XDM schema) is passed URL-encoded, which the
 * Schema Registry also accepts.
 */
function toRegistrySchemaId(schemaRef) {
  const m = /^https?:\/\/ns\.adobe\.com\/([^/]+)\/schemas\/([^/?#]+)$/.exec(schemaRef)
  return m ? `_${m[1]}.schemas.${m[2]}` : encodeURIComponent(schemaRef)
}

/** Map an XDM property definition to a display datatype. */
function xdmType(def) {
  const t = def['meta:xdmType'] || def.type
  if (t === 'string' && def.format === 'date') return 'date'
  if (t === 'string' && def.format === 'date-time') return 'date-time'
  if (t === 'object' && def.additionalProperties && !def.properties) return 'map'
  if (Array.isArray(t)) return t.find(x => x !== 'null') || 'unknown'
  return t || 'unknown'
}

/**
 * Recursively turn a full (xed-full) schema's properties into a field tree:
 * [{ name, type, itemType?, arrayDims?, children? }]. Arrays of objects expose
 * their item fields as children; maps of objects expose their value fields.
 */
function extractFields(properties) {
  if (!properties || typeof properties !== 'object') return []
  return Object.entries(properties).map(([name, def]) => {
    def = def || {}
    const type = xdmType(def)
    const node = { name, type }
    let childProps = null
    if (type === 'object') {
      childProps = def.properties
    } else if (type === 'array') {
      // unwrap arrays of arrays: arrayDims = nesting depth, itemType = innermost type
      let items = def.items || {}
      let dims = 1
      while (xdmType(items) === 'array') {
        items = items.items || {}
        dims++
      }
      const itemType = xdmType(items)
      node.itemType = itemType
      node.arrayDims = dims
      if (itemType === 'object') childProps = items.properties
    } else if (type === 'map') {
      const values = def.additionalProperties
      if (values && typeof values === 'object' && values.properties) childProps = values.properties
    }
    if (childProps) {
      const children = extractFields(childProps)
      if (children.length) node.children = children
    }
    return node
  })
}

/**
 * POST /api/datasets
 * Body: { SANDBOX_NAME, knownMergePolicyIds? } — credentials come from the session cookie
 * Streams newline-delimited JSON so the explorer can render progressively:
 *   { type: 'page', start, datasets: [...] }        — one per Catalog page
 *   { type: 'mergePolicies', policies: { id: … } }  — after a page with new merge policy ids
 *   { type: 'done', scanned, total }
 *   { type: 'error', error }
 * Pages through Catalog (limit=100) until an empty response, de-duplicates by
 * dataset id, and keeps CUSTOMER-managed, Profile-Snapshot, Segmentdefinition-Snapshot
 * and listed System datasets (see toExplorerDataset).
 * Each merge policy is fetched at most once per request; ids the client already
 * has cached (knownMergePolicyIds) are skipped entirely.
 */
app.post('/api/datasets', requireSession, async (req, res) => {
  const { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG, SANDBOX_NAME, knownMergePolicyIds } = req.body
  if (!SANDBOX_NAME) return res.status(400).json({ error: 'SANDBOX_NAME is required.' })

  let token
  try {
    token = await getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES })
  } catch (err) {
    const msg = err.response?.data?.error_description || err.response?.data?.message || err.message
    return res.status(500).json({ error: msg })
  }

  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  const send = (obj) => res.write(JSON.stringify(obj) + '\n')

  let aborted = false
  req.on('close', () => { aborted = true })

  const seen = new Set()
  const requestedPolicies = new Set(Array.isArray(knownMergePolicyIds) ? knownMergePolicyIds : [])
  let total = 0
  try {
    for (let page = 0; page < CATALOG_MAX_PAGES && !aborted; page++) {
      const start = page * CATALOG_PAGE_SIZE
      const r = await axios.get('https://platform.adobe.io/data/foundation/catalog/dataSets', {
        params: { limit: CATALOG_PAGE_SIZE, start },
        headers: { Accept: 'application/json', ...aepHeaders({ token, API_KEY, IMS_ORG, SANDBOX_NAME }) },
      })
      const entries = Object.entries(r.data || {})
      if (entries.length === 0) break

      const datasets = []
      let fresh = 0
      for (const [id, ds] of entries) {
        if (seen.has(id)) continue
        seen.add(id)
        fresh++
        const d = toExplorerDataset(id, ds)
        if (d) datasets.push(d)
      }
      // a page made entirely of already-seen ids means the API is repeating itself
      if (fresh === 0) break
      total += datasets.length
      send({ type: 'page', start, datasets })

      const newPolicyIds = [...new Set(datasets.map(d => d.mergePolicyId).filter(Boolean))]
        .filter(id => !requestedPolicies.has(id))
      if (newPolicyIds.length && !aborted) {
        newPolicyIds.forEach(id => requestedPolicies.add(id))
        const policies = await fetchMergePolicies(newPolicyIds, { token, API_KEY, IMS_ORG, SANDBOX_NAME })
        send({ type: 'mergePolicies', policies })
      }
    }
    send({ type: 'done', scanned: seen.size, total })
  } catch (err) {
    const msg = err.response?.data?.title || err.response?.data?.message || err.message
    send({ type: 'error', error: msg })
  }
  res.end()
})

/**
 * POST /api/schema
 * Body: { SANDBOX_NAME, schemaId } — credentials come from the session cookie
 * schemaId is the dataset's schemaRef.id (https://ns.adobe.com/{tenant}/schemas/{id}).
 * Returns: { schemaId, title, fields: [{ name, type, itemType?, arrayDims?, children? }] }
 */
app.post('/api/schema', requireSession, async (req, res) => {
  const { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG, SANDBOX_NAME, schemaId } = req.body
  if (!schemaId || !SANDBOX_NAME) return res.status(400).json({ error: 'schemaId and SANDBOX_NAME are required.' })
  try {
    const token = await getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES })
    const r = await axios.get(
      `https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas/${toRegistrySchemaId(schemaId)}`,
      {
        headers: {
          Accept: 'application/vnd.adobe.xed-full+json; version=1',
          ...aepHeaders({ token, API_KEY, IMS_ORG, SANDBOX_NAME }),
        },
      }
    )
    res.json({ schemaId, title: r.data?.title || '', fields: extractFields(r.data?.properties) })
  } catch (err) {
    const msg = err.response?.data?.title || err.response?.data?.message || err.message
    res.status(err.response?.status === 404 ? 404 : 500).json({ error: msg })
  }
})

// ─── start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] AEP Query Connector backend listening on port ${PORT}`)
})
