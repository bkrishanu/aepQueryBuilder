// api/_helpers.js  — shared utilities used by all serverless functions
const axios = require('axios')
const { Client } = require('pg')

/**
 * Fetch a fresh OAuth access_token from Adobe IMS.
 * Never cached — exists only for the duration of the request.
 */
async function getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES }) {
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

/** Extract tenant from host string e.g. foo.platform-query.adobe.io → foo */
function tenantFromHost(host) {
  if (!host) return ''
  return host.split('.')[0]
}

function pgClient({ host, port, database, user, password }) {
  const client = new Client({
    host,
    port: parseInt(port, 10) || 5432,
    database,
    user,
    password: password || '',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  })
  client.on('error', () => {}) // idle socket errors must not crash the function
  return client
}

/** Create and verify a Postgres connection; the client is always closed. */
async function pgConnect(config) {
  const client = pgClient(config)
  try {
    await client.connect()
  } finally {
    await client.end().catch(() => {})
  }
}

/** `queries` array or single `query` string from a request body → trimmed statements, or null. */
function statementsFromBody({ queries, query }) {
  const list = Array.isArray(queries) ? queries : [query]
  const stmts = list.filter(q => typeof q === 'string').map(q => q.trim()).filter(Boolean)
  return stmts.length ? stmts : null
}

/**
 * Open a Postgres connection, run each statement in turn (a failure is reported
 * and the next statement still runs), and always close the connection.
 * Returns { results: [{ statement, status, columns, rows, rowCount, command, duration, error? }], duration }.
 */
async function pgQuery(config, statements) {
  const client = pgClient(config)
  const t0 = Date.now()
  try {
    await client.connect()
    const results = []
    for (const statement of [].concat(statements)) {
      const s0 = Date.now()
      try {
        const out = await client.query(statement)
        for (const r of [].concat(out)) {
          results.push({
            statement,
            status: 'success',
            command: r.command || null,
            rowCount: typeof r.rowCount === 'number' ? r.rowCount : null,
            columns: (r.fields || []).map(f => f.name),
            rows: r.rows || [],
            duration: Date.now() - s0,
          })
        }
      } catch (err) {
        results.push({ statement, status: 'error', error: err.message, position: err.position ? parseInt(err.position, 10) : undefined, duration: Date.now() - s0 })
      }
    }
    return { results, duration: Date.now() - t0 }
  } finally {
    await client.end().catch(() => {})
  }
}

module.exports = { getAccessToken, tenantFromHost, pgConnect, pgQuery, statementsFromBody }
