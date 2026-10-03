require('dotenv').config({ quiet: true })
const crypto = require('crypto')
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

function seal(payload) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv)
  cipher.setAAD(SESSION_AAD)
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')
}

function unseal(token) {
  try {
    const buf = Buffer.from(token, 'base64url')
    if (buf.length < 29) return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, buf.subarray(0, 12))
    decipher.setAAD(SESSION_AAD)
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
    const client = new Client({
      host,
      port,
      database: dbName,
      user: username,
      password: pgToken,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    await client.connect()
    await client.end()

    res.json({ host, port, dbName, username })
  } catch (err) {
    const msg = err.response?.data?.title || err.response?.data?.message || err.message
    res.status(500).json({ error: msg })
  }
})

/**
 * POST /api/query
 * Body: { SANDBOX_NAME, query } — credentials come from the session cookie
 * Returns: { columns, rows, duration }
 */
app.post('/api/query', requireSession, async (req, res) => {
  const { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG, SANDBOX_NAME, query } = req.body
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Query cannot be empty.' })
  }
  try {
    const token = await getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES })

    // Get connection parameters
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

    const client = new Client({
      host,
      port,
      database: dbName,
      user: username,
      password: pgToken,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })

    const t0 = Date.now()
    await client.connect()

    const result = await client.query(query)
    const duration = Date.now() - t0

    await client.end()

    const columns = result.fields.map(f => f.name)
    const rows = result.rows

    res.json({ columns, rows, duration })
  } catch (err) {
    const msg = err.response?.data?.title || err.response?.data?.message || err.message
    res.status(500).json({ error: msg })
  }
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
    const client = new Client({
      host,
      port: parseInt(port, 10) || 5432,
      database: dbName,
      user,
      password: password || '',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    await client.connect()
    await client.end()
    res.json({ host, port, dbName, user })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/query/direct
 * Body: { host, port, dbName, user, password, query }
 * Executes a query using raw Postgres credentials — no AEP API calls.
 * Returns: { columns, rows, duration }
 */
app.post('/api/query/direct', async (req, res) => {
  const { host, port, dbName, user, password, query } = req.body
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Query cannot be empty.' })
  }
  try {
    const client = new Client({
      host,
      port: parseInt(port, 10) || 5432,
      database: dbName,
      user,
      password: password || '',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    const t0 = Date.now()
    await client.connect()
    const result = await client.query(query)
    const duration = Date.now() - t0
    await client.end()

    const columns = result.fields.map(f => f.name)
    res.json({ columns, rows: result.rows, duration })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
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
const MERGE_POLICY_CONCURRENCY = 8

/**
 * Reduce a raw Catalog dataset to the fields the explorer needs, or null if it
 * should be hidden. Shown: every CUSTOMER-managed dataset, plus SYSTEM-managed
 * datasets whose name starts with "Profile-Snapshot" (kind: 'snapshot').
 */
function toExplorerDataset(id, ds) {
  const managedBy = ds?.classification?.managedBy
  const snapshot = managedBy === 'SYSTEM' && typeof ds.name === 'string' && ds.name.startsWith(SNAPSHOT_PREFIX)
  if (managedBy !== 'CUSTOMER' && !snapshot) return null
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
    kind: 'standard',
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
 * dataset id, and keeps CUSTOMER-managed datasets plus Profile-Snapshot datasets.
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
