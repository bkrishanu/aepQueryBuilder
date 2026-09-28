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

/** Create and verify a Postgres connection, then close it. Returns the client params. */
async function pgConnect({ host, port, database, user, password }) {
  const client = new Client({
    host,
    port: parseInt(port, 10) || 5432,
    database,
    user,
    password: password || '',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  })
  await client.connect()
  await client.end()
}

/** Open a Postgres connection, run a query, close, return { columns, rows, duration }. */
async function pgQuery({ host, port, database, user, password }, sql) {
  const client = new Client({
    host,
    port: parseInt(port, 10) || 5432,
    database,
    user,
    password: password || '',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  })
  const t0 = Date.now()
  await client.connect()
  const result = await client.query(sql)
  const duration = Date.now() - t0
  await client.end()
  return {
    columns: result.fields.map(f => f.name),
    rows: result.rows,
    duration,
  }
}

module.exports = { getAccessToken, tenantFromHost, pgConnect, pgQuery }
