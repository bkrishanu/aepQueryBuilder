// api/connect.js
// POST /api/connect — AEP OAuth → retrieve sandbox → get connection params → verify Postgres
const axios = require('axios')
const { getAccessToken, pgConnect } = require('./_helpers')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG, SANDBOX_NAME } = req.body
  try {
    const token = await getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES })

    // Retrieve sandbox details
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

    await pgConnect({ host, port, database: dbName, user: username, password: pgToken })

    res.json({ host, port, dbName, username })
  } catch (err) {
    const msg = err.response?.data?.title || err.response?.data?.message || err.message
    res.status(500).json({ error: msg })
  }
}
