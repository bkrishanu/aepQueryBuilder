// api/sandboxes.js
// POST /api/sandboxes — fetch OAuth token, list AEP sandboxes, derive tenant
const axios = require('axios')
const { getAccessToken, tenantFromHost } = require('./_helpers')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { API_KEY, CLIENT_SECRET, SCOPES, IMS_ORG } = req.body
  try {
    const token = await getAccessToken({ API_KEY, CLIENT_SECRET, SCOPES })

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
    } catch { /* best-effort */ }

    res.json({ sandboxes, tenant })
  } catch (err) {
    const msg = err.response?.data?.title || err.response?.data?.message || err.message
    res.status(500).json({ error: msg })
  }
}
