const express = require('express')
const cors = require('cors')
const axios = require('axios')
const { Client } = require('pg')

const app = express()
app.use(cors())
app.use(express.json())

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
 * Body: { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG }
 * Returns: { sandboxes: [{name, title}], tenant }
 */
app.post('/api/sandboxes', async (req, res) => {
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
 * Body: { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG, SANDBOX_NAME }
 * Returns: { host, port, dbName, username }
 * Tests the Postgres connection and returns connection metadata.
 */
app.post('/api/connect', async (req, res) => {
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
 * Body: { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG, SANDBOX_NAME, query }
 * Returns: { columns, rows, duration }
 */
app.post('/api/query', async (req, res) => {
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

// ─── start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] AEP Query Connector backend listening on port ${PORT}`)
})
